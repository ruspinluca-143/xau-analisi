"""Quadro di mercato e avvisi personali (solo analisi, nessun ordine).

 - api_context   : dollaro, rendimenti, S&P, VIX e oro: variazione di oggi, quanto è insolita, correlazione 30 giorni, "semaforo" del giorno
 - api_sessions  : volatilità dell'oro per ora e per sessione (Asia, Londra, New York), ora italiana, da 2 anni di dati orari
 - api_fomc      : come ha reagito l'oro nell'ora e nelle due ore dopo ogni decisione della Fed (date note, dati orari)
 - api_benchmark : cosa avrebbe dato la regola base di breakout dell'app in un periodo (per il confronto con i tuoi risultati)
Dati gratuiti di Yahoo (e, per i minuti più recenti dell'oro, il feed in engine.py). Solo libreria standard.
"""
import datetime as dt
import json
import math
import os
import threading
import time

import engine as E

ROOT = os.path.dirname(os.path.abspath(__file__))
_lock = threading.Lock()
_cache = {}


def cached(key, ttl, fn):
    now = time.time()
    c = _cache.get(key)
    if c and now - c[0] < ttl:
        return c[1]
    val = fn()
    _cache[key] = (now, val)
    return val


def _daily(sym, rng="6mo"):
    res = E.fetch(sym, "1d", rng, ttl=120)
    ts = res.get("timestamp") or []
    cl = res["indicators"]["quote"][0]["close"]
    out = [(t, c) for t, c in zip(ts, cl) if c is not None]
    return out, res.get("meta", {})


def _rets(series):
    return [(series[i][1] / series[i - 1][1] - 1.0) for i in range(1, len(series))]


def _corr(a, b):
    n = min(len(a), len(b))
    if n < 10:
        return None
    a, b = a[-n:], b[-n:]
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 0 or vb <= 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def _session_name(hour):
    if 1 <= hour < 9:
        return "Asia"
    if 9 <= hour < 15:
        return "Londra"
    if 15 <= hour < 22:
        return "New York"
    return "Sera / notte"


# ---------------------------------------------------------------- quadro di mercato
CTX = [("DX-Y.NYB", "Dollaro (indice)", -1, "pt"), ("^TNX", "Rendimento USA 10 anni", -1, "bp"), ("^GSPC", "S&P 500", 0, "pct"), ("^VIX", "VIX (paura)", 0, "pt")]


def api_context(q):
    def build():
        gold, gmeta = _daily("GC=F")
        g_rets = _rets(gold)
        rows = []
        for sym, name, expect, kind in CTX:
            try:
                s, meta = _daily(sym)
                if len(s) < 25:
                    continue
                r = _rets(s)
                last = meta.get("regularMarketPrice") or s[-1][1]
                prev = s[-2][1]  # l'ultima barra giornaliera è la seduta di oggi (o l'ultima chiusa): il confronto è con la precedente
                chg = last / prev - 1.0
                sd = math.sqrt(sum(x * x for x in r[-60:]) / max(1, len(r[-60:])))
                rows.append({"sym": sym, "name": name, "last": last, "chg_pct": chg * 100.0, "chg_abs": last - prev, "kind": kind,
                             "z": chg / sd if sd else 0.0, "corr": _corr(r[-30:], g_rets[-30:]), "expect": expect})
            except Exception:  # noqa: BLE001  (un dato che manca non blocca gli altri)
                continue
        glast = gmeta.get("regularMarketPrice") or gold[-1][1]
        gprev = gold[-2][1]
        gchg = glast / gprev - 1.0
        gsd = math.sqrt(sum(x * x for x in g_rets[-60:]) / max(1, len(g_rets[-60:])))
        notes = []
        for r in rows:
            if r["expect"] and abs(r["z"]) >= 1.0 and abs(gchg / gsd if gsd else 0) >= 0.5 and (r["chg_pct"] > 0) == (gchg > 0):
                notes.append("%s e oro si muovono nello stesso verso (di solito sono opposti): movimento insolito." % r["name"])
        # semaforo: range di oggi contro l'ATR giornaliero
        d1, _ = E.get_bars("GC=F", "1d", E.epoch(E.now_utc()))
        atr = E.atr_list(d1)[-2] or 0
        today = d1[-1]
        rng = max(today[E.H] - today[E.L], abs(glast - today[E.O]))
        ratio = rng / atr if atr else None
        label = "tranquilla" if ratio is not None and ratio < 0.6 else "agitata" if ratio is not None and ratio > 1.3 else "nella norma"
        loc = E.to_local("rome", E.now_utc())
        return {"rows": rows, "gold": {"chg_pct": gchg * 100.0, "z": gchg / gsd if gsd else 0.0}, "notes": notes,
                "mood": {"range": rng, "atr": atr, "ratio": ratio, "label": label, "session": _session_name(loc.hour), "rome_hour": loc.hour,
                         "weekend": loc.weekday() >= 5},
                "updated": int(time.time())}
    return cached("ctx", 60, build)


# ---------------------------------------------------------------- sessioni
def api_sessions(q):
    def build():
        now_ts = E.epoch(E.now_utc())
        bars, _ = E.get_bars("GC=F", "1h", now_ts)
        hours = {h: [0, 0.0, 0] for h in range(24)}  # n, somma range, su
        days = {}
        for b in bars:
            loc = E.to_local("rome", E.utc_from_epoch(b[0]))
            if loc.weekday() >= 5:
                continue
            h = hours[loc.hour]
            h[0] += 1
            h[1] += b[E.H] - b[E.L]
            h[2] += 1 if b[E.C] >= b[E.O] else 0
            s = _session_name(loc.hour)
            d = days.setdefault((loc.date(), s), [b[E.O], b[E.H], b[E.L], b[E.C]])
            d[1], d[2], d[3] = max(d[1], b[E.H]), min(d[2], b[E.L]), b[E.C]
        sess = {}
        for (day, s), (o, hi, lo, c) in days.items():
            x = sess.setdefault(s, [0, 0.0, 0])
            x[0] += 1
            x[1] += hi - lo
            x[2] += 1 if c >= o else 0
        order = [("Asia", "01:00 - 09:00"), ("Londra", "09:00 - 15:00"), ("New York", "15:00 - 22:00"), ("Sera / notte", "22:00 - 01:00")]
        loc_now = E.to_local("rome", E.now_utc())
        return {"hours": [{"h": h, "n": v[0], "range": v[1] / v[0] if v[0] else 0, "up": v[2] / v[0] if v[0] else None} for h, v in hours.items()],
                "sessions": [{"name": n, "when": w, "days": sess.get(n, [0, 0, 0])[0], "range": sess[n][1] / sess[n][0] if n in sess else None,
                              "up": sess[n][2] / sess[n][0] if n in sess else None} for n, w in order],
                "now": {"hour": loc_now.hour, "session": _session_name(loc_now.hour)}, "bars": len(bars),
                "from": bars[0][0] if bars else None}
    return cached("sess", 3600, build)


# ---------------------------------------------------------------- reazione alle decisioni della Fed
FOMC_DATES = ["2024-11-07", "2024-12-18", "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
              "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28"]


def _us_dst(d):
    """True se negli USA c'è l'ora legale in quel giorno (dalla seconda domenica di marzo alla prima di novembre)."""
    def nth_sunday(y, m, n):
        first = dt.date(y, m, 1)
        return first + dt.timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))
    return nth_sunday(d.year, 3, 2) <= d < nth_sunday(d.year, 11, 1)


def api_fomc(q):
    def build():
        now_ts = E.epoch(E.now_utc())
        bars, _ = E.get_bars("GC=F", "1h", now_ts)
        by = {b[0]: b for b in bars}
        # volatilità normale per ora del giorno: range medio delle barre di quell'ora (giorni feriali, escludendo i giorni di decisione)
        ev_days = set(FOMC_DATES)
        norm = {}
        for b in bars:
            u = E.utc_from_epoch(b[0])
            if u.weekday() >= 5 or u.strftime("%Y-%m-%d") in ev_days:
                continue
            x = norm.setdefault(u.hour, [0, 0.0])
            x[0] += 1
            x[1] += b[E.H] - b[E.L]
        out = []
        for ds in FOMC_DATES:
            d = dt.date.fromisoformat(ds)
            hour = 18 if _us_dst(d) else 19  # le 14:00 di New York
            t0 = E.epoch(dt.datetime(d.year, d.month, d.day, hour, 0))
            b1, b2 = by.get(t0), by.get(t0 + 3600)
            if not b1 or not b2:
                continue
            nm = norm.get(hour)
            base = nm[1] / nm[0] if nm and nm[0] else None
            out.append({"date": ds, "range1": b1[E.H] - b1[E.L], "move1": b1[E.C] - b1[E.O], "move2": b2[E.C] - b1[E.O],
                        "ratio": (b1[E.H] - b1[E.L]) / base if base else None, "base": base})
        n = len(out)
        summ = None
        if n >= 3:
            ups = sum(1 for x in out if x["move1"] > 0)
            flips = sum(1 for x in out if (x["move1"] > 0) != (x["move2"] > 0))
            summ = {"n": n, "range1": sum(x["range1"] for x in out) / n, "abs1": sum(abs(x["move1"]) for x in out) / n,
                    "up1": ups / n, "flip": flips / n, "ratio": sum(x["ratio"] for x in out if x["ratio"]) / max(1, sum(1 for x in out if x["ratio"])),
                    "max_abs": max(abs(x["move1"]) for x in out)}
        return {"events": out, "summary": summ, "note": "Decisioni della Fed alle 14:00 di New York. Barre da 1 ora: la prima è l'ora esatta dopo l'annuncio."}
    return cached("fomc", 3600, build)


# ---------------------------------------------------------------- regola base dell'app in un periodo
def api_benchmark(q):
    def f(k, d):
        try:
            return float(q.get(k, [d])[0])
        except (TypeError, ValueError):
            return float(d)
    t0, t1 = int(f("t0", 0)), int(f("t1", time.time()))
    tf = (q.get("tf", ["1h"])[0] or "1h")
    if tf not in ("15m", "30m", "1h", "4h"):
        tf = "1h"
    rr = max(1.0, min(5.0, f("rr", 2)))
    key = ("bench", t0 // 3600, t1 // 3600, tf, rr)

    def build():
        now_ts = E.epoch(E.now_utc())
        bars, _ = E.get_bars("GC=F", tf, now_ts)
        atr = E.atr_list(bars)
        hold = {"15m": 24, "30m": 24, "1h": 24, "4h": 18}[tf]
        cases = []
        for d in ("buy", "sell"):
            for c in E.breakout_history(bars, atr, 20, 1.0, hold, d, [rr]):
                if t0 <= c["ts"] <= t1:
                    o = c["out"]["%g" % rr]
                    cases.append({"ts": c["ts"], "dir": d, "entry": c["entry"], "risk": c["risk"], "res": o[0], "r": o[1]})
        cases.sort(key=lambda x: x["ts"])
        n = len(cases)
        win = sum(1 for c in cases if c["res"] == "target")
        stop = sum(1 for c in cases if c["res"] == "stop")
        return {"tf": tf, "rr": rr, "n": n, "win": win, "stop": stop, "none": n - win - stop, "total_r": sum(c["r"] for c in cases),
                "avg_risk": sum(c["risk"] for c in cases) / n if n else None, "cases": cases[-400:],
                "first": bars[0][0] if bars else None}
    return cached(key, 300, build)
