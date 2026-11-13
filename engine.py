"""Motore di analisi di xau-app (oro XAUUSD e azioni USA).

SOLO ANALISI: nessun broker, nessun ordine, nessun lotto. Dati gratuiti di
Yahoo Finance (per l'oro il future GC=F). Solo libreria standard di Python.

Due tipi di setup, sempre sia BUY sia SHORT:
  - "breakout": una barra del time frame scelto CHIUDE oltre il massimo/minimo
    delle ultime N barre. Stop = k x ATR(14), target = R x rischio.
  - "london"/"ny": breakout del range d'apertura (15 min) di una sessione.
    Stop a meta' del range, target = R x rischio.
La Time Machine ripete il resto dell'operazione 10.000 volte pescando barre
reali dello stesso strumento; lo "storico" applica la stessa regola a tutte le
operazioni passate che i dati permettono.
"""
import datetime as dt
import json
import random
import re
import threading
import time
import urllib.request

HEADERS = {"User-Agent": "Mozilla/5.0"}
BASES = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]
ALIASES = {"XAUUSD": "GC=F", "XAU": "GC=F", "ORO": "GC=F", "GOLD": "GC=F", "GC=F": "GC=F"}
DEFAULT_RRS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0]

# tf -> (interval Yahoo, range Yahoo, secondi per barra)
TF = {
    "1m": ("1m", "7d", 60),
    "5m": ("5m", "60d", 300),
    "15m": ("15m", "60d", 900),
    "30m": ("30m", "60d", 1800),
    "1h": ("1h", "730d", 3600),
    "4h": ("1h", "730d", 14400),  # ricostruito dalle barre da 1 ora
    "1d": ("1d", "2y", 86400),
    "1w": ("1wk", "5y", 604800),
}
TF_ORDER = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]
SHORT_TF = ("1m", "5m", "15m", "30m", "1h")
LONG_TF = ("4h", "1d", "1w")
O, H, L, C = 1, 2, 3, 4  # indici nelle barre (ts, o, h, l, c)


def yahoo_symbol(s):
    s = (s or "XAUUSD").upper().strip()
    s = ALIASES.get(s, s)
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.=-]{0,11}", s):
        raise ValueError("Simbolo non valido: usa lettere e numeri, per esempio XAUUSD o TSLA.")
    return s


def is_gold(ysym):
    return ysym == "GC=F"


def pretty_name(ysym):
    return "Oro (XAUUSD)" if is_gold(ysym) else ysym


# ---------------------------------------------------------------- orari
def _sunday(y, mo, nth):
    if nth > 0:
        d = dt.date(y, mo, 1)
        d += dt.timedelta(days=(6 - d.weekday()) % 7)
        return d + dt.timedelta(weeks=nth - 1)
    nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
    d = nxt - dt.timedelta(days=1)
    return d - dt.timedelta(days=(d.weekday() + 1) % 7)


def us_dst(u):
    y = u.year
    return dt.datetime.combine(_sunday(y, 3, 2), dt.time(7, 0)) <= u < dt.datetime.combine(_sunday(y, 11, 1), dt.time(6, 0))


def eu_dst(u):
    y = u.year
    return dt.datetime.combine(_sunday(y, 3, -1), dt.time(1, 0)) <= u < dt.datetime.combine(_sunday(y, 10, -1), dt.time(1, 0))


def offset_h(tz, u):
    if tz == "ny":
        return -4 if us_dst(u) else -5
    if tz == "london":
        return 1 if eu_dst(u) else 0
    return 2 if eu_dst(u) else 1  # rome


def to_local(tz, u):
    return u + dt.timedelta(hours=offset_h(tz, u))


def from_local(tz, loc):
    u = loc - dt.timedelta(hours=offset_h(tz, loc))
    return loc - dt.timedelta(hours=offset_h(tz, u))


def epoch(u):
    return int(u.replace(tzinfo=dt.timezone.utc).timestamp())


def utc_from_epoch(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).replace(tzinfo=None)


def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def hhmm_it(t):
    return to_local("rome", utc_from_epoch(t)).strftime("%H:%M")


# ---------------------------------------------------------------- dati
_cache = {}
_lock = threading.Lock()


def fetch(sym, interval, rng, ttl=40):
    key = (sym, interval, rng)
    now = time.time()
    with _lock:
        c = _cache.get(key)
        if c and now - c[0] < ttl:
            return c[1]
    last = None
    for base in BASES:
        try:
            req = urllib.request.Request("%s/v8/finance/chart/%s?interval=%s&range=%s" % (base, sym, interval, rng), headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.load(r)["chart"]["result"][0]
            with _lock:
                _cache[key] = (now, res)
            return res
        except Exception as exc:  # noqa: BLE001
            last = exc
    with _lock:
        c = _cache.get(key)
    if c:
        return c[1]  # meglio dati un po' vecchi che nessun dato
    raise RuntimeError("Errore di rete leggendo Yahoo (%s): %s" % (sym, last))


def get_bars(ysym, tf, now_ts):
    """Barre chiuse [(ts, o, h, l, c)]. Per 1d e 1w l'ultima può essere in corso."""
    interval, rng, sec = TF[tf]
    res = fetch(ysym, interval, rng)
    ts = res.get("timestamp") or []
    q = res["indicators"]["quote"][0]
    raw = []
    for i, t in enumerate(ts):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None not in (o, h, l, c):
            raw.append((t, o, h, l, c))
    if tf == "4h":
        blocks = {}
        for b in raw:
            if b[0] + 3600 <= now_ts:
                blocks.setdefault(b[0] // 14400, []).append(b)
        out = []
        for k in sorted(blocks):
            g = blocks[k]
            if len(g) >= 2 and (k + 1) * 14400 <= now_ts:
                out.append((k * 14400, g[0][O], max(x[H] for x in g), min(x[L] for x in g), g[-1][C]))
        return out, res["meta"]
    if tf in ("1m", "5m", "15m", "30m"):
        return [b for b in raw if b[0] % sec == 0 and b[0] + sec <= now_ts], res["meta"]
    if tf == "1h":
        return [b for b in raw if b[0] + 3600 <= now_ts], res["meta"]
    return raw, res["meta"]


# ---------------------------------------------------------------- indicatori
def rsi14(closes):
    if len(closes) < 15:
        return None
    g = [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    ls = [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
    ag, al = sum(g[:14]) / 14.0, sum(ls[:14]) / 14.0
    for i in range(14, len(g)):
        ag = (ag * 13 + g[i]) / 14.0
        al = (al * 13 + ls[i]) / 14.0
    return 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)


def atr_list(bars, n=14):
    trs = [None] * len(bars)
    for i in range(1, len(bars)):
        trs[i] = max(bars[i][H] - bars[i][L], abs(bars[i][H] - bars[i - 1][C]), abs(bars[i][L] - bars[i - 1][C]))
    out = [None] * len(bars)
    run = 0.0
    for i in range(1, len(bars)):
        run += trs[i]
        if i > n:
            run -= trs[i - n]
        if i >= n:
            out[i] = run / n
    return out


def sma_list(vals, n):
    out = [None] * len(vals)
    run = 0.0
    for i, v in enumerate(vals):
        run += v
        if i >= n:
            run -= vals[i - n]
        if i >= n - 1:
            out[i] = run / n
    return out


def analyze_tf(bars):
    n = len(bars)
    if n < 25:
        return None
    closes = [b[C] for b in bars]
    last = closes[-1]
    s20 = sum(closes[-20:]) / 20.0
    s50 = sum(closes[-50:]) / 50.0 if n >= 50 else None
    rsi = rsi14(closes[-150:])
    atr = atr_list(bars[-40:])[-1]
    hi20, lo20 = max(b[H] for b in bars[-20:]), min(b[L] for b in bars[-20:])
    pos = (last - lo20) / (hi20 - lo20) if hi20 > lo20 else 0.5
    score = 1 if last > s20 else -1
    if s50 is not None:
        score += 1 if s20 > s50 else -1
    if rsi is not None:
        score += 1 if rsi > 50 else -1
    top = 3 if s50 is not None else 2
    bias = "rialzista" if (score >= top - 1 and score > 0) else "ribassista" if (score <= -(top - 1) and score < 0) else "neutro"
    flag = "ipercomprato" if rsi is not None and rsi >= 70 else "ipervenduto" if rsi is not None and rsi <= 30 else ""
    return {"n": n, "last": last, "sma20": s20, "sma50": s50, "rsi": rsi, "atr": atr, "hi20": hi20, "lo20": lo20,
            "pos": pos, "ch20": (last / closes[-21] - 1) * 100, "bias": bias, "flag": flag, "last_ts": bars[-1][0]}


def mtf(ysym, now_ts, tfs=None):
    out = {}
    for tf in (tfs or TF_ORDER):
        try:
            bars, _ = get_bars(ysym, tf, now_ts)
            out[tf] = analyze_tf(bars)
        except Exception as exc:  # noqa: BLE001
            out[tf] = {"error": str(exc)}
    return out


def mtf_reading(res):
    sh = [res[t]["bias"] for t in SHORT_TF if res.get(t) and "bias" in res[t]]
    lg = [res[t]["bias"] for t in LONG_TF if res.get(t) and "bias" in res[t]]
    allb = sh + lg
    cnt = lambda lst, b: sum(1 for x in lst if x == b)  # noqa: E731
    if not allb:
        return ""
    if cnt(allb, "ribassista") == len(allb):
        return "Tutti i time frame sono ribassisti: trend allineato al ribasso."
    if cnt(allb, "rialzista") == len(allb):
        return "Tutti i time frame sono rialzisti: trend allineato al rialzo."
    if lg and sh and cnt(lg, "ribassista") == len(lg) and cnt(sh, "rialzista") >= max(1, len(sh) // 2):
        return "Rimbalzo nei time frame corti dentro un trend ribassista dei lunghi (movimento contro-trend)."
    if lg and sh and cnt(lg, "rialzista") == len(lg) and cnt(sh, "ribassista") >= max(1, len(sh) // 2):
        return "Ritracciamento nei time frame corti dentro un trend rialzista dei lunghi."
    if cnt(allb, "rialzista") == 0:
        return "Nessun time frame rialzista (%d ribassisti, %d neutri): prevalenza ribassista." % (cnt(allb, "ribassista"), cnt(allb, "neutro"))
    if cnt(allb, "ribassista") == 0:
        return "Nessun time frame ribassista (%d rialzisti, %d neutri): prevalenza rialzista." % (cnt(allb, "rialzista"), cnt(allb, "neutro"))
    return "Quadro misto: i time frame non sono allineati."


# ---------------------------------------------------------------- percorso di un'operazione
def walk_multi(bars, i, d, entry, stop, rrs, hold):
    """Dalla barra i (ingresso al close) in avanti: stop controllato prima del target.
    Restituisce (path in R, {rr: (esito, R, indice_uscita)})."""
    sign = 1 if d == "buy" else -1
    risk = abs(entry - stop)
    n = len(bars)
    end = min(n - 1, i + hold)
    tg = {rr: entry + sign * rr * risk for rr in rrs}
    tidx = {rr: None for rr in rrs}
    sidx = None
    path = [0.0]
    broke = False
    for j in range(i + 1, end + 1):
        x = bars[j]
        if x is None:
            broke = True
            break
        hi, lo, c = x[H], x[L], x[C]
        if sidx is None and ((lo <= stop) if d == "buy" else (hi >= stop)):
            sidx = j
        path.append(-1.0 if sidx is not None else (c - entry) * sign / risk)
        fav = hi if d == "buy" else lo
        for rr in rrs:
            if tidx[rr] is None and ((fav >= tg[rr]) if d == "buy" else (fav <= tg[rr])):
                tidx[rr] = j
        if sidx is not None:
            break  # dopo lo stop nessun nuovo target conta
    complete = (not broke) and (i + hold <= n - 1)
    out = {}
    for rr in rrs:
        s, t = sidx, tidx[rr]
        if s is not None and (t is None or s <= t):
            out[rr] = ("stop", -1.0, s)
        elif t is not None:
            out[rr] = ("target", rr, t)
        else:
            out[rr] = ("none" if complete else "open", path[-1], end)
    return path, out


def hist_stats(cases, rr):
    k = "%g" % rr
    res = {"fired": 0, "target": 0, "stop": 0, "none": 0, "avg_r": 0.0, "se": float("inf")}
    rs = []
    for c in cases:
        o = c["out"].get(k)
        if o is None or o[0] == "open":
            continue
        res["fired"] += 1
        res[o[0]] += 1
        rs.append(o[1])
    if rs:
        res["avg_r"] = sum(rs) / len(rs)
        if len(rs) > 1:
            m = res["avg_r"]
            res["se"] = ((sum((x - m) ** 2 for x in rs) / (len(rs) - 1)) / len(rs)) ** 0.5
    return res


def verdict(rr, mc, hist):
    hit = mc["target"] + mc["stop"]
    need = 1.0 / (1.0 + rr)
    if hit < 0.05:
        base = "Quasi nessun tocco di stop o target nelle simulazioni: il prezzo di chiusura decide."
        dpts = 0.0
    else:
        frac = mc["target"] / hit
        dpts = (frac - need) * 100.0
        if abs(dpts) < 5:
            base = "Vicino al pareggio: target prima nel %.0f%% dei tocchi, ne servirebbe il %.0f%%." % (frac * 100, need * 100)
        elif abs(dpts) < 15:
            base = ("Pende verso il target" if dpts > 0 else "Pende verso lo stop") + ": target prima nel %.0f%% dei tocchi, pareggio al %.0f%%." % (frac * 100, need * 100)
        else:
            base = ("Nettamente verso il target" if dpts > 0 else "Nettamente verso lo stop") + ": target prima nel %.0f%% dei tocchi, pareggio al %.0f%%." % (frac * 100, need * 100)
    solid = hist["fired"] >= 10
    if dpts >= 5 and solid and hist["avg_r"] > hist["se"]:
        stance = "favorevole"
    elif dpts <= -5 or (solid and hist["avg_r"] < -hist["se"]):
        stance = "sfavorevole"
    else:
        stance = "nessun vantaggio"
    return base, stance


def hist_stance(hist):
    if hist["fired"] < 10:
        return "poco_storico"
    if hist["avg_r"] > hist["se"]:
        return "positivo"
    if hist["avg_r"] < -hist["se"]:
        return "negativo"
    return "nessun vantaggio"


# ---------------------------------------------------------------- Time Machine
def simulate(draw, k0, steps, p0, stop, rrs, d, reps, seed, entry, risk):
    """Ripete 'steps' barre 'reps' volte. draw(rnd, k) -> (ro, rh, rl, rc) rapporti sulla chiusura precedente."""
    if steps <= 0:
        return None
    rnd = random.Random(seed)
    sign = 1 if d == "buy" else -1
    tg = {rr: entry + sign * rr * risk for rr in rrs}
    cnt = {rr: [0, 0, 0, 0.0] for rr in rrs}  # target, stop, nessuno, somma R
    paths = []
    r0 = (p0 - entry) * sign / risk
    for _ in range(reps):
        price = p0
        pending = set(rrs)
        res = {}
        path = [r0]
        stopped = False
        for s in range(1, steps + 1):
            _, rh, rl, rc = draw(rnd, k0 + s)
            hi, lo = price * rh, price * rl
            if (lo <= stop) if d == "buy" else (hi >= stop):
                for rr in pending:
                    res[rr] = "s"
                pending = set()
                path.extend([-1.0] * (steps - s + 1))
                stopped = True
                break
            fav = hi if d == "buy" else lo
            for rr in list(pending):
                if (fav >= tg[rr]) if d == "buy" else (fav <= tg[rr]):
                    res[rr] = "t"
                    pending.discard(rr)
            price *= rc
            path.append((price - entry) * sign / risk)
        rend = -1.0 if stopped else (price - entry) * sign / risk
        for rr in pending:
            res[rr] = "n"
        for rr in rrs:
            o = res[rr]
            if o == "t":
                cnt[rr][0] += 1
                cnt[rr][3] += rr
            elif o == "s":
                cnt[rr][1] += 1
                cnt[rr][3] -= 1.0
            else:
                cnt[rr][2] += 1
                cnt[rr][3] += rend
        paths.append(path)
    per = {"%g" % rr: {"target": cnt[rr][0] / reps, "stop": cnt[rr][1] / reps, "none": cnt[rr][2] / reps,
                       "avg_r": cnt[rr][3] / reps} for rr in rrs}
    bands = {"p5": [], "p25": [], "p50": [], "p75": [], "p95": []}
    for col in zip(*paths):
        s = sorted(col)
        m = len(s)
        for key, q in (("p5", 0.05), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p95", 0.95)):
            bands[key].append(round(s[min(m - 1, int(m * q))], 3))
    sample = [[round(v, 3) for v in p] for p in paths[:40]]
    return {"per": per, "fan": {"bands": bands, "paths": sample, "steps": steps, "start": round(r0, 3)}}


def ratios_from(bars):
    out = []
    for i in range(1, len(bars)):
        pc = bars[i - 1][C]
        out.append((bars[i][O] / pc, bars[i][H] / pc, bars[i][L] / pc, bars[i][C] / pc))
    return out


# ---------------------------------------------------------------- assemblaggio per direzione
def per_rr_block(d, state, entry, stop, cur, rrs, cases, mc_per, cur_out):
    """Un blocco per ogni R: livelli, esito attuale, Time Machine, storico, giudizio."""
    sign = 1 if d == "buy" else -1
    risk = abs(entry - stop)
    blocks = {}
    for rr in rrs:
        k = "%g" % rr
        hist = hist_stats(cases, rr)
        blk = {"rr": rr, "target": entry + sign * rr * risk, "closed": None, "mc": None, "hist": {
            "fired": hist["fired"], "target": hist["target"], "stop": hist["stop"], "none": hist["none"],
            "avg_r": hist["avg_r"], "se": None if hist["se"] == float("inf") else hist["se"]}}
        if state == "triggered" and cur_out and cur_out[rr][0] in ("stop", "target"):
            blk["closed"] = cur_out[rr][0]
        if mc_per and k in mc_per and blk["closed"] is None:
            blk["mc"] = mc_per[k]
            blk["verdict"], blk["stance"] = verdict(rr, mc_per[k], hist)
        else:
            blk["stance"] = hist_stance(hist)
            blk["verdict"] = None
        blocks[k] = blk
    return blocks


def cases_payload(cases, limit=400):
    out = []
    for c in cases[-limit:]:
        out.append({"label": c["label"], "ts": c["ts"], "entry": c["entry"], "risk": c["risk"],
                    "path": [round(v, 3) for v in c["path"]],
                    "out": {k: [o[0], round(o[1], 3), o[2] - c["i"]] for k, o in c["out"].items()}})
    return out


# ---------------------------------------------------------------- setup: breakout N barre
def breakout_trigger(bars, i, N, d):
    hi = max(b[H] for b in bars[i - N:i])
    lo = min(b[L] for b in bars[i - N:i])
    if d == "buy":
        return bars[i][C] > hi and bars[i - 1][C] <= hi
    return bars[i][C] < lo and bars[i - 1][C] >= lo


def breakout_history(bars, atr, N, am, hold, d, rrs):
    cases = []
    n = len(bars)
    i = max(N, 15) + 1
    while i <= n - 1 - hold:
        if atr[i] and breakout_trigger(bars, i, N, d):
            entry = bars[i][C]
            risk = am * atr[i]
            if risk / entry < 0.0002:
                i += 1
                continue
            stop = entry - risk if d == "buy" else entry + risk
            path, out = walk_multi(bars, i, d, entry, stop, rrs, hold)
            last_exit = max(o[2] for o in out.values())
            cases.append({"i": i, "ts": bars[i][0], "label": "%s %s" % (
                utc_from_epoch(bars[i][0]).strftime("%d/%m %H:%M"), "buy" if d == "buy" else "short"),
                "entry": entry, "risk": risk, "path": path, "out": {"%g" % rr: o for rr, o in out.items()}})
            i = max(i + 1, last_exit + 1)
        else:
            i += 1
    return cases


def build_breakout(bars, tf, rrs, N, am, hold, replays, seed, with_mc=True):
    n = len(bars)
    sec = TF[tf][2]
    if n < N + 40:
        return {"error": "Dati insufficienti per il breakout a %d barre su %s." % (N, tf)}
    atr = atr_list(bars)
    ratios = ratios_from(bars[-1500:])
    draw = lambda rnd, k: rnd.choice(ratios)  # noqa: E731
    dirs = {}
    for d in ("buy", "sell"):
        cases = breakout_history(bars, atr, N, am, hold, d, rrs)
        sign = 1 if d == "buy" else -1
        fresh = None
        for i in (n - 1, n - 2, n - 3):
            if i > N and atr[i] and breakout_trigger(bars, i, N, d):
                fresh = i
                break
        res = {"dir": d, "tf": tf}
        if fresh is not None:
            i = fresh
            entry = bars[i][C]
            risk = am * atr[i]
            stop = entry - sign * risk
            path, cur_out = walk_multi(bars, i, d, entry, stop, rrs, hold)
            ago = n - 1 - i
            res.update({"state": "triggered", "entry": entry, "stop": stop, "risk": risk, "cur": bars[-1][C],
                        "trigger_ts": bars[i][0] + sec, "age_bars": ago, "age_min": ago * sec // 60 + 0,
                        "hold_bars": hold, "bars_left": max(0, hold - ago)})
            p0, steps = bars[-1][C], hold - ago
        else:
            level = max(b[H] for b in bars[n - N:n]) if d == "buy" else min(b[L] for b in bars[n - N:n])
            entry, risk = level, am * atr[-1]
            stop = entry - sign * risk
            cur_out = None
            res.update({"state": "waiting", "entry": entry, "stop": stop, "risk": risk, "cur": bars[-1][C],
                        "dist": abs(level - bars[-1][C]), "hold_bars": hold,
                        "level_text": "una barra da %s CHIUDE %s" % (tf, "sopra" if d == "buy" else "sotto")})
            p0, steps = entry, hold
        mc = None
        if with_mc and steps > 0 and not (cur_out and all(cur_out[rr][0] in ("stop", "target") for rr in rrs)):
            mc = simulate(draw, 0, steps, p0, stop, rrs, d, replays, seed, entry, risk)
        res["blocks"] = per_rr_block(d, res["state"], entry, stop, bars[-1][C], rrs, cases, mc["per"] if mc else None, cur_out)
        res["fan"] = mc["fan"] if mc else None
        res["cases"] = cases_payload(cases)
        res["n_cases"] = len(cases)
        dirs[d] = res
    return {"kind": "breakout", "label": "Breakout %d barre (%s)" % (N, tf), "tf": tf, "sec": sec,
            "params": {"N": N, "atr_mult": am, "hold": hold}, "dirs": dirs}


# ---------------------------------------------------------------- setup: sessioni (range d'apertura)
def sessions_for(ysym):
    if is_gold(ysym):
        return {"london": {"label": "Londra", "tz": "london", "h": 8, "m": 0, "hold": 5 * 3600},
                "ny": {"label": "New York", "tz": "ny", "h": 8, "m": 30, "hold": 6 * 3600}}
    return {"ny": {"label": "New York (Borsa)", "tz": "ny", "h": 9, "m": 30, "hold": 23400}}


def session_start(sess, d):
    return from_local(sess["tz"], dt.datetime(d.year, d.month, d.day, sess["h"], sess["m"]))


def session_bars(bd, sess, d, sec):
    t0 = epoch(session_start(sess, d))
    n = sess["hold"] // sec
    return [((t0 + k * sec,) + bd[t0 + k * sec]) if (t0 + k * sec) in bd else None for k in range(n)], t0


def past_sessions(bd, sess, today, sec):
    dates = sorted({to_local(sess["tz"], utc_from_epoch(t)).date() for t in bd})
    out = []
    for d in dates:
        if d >= today or d.weekday() >= 5:
            continue
        b, _ = session_bars(bd, sess, d, sec)
        if all(x is not None for x in b):
            out.append((d, b))
    return out


def build_session(ysym, key, tf, bars, now_u, rrs, or_min, replays, seed, with_mc=True):
    sess_all = sessions_for(ysym)
    if key not in sess_all:
        return {"error": "Sessione non disponibile per questo strumento."}
    if tf not in ("5m", "15m"):
        return {"error": "Le sessioni funzionano con barre da 5 o 15 minuti."}
    sess = sess_all[key]
    sec = TF[tf][2]
    if (or_min * 60) % sec:
        return {"error": "Il range d'apertura deve essere un multiplo di %d minuti." % (sec // 60)}
    bd = {b[0]: b[1:] for b in bars}
    now_ts = epoch(now_u)
    today = to_local(sess["tz"], now_u).date()
    n = sess["hold"] // sec
    orn = or_min * 60 // sec
    margin = max(1, 3600 // sec)
    past = past_sessions(bd, sess, today, sec)
    base = {"kind": "session", "key": key, "label": sess["label"], "tf": tf, "sec": sec, "n_past": len(past)}
    if len(past) < 15:
        base["error"] = "Dati insufficienti: servono almeno 15 sedute complete, ce ne sono %d." % len(past)
        return base
    t0 = epoch(session_start(sess, today))
    base["open_it"] = hhmm_it(t0)
    base["flat_it"] = hhmm_it(t0 + n * sec)
    ratios = [[] for _ in range(n)]
    for _, b in past:
        for k in range(1, n):
            pc = b[k - 1][C]
            ratios[k].append((b[k][O] / pc, b[k][H] / pc, b[k][L] / pc, b[k][C] / pc))
    window = max(1, 600 // sec)

    def draw(rnd, k):
        kk = min(max(k + rnd.randint(-window, window), 1), n - 1)
        return rnd.choice(ratios[kk])

    def rng_of(b):
        r = b[:orn]
        if any(x is None for x in r):
            return None
        return max(x[H] for x in r), min(x[L] for x in r)

    hist_cases = {"buy": [], "sell": []}
    for day, b in past:
        rg = rng_of(b)
        if rg is None:
            continue
        hi, lo = rg
        mid = (hi + lo) / 2.0
        for d in ("buy", "sell"):
            k = None
            for j in range(orn, n - margin):
                if (b[j][C] > hi) if d == "buy" else (b[j][C] < lo):
                    k = j
                    break
            if k is None:
                continue
            entry = b[k][C]
            if abs(entry - mid) / entry < 0.0003:
                continue
            path, out = walk_multi(b, k, d, entry, mid, rrs, n - 1 - k)
            hist_cases[d].append({"i": k, "ts": b[k][0], "label": "%s %s" % (day.strftime("%d/%m"), "buy" if d == "buy" else "short"),
                                  "entry": entry, "risk": abs(entry - mid), "path": path,
                                  "out": {"%g" % rr: o for rr, o in out.items()}})
    if today.weekday() >= 5:
        state = "closed"
        base["state_text"] = "Weekend: mercato chiuso. Mostro solo lo storico della regola."
    elif now_ts < t0:
        state = "before"
        base["state_text"] = "Non ancora aperta (apre alle %s ora italiana). Mostro solo lo storico." % base["open_it"]
    elif now_ts < t0 + orn * sec:
        state = "forming"
        base["state_text"] = "Range d'apertura in formazione. Mostro solo lo storico."
    else:
        state = "live"
        base["state_text"] = ""
    base["session_state"] = state
    dirs = {}
    b = rg = None
    last_idx = 0
    if state == "live":
        b, _ = session_bars(bd, sess, today, sec)
        rg = rng_of(b)
        if rg is None:
            state = "nodata"
            base["state_text"] = "Mancano barre nel range d'apertura (pausa o dati incompleti)."
        else:
            last_idx = max(i for i, x in enumerate(b) if x is not None and all(y is not None for y in b[:i + 1]))
            widths = sorted(r[0] - r[1] for r in (rng_of(bb) for _, bb in past) if r)
            base["range"] = {"hi": rg[0], "lo": rg[1], "width": rg[0] - rg[1], "mid": (rg[0] + rg[1]) / 2.0,
                             "median_width": widths[len(widths) // 2] if widths else None}
            base["last_bar_it"] = hhmm_it(b[last_idx][0] + sec)
    for d in ("buy", "sell"):
        sign = 1 if d == "buy" else -1
        res = {"dir": d, "tf": tf, "state": "none"}
        cases = hist_cases[d]
        cur_out = None
        mc = None
        entry = stop = None
        if state == "live" and rg is not None:
            hi, lo = rg
            mid = (hi + lo) / 2.0
            last_entry = n - 1 - margin
            k = None
            for j in range(orn, min(last_idx, last_entry) + 1):
                if (b[j][C] > hi) if d == "buy" else (b[j][C] < lo):
                    k = j
                    break
            cur = b[last_idx][C]
            if k is not None:
                entry, stop = b[k][C], mid
                risk = abs(entry - stop)
                path, cur_out = walk_multi(b, k, d, entry, stop, rrs, n - 1 - k)
                age_min = (now_ts - (b[k][0] + sec)) // 60
                res.update({"state": "triggered", "entry": entry, "stop": stop, "risk": risk, "cur": cur,
                            "trigger_ts": b[k][0] + sec, "age_min": age_min, "age_bars": last_idx - k,
                            "bars_left": n - 1 - last_idx})
                p0, steps = cur, n - 1 - last_idx
            elif last_idx <= last_entry:
                level = hi if d == "buy" else lo
                entry, stop = level, mid
                risk = abs(entry - stop)
                res.update({"state": "waiting", "entry": entry, "stop": stop, "risk": risk, "cur": cur,
                            "dist": abs(level - cur), "level_text": "una barra da %d min CHIUDE %s" % (sec // 60, "sopra" if d == "buy" else "sotto")})
                p0, steps = level, n - 1 - max(last_idx, orn - 1)
            else:
                res["state"] = "expired"
            if res["state"] in ("triggered", "waiting") and with_mc and steps > 0 and not (
                    cur_out and all(cur_out[rr][0] in ("stop", "target") for rr in rrs)):
                mc = simulate(draw, n - 1 - steps, steps, p0, stop, rrs, d, replays, seed, entry, risk)
        if res["state"] in ("triggered", "waiting"):
            res["blocks"] = per_rr_block(d, res["state"], entry, stop, res["cur"], rrs, cases, mc["per"] if mc else None, cur_out)
            res["fan"] = mc["fan"] if mc else None
        else:
            res["blocks"] = {"%g" % rr: {"rr": rr, "target": None, "closed": None, "mc": None, "verdict": None,
                                         "stance": hist_stance(hist_stats(cases, rr)),
                                         "hist": {k2: (None if (k2 == "se" and v == float("inf")) else v)
                                                  for k2, v in hist_stats(cases, rr).items()}} for rr in rrs}
            res["fan"] = None
        res["cases"] = cases_payload(cases)
        res["n_cases"] = len(cases)
        dirs[d] = res
    base["dirs"] = dirs
    return base


# ---------------------------------------------------------------- quadro prezzo
def price_info(ysym, now_ts, spot=None):
    d1, meta1 = get_bars(ysym, "1d", now_ts)
    b5, meta5 = get_bars(ysym, "5m", now_ts)
    live = meta5.get("regularMarketPrice") or (b5[-1][C] if b5 else d1[-1][C])
    prev = d1[-2][C] if len(d1) >= 2 else live
    closes = [b[C] for b in d1]
    a = atr_list(d1)
    info = {"last": live, "prev_close": prev, "change_pct": (live / prev - 1) * 100 if prev else 0.0,
            "rsi_d": rsi14(closes[-150:]), "atr_d": a[-1], "sma20_d": sum(closes[-20:]) / 20.0 if len(closes) >= 20 else None,
            "hi20_d": max(b[H] for b in d1[-20:]), "lo20_d": min(b[L] for b in d1[-20:]),
            "prev_hi": d1[-2][H] if len(d1) >= 2 else None, "prev_lo": d1[-2][L] if len(d1) >= 2 else None,
            "last_bar_ts": b5[-1][0] + 300 if b5 else None, "offset": 0.0, "spot": None, "gap_warning": False}
    if spot:
        info["spot"] = spot
        info["offset"] = spot - live
        info["gap_warning"] = abs(spot - live) > (25 if is_gold(ysym) else 0.05 * live)
    return info
