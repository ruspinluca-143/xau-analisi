"""Server locale di xau-app. SOLO ANALISI: nessun broker, nessun ordine.

    python server.py            ->  http://127.0.0.1:8765
    python server.py --open     ->  apre anche il browser

Solo libreria standard. Ascolta solo su 127.0.0.1 (il tuo computer).
"""
import argparse
import base64
import datetime
import hmac
import json
import math
import os
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # serve con `python -I server.py`
import engine as E  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web") if os.path.isdir(os.path.join(ROOT, "web")) else ROOT  # versione online piatta: tutto nella stessa cartella
DATA = os.path.join(ROOT, "data")
JOURNAL = os.path.join(DATA, "journal.json")
DEFAULT_HOLD = {"1m": 60, "5m": 36, "15m": 24, "30m": 24, "1h": 24, "4h": 18, "1d": 10, "1w": 8}
jlock = threading.Lock()
SETUP_CACHE = {}


def clean(o):
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    return o


def num(q, key, default, cast=float):
    try:
        v = q.get(key, [""])[0]
        return cast(v) if v != "" else default
    except ValueError:
        return default


def bounded(q, key, default, lo, hi, cast=float):
    v = num(q, key, default, cast)
    return v if v is None else min(max(v, lo), hi)


def rrs_from(q):
    raw = q.get("rrs", [""])[0]
    if not raw:
        return E.DEFAULT_RRS
    try:
        return sorted({min(float(x), 20.0) for x in raw.split(",") if x.strip() and float(x) > 0})[:8] or E.DEFAULT_RRS
    except ValueError:
        return E.DEFAULT_RRS


# ---------------------------------------------------------------- spiegazione in italiano
def fmt_price(x, gold):
    return ("{:,.1f}" if gold else "{:,.2f}").format(x).replace(",", "X").replace(".", ",").replace("X", ".")


def c2(v, plus=False):
    return (("%+.2f" if plus else "%.2f") % v).replace(".", ",")


def why_lines(nm, d, r, b, info, rr, gold):
    """Perché il giudizio è quello: cosa gioca a favore e cosa contro, in parole semplici, solo dai numeri dell'analisi."""
    pro, con = [], []
    need = 1.0 / (1.0 + rr)
    m, h = b.get("mc"), b.get("hist") or {}
    if m:
        hit = m["target"] + m["stop"]
        if hit >= 0.05:
            frac = m["target"] / hit
            if frac - need >= 0.05:
                pro.append("nelle simulazioni, quando il prezzo tocca uno dei due livelli, arriva prima il target nel %.0f%% dei casi; per non perdere nel lungo periodo ne servirebbe il %.0f%%: c'è un margine" % (frac * 100, need * 100))
            elif frac - need <= -0.05:
                con.append("nelle simulazioni il target arriva prima solo nel %.0f%% dei tocchi, ne servirebbe il %.0f%% per non perdere: il rischio pesa più del guadagno" % (frac * 100, need * 100))
            else:
                con.append("nelle simulazioni il target arriva prima nel %.0f%% dei tocchi contro il %.0f%% che serve per pareggiare: è un testa o croce, senza margine" % (frac * 100, need * 100))
        else:
            con.append("nelle simulazioni il prezzo tocca raramente stop o target nella finestra: l'esito dipende da dove chiude, non dal piano")
    n = h.get("fired", 0)
    if n >= 10:
        se = h.get("se")
        if se is not None and h["avg_r"] > se:
            pro.append("lo storico reale (%d casi) dà in media %s R per operazione, più dell'incertezza statistica (±%s): difficilmente è solo fortuna" % (n, c2(h["avg_r"], True), c2(se)))
        elif se is not None and h["avg_r"] < -se:
            con.append("lo storico reale (%d casi) dà in media %s R per operazione, sotto zero oltre l'incertezza (±%s): in passato questa regola ha perso" % (n, c2(h["avg_r"], True), c2(se)))
        else:
            con.append("lo storico reale (%d casi) dà in media %s R, dentro l'incertezza (±%s): non si distingue dal caso" % (n, c2(h["avg_r"], True), c2(se) if se is not None else "?"))
    else:
        con.append("lo storico ha solo %d casi: troppo pochi per fidarsi dei numeri" % n)
    buy = d == "buy"
    rsi, sma = info.get("rsi_d"), info.get("sma20_d")
    if sma:
        up = info["last"] > sma
        if up == buy:
            pro.append("va nella direzione della tendenza di breve: il prezzo è %s la media a 20 giorni" % ("sopra" if up else "sotto"))
        else:
            con.append("va contro la tendenza di breve: il prezzo è %s la media a 20 giorni" % ("sopra" if up else "sotto"))
    if rsi is not None:
        if buy and rsi >= 70:
            con.append("l'RSI giornaliero è a %.0f: il prezzo è già salito molto e può essere stanco" % rsi)
        elif not buy and rsi <= 30:
            con.append("l'RSI giornaliero è a %.0f: il prezzo è già sceso molto e può essere stanco" % rsi)
    atr = info.get("atr_d")
    risk = r.get("risk")
    if atr and risk:
        q = risk / atr
        if q < 0.15:
            con.append("lo stop è molto stretto (%s, il %.0f%% del movimento normale di una giornata): può scattare per puro rumore" % (fmt_price(risk, gold), q * 100))
        elif q > 0.6:
            con.append("lo stop è largo (%s, il %.0f%% del movimento normale di una giornata): serve un movimento grande per arrivare al target" % (fmt_price(risk, gold), q * 100))
    if r.get("state") == "waiting":
        con.append("il segnale non è ancora scattato: finché una barra non chiude %s il livello non c'è nessun ingresso da valutare" % ("sopra" if buy else "sotto"))
    elif r.get("state") == "triggered" and r.get("age_min", 0) > 30:
        con.append("è scattato da %s: entrare adesso sarebbe in ritardo, con un prezzo peggiore di quello del segnale" % (("%d minuti" % r["age_min"]) if r["age_min"] < 180 else ("%.1f ore" % (r["age_min"] / 60.0))))
    if b.get("closed"):
        con.append("il piano teorico si è già chiuso (%s toccato)" % ("target" if b["closed"] == "target" else "stop"))
    out = []
    if pro:
        out.append("%s, perché può avere senso valutarlo: %s." % (nm, "; ".join(pro)))
    if con:
        out.append("%s, cosa invece pesa contro: %s." % (nm, "; ".join(con)))
    return out


def explain(name, gold, info, setup, rr, tf=None):
    off = info.get("offset", 0.0)
    P = lambda x: fmt_price(x + off, gold)  # noqa: E731
    k = "%g" % rr
    out = []
    ch = info["change_pct"]
    s = "%s è a %s (%s%% sulla chiusura precedente)." % (name, P(info["last"]), c2(ch, True))
    if info.get("rsi_d") is not None:
        s += " RSI giornaliero %.0f" % info["rsi_d"]
        if info.get("sma20_d"):
            s += ", prezzo %s la media a 20 giorni" % ("sopra" if info["last"] > info["sma20_d"] else "sotto")
        s += ", escursione media giornaliera %s." % fmt_price(info["atr_d"], gold) if info.get("atr_d") else "."
    out.append(s)
    if info.get("gap_warning"):
        out.append("Attenzione: lo scarto tra il prezzo che hai scritto (%s) e i dati di Yahoo (%s) è insolitamente grande, quindi i livelli spostati sul tuo grafico non sono affidabili. Controlla prezzo e simbolo." % (
            fmt_price(info["spot"], gold), fmt_price(info["last"], gold)))
    if setup.get("error"):
        out.append(setup["error"])
        return out
    if setup.get("state_text"):
        out.append(setup["state_text"])
    if tf in ("1d", "1w"):
        out.append("A questo time frame l'ultima barra è ancora in corso: un segnale può sparire o comparire fino alla chiusura.")
    label = setup["label"]
    for d, nm in (("buy", "BUY"), ("sell", "SHORT")):
        r = setup["dirs"][d]
        b = r["blocks"].get(k)
        if r["state"] == "none" or b is None:
            if b and b.get("hist") and b["hist"]["fired"]:
                h = b["hist"]
                out.append("%s: nessuna operazione in corso. Storico della regola (%s, %gR): scattata %d volte, %d target, %d stop, R medio %s." % (nm, label, rr, h["fired"], h["target"], h["stop"], c2(h["avg_r"], True)))
            continue
        if r["state"] == "expired":
            out.append("%s: la finestra utile per entrare è finita." % nm)
            continue
        if r["state"] == "waiting":
            s = "%s in attesa: scatta se %s. Il prezzo è a %s dal livello. Con stop a %s il rischio è %s per unità; il target a %gR sarebbe %s." % (
                nm, r["level_text"] + " " + P(r["entry"]), fmt_price(r["dist"], gold), P(r["stop"]), fmt_price(r["risk"], gold), rr, P(b["target"]))
        else:
            when = r.get("age_min", 0)
            s = "%s scattato %s fa a %s; stop %s, target a %gR %s." % (
                nm, ("%d minuti" % when) if when < 180 else ("%.1f ore" % (when / 60.0)), P(r["entry"]), P(r["stop"]), rr, P(b["target"]))
            if when > 30:
                s += " Entrare adesso è un altro trade rispetto al segnale originale."
            if b["closed"]:
                s += " Il piano teorico si è già chiuso: %s toccato." % ("target" if b["closed"] == "target" else "stop")
        out.append(s)
        if b.get("mc"):
            m = b["mc"]
            out.append("Time Machine (%s): su 10.000 ripetizioni il target arriva prima nel %.0f%%, lo stop nel %.0f%%, nessuno dei due nel %.0f%%. %s" % (
                nm, m["target"] * 100, m["stop"] * 100, m["none"] * 100, b["verdict"] or ""))
        h = b["hist"]
        if h["fired"]:
            se = (" (incertezza ±%s)" % c2(h["se"])) if h.get("se") is not None else ""
            out.append("Storico reale su %d casi: %d target, %d stop, %d nessuno, R medio %s%s." % (h["fired"], h["target"], h["stop"], h["none"], c2(h["avg_r"], True), se))
        st = b["stance"]
        out.append("Giudizio %s a %gR: %s." % (nm, rr, {
            "favorevole": "FAVOREVOLE, simulazione e storico concordano",
            "sfavorevole": "SFAVOREVOLE",
            "nessun vantaggio": "nessun vantaggio dimostrato",
            "positivo": "storico positivo",
            "negativo": "storico negativo",
            "poco_storico": "pochi casi nello storico per giudicare"}.get(st, st)))
        out.extend(why_lines(nm, d, r, b, info, rr, gold))
    out.append("Non è una previsione: è quello che sarebbe successo ripetendo le ultime barre reali. Notizie e dati macro possono muovere il prezzo in modi che lo storico non contiene. Non è consulenza finanziaria.")
    return out


# ---------------------------------------------------------------- endpoint: panoramica
def api_overview(q):
    sym = q.get("symbol", ["XAUUSD"])[0]
    ys = E.yahoo_symbol(sym)
    now_ts = E.epoch(E.now_utc())
    spot = num(q, "spot", None)
    info = E.price_info(ys, now_ts, spot)
    m = E.mtf(ys, now_ts)
    return {"symbol": sym.upper(), "ysym": ys, "name": E.pretty_name(ys), "gold": E.is_gold(ys), "info": info, "mtf": m,
            "reading": E.mtf_reading(m), "tfs": E.TF_ORDER, "sessions": {k: v["label"] for k, v in E.sessions_for(ys).items()},
            "now_ts": now_ts}


# ---------------------------------------------------------------- endpoint: setup + grafico
def build_setup(ys, now_u, tf, setup, rrs, q, with_mc=True, replays=10000):
    now_ts = E.epoch(now_u)
    bars, _ = E.get_bars(ys, tf, now_ts)
    seed = num(q, "seed", 19, int)
    if setup == "breakout":
        N = bounded(q, "N", 20, 5, 100, int)
        am = bounded(q, "am", 1.0, 0.25, 5.0)
        hold = bounded(q, "hold", DEFAULT_HOLD[tf], 2, 300, int)
        return bars, E.build_breakout(bars, tf, rrs, N, am, hold, replays, seed, with_mc)
    return bars, E.build_session(ys, setup, tf, bars, now_u, rrs, bounded(q, "or", 15, 5, 60, int), replays, seed, with_mc)


def api_setup(q):
    sym = q.get("symbol", ["XAUUSD"])[0]
    ys = E.yahoo_symbol(sym)
    tf = q.get("tf", ["1h"])[0]
    if tf not in E.TF:
        raise ValueError("time frame non valido")
    setup = q.get("setup", ["breakout"])[0]
    rr = bounded(q, "rr", 2.0, 0.25, 20.0)
    rrs = sorted(set(rrs_from(q) + [rr]))
    now_u = E.now_utc()
    now_ts = E.epoch(now_u)
    ck = (ys, tf, setup, tuple(rrs_from(q)), tuple(sorted((k, v[0]) for k, v in q.items() if k in ("N", "am", "hold", "or", "replays", "seed"))))
    hit = SETUP_CACHE.get(ck)
    if hit and time.time() - hit[0] < (12 if ys == "GC=F" else 30) and all("%g" % rr in next(iter(hit[2]["dirs"].values()))["blocks"] for rr in rrs if "dirs" in hit[2]):
        bars, st = hit[1], hit[2]
    else:
        bars, st = build_setup(ys, now_u, tf, setup, rrs, q, True, bounded(q, "replays", 10000, 1000, 20000, int))
        SETUP_CACHE[ck] = (time.time(), bars, st)
        if len(SETUP_CACHE) > 40:  # senza tetto, chi chiede tanti simboli diversi riempie la memoria
            for k in sorted(SETUP_CACHE, key=lambda z: SETUP_CACHE[z][0])[:len(SETUP_CACHE) - 30]:
                SETUP_CACHE.pop(k, None)
    info = E.price_info(ys, now_ts, num(q, "spot", None))
    if q.get("lite", [""])[0] == "1":  # scansione "Opportunità": solo i numeri, senza grafico, casistiche e ventaglio
        slim = st
        if isinstance(st, dict) and "dirs" in st:
            slim = dict(st)
            slim["dirs"] = {d: {k: x for k, x in r.items() if k not in ("cases", "fan")} for d, r in st["dirs"].items()}
        return {"symbol": sym.upper(), "tf": tf, "setup": setup, "rr": rr, "result": slim, "info": info}
    closes = [b[E.C] for b in bars]
    s20, s50 = E.sma_list(closes, 20), E.sma_list(closes, 50)
    cut = max(0, len(bars) - 400)
    chart = {"tf": tf, "sec": E.TF[tf][2], "bars": [list(b) for b in bars[cut:]], "sma20": s20[cut:], "sma50": s50[cut:]}
    return {"symbol": sym.upper(), "tf": tf, "setup": setup, "rr": rr, "rrs": rrs, "result": st, "chart": chart,
            "explanation": explain(E.pretty_name(ys), E.is_gold(ys), info, st, rr, tf), "info": info}


# ---------------------------------------------------------------- segnali e diario
# Il diario dei segnali sta nel BROWSER (localStorage): il server non salva nulla, cosi' puo' girare
# su un servizio online gratuito senza perdere dati quando si riavvia.
def api_signals(q):
    sym = q.get("symbol", ["XAUUSD"])[0]
    ys = E.yahoo_symbol(sym)
    tfs = [t for t in q.get("tfs", ["5m,15m,1h"])[0].split(",") if t in E.TF][:8]
    setups = [s for s in q.get("setups", ["breakout"])[0].split(",") if s][:3]
    rr = bounded(q, "rr", 2.0, 0.25, 20.0)
    now_u = E.now_utc()
    found, errors = [], []
    for setup in setups:
        for tf in tfs:
            if setup != "breakout" and tf not in ("5m",):
                continue
            try:
                bars, st = build_setup(ys, now_u, tf, setup, [rr], q, True, bounded(q, "replays", 3000, 1000, 10000, int))
            except Exception as exc:  # noqa: BLE001
                errors.append("%s %s: %s" % (setup, tf, exc))
                continue
            if st.get("error") or "dirs" not in st:
                continue
            sec = E.TF[tf][2]
            for d, r in st["dirs"].items():
                if r["state"] != "triggered":
                    continue
                fresh = r.get("age_bars", 99) <= 2 if setup == "breakout" else r.get("age_min", 999) <= 30
                b = r["blocks"].get("%g" % rr)
                if not fresh or not b or b["closed"]:
                    continue
                entry_ts = r["trigger_ts"] - sec
                sid = "%s|%s|%s|%s|%d" % (sym.upper(), setup, tf, d, entry_ts)
                found.append({"id": sid, "symbol": sym.upper(), "setup": setup, "tf": tf, "dir": d, "entry": r["entry"],
                              "stop": r["stop"], "target": b["target"], "rr": rr, "stance": b["stance"], "verdict": b.get("verdict"),
                              "trigger_ts": r["trigger_ts"], "entry_ts": entry_ts, "age_min": r.get("age_min", 0),
                              "hold": r.get("age_bars", 0) + r.get("bars_left", 0) if setup != "breakout" else r.get("hold_bars", 24),
                              "label": st["label"]})
    return {"signals": found, "errors": errors, "now_ts": E.epoch(now_u)}


def refresh_journal(items, now_ts):
    cache = {}
    for it in items:
        if it["status"] != "open":
            continue
        ys = E.yahoo_symbol(it["symbol"])
        key = (ys, it["tf"])
        try:
            if key not in cache:
                cache[key] = E.get_bars(ys, it["tf"], now_ts)[0]
            bars = cache[key]
            idx = next((i for i, b in enumerate(bars) if b[0] == it["entry_ts"]), None)
            if idx is None:
                continue
            _, out = E.walk_multi(bars, idx, it["dir"], it["entry"], it["stop"], [it["rr"]], it["hold"])
            o = out[it["rr"]]
            if o[0] in ("target", "stop", "none"):
                it["status"] = o[0]
                it["r"] = round(o[1], 3)
                it["exit_ts"] = bars[min(o[2], len(bars) - 1)][0]
        except Exception:  # noqa: BLE001
            continue
    return items


JOURNAL_KEYS = ("id", "symbol", "tf", "setup", "dir", "entry", "stop", "rr", "hold", "entry_ts", "status")


TICK = {"last": 0.0, "running": False, "result": "mai eseguito"}
TICK_LOCK = threading.Lock()


def _tick_worker():
    import contextlib
    import io
    buf = io.StringIO()
    try:
        import notify as N
        try:
            cal = api_calendar({}).get("events")
        except Exception:  # noqa: BLE001  (senza calendario si fanno comunque i segnali)
            cal = None
        with contextlib.redirect_stdout(buf):
            N.run(os.environ.get("NTFY_TOPIC", "").strip(), cal)
        TICK["result"] = buf.getvalue().strip().splitlines()[-1:] or ["ok"]
    except Exception as exc:  # noqa: BLE001
        TICK["result"] = ["errore: %s" % exc]
    finally:
        TICK["running"] = False


def api_scan(q):
    import scanner as SC
    return SC.snapshot()


def api_tick(q):
    """Controllo dei segnali + avvisi ntfy. Lo chiama un servizio esterno ogni minuto (sveglia anche il server)."""
    try:  # scanner di titoli e cripto: acceso (i suoi segnali stanno nello stesso elenco dell'oro); si spegne con la variabile d'ambiente SCANNER=0
        if os.environ.get("SCANNER", "1") == "0":
            raise RuntimeError("scanner spento")
        import scanner as SC
        SC.maybe_start()
    except Exception:  # noqa: BLE001  (se non parte, i segnali sull'oro vanno avanti lo stesso)
        pass
    with TICK_LOCK:
        now = time.time()
        if TICK["running"] or now - TICK["last"] < 45:
            return {"ok": True, "skipped": True, "last": TICK["result"]}
        TICK["running"], TICK["last"] = True, now
    threading.Thread(target=_tick_worker, daemon=True).start()
    return {"ok": True, "started": True, "last": TICK["result"], "ntfy": bool(os.environ.get("NTFY_TOPIC"))}


CAL = {"t": 0.0, "data": None}
CAL_FF = ("https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json")
CAL_BACKUP = "https://raw.githubusercontent.com/ruspinluca-143/xau-analisi/dati/calendar.json"  # copia aggiornata da GitHub Actions
UA = {"User-Agent": "Mozilla/5.0 (compatible; xau-analisi/1.0)", "Accept": "application/json"}


def _get_json(url, why):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=12) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        why.append("%s: %s" % (url.split("/")[2], str(exc)[:70]))
        return None


def cal_events(arr):
    out = []
    for x in arr:
        if x.get("impact") != "High":
            continue
        try:
            ts = int(datetime.datetime.fromisoformat(x["date"]).timestamp())
        except (KeyError, ValueError):
            continue
        out.append({"ts": ts, "country": str(x.get("country", ""))[:4], "title": str(x.get("title", ""))[:120],
                    "forecast": str(x.get("forecast", ""))[:20], "previous": str(x.get("previous", ""))[:20]})
    return out


def api_calendar(q):
    """Eventi economici 'rossi' (impatto alto) dei prossimi giorni, da un calendario pubblico gratuito.
    Prima la fonte diretta; se il server non riesce a raggiungerla, la copia che GitHub Actions tiene aggiornata nel ramo 'dati'.
    Cache di 30 minuti; se nessuna fonte risponde si riusa l'ultima copia buona."""
    now = time.time()
    if CAL["data"] is not None and now - CAL["t"] < 1800:
        return CAL["data"]
    why, events, src = [], [], ""
    got = False
    for u in CAL_FF:
        arr = _get_json(u, why)
        if arr is not None:
            got = True
            events += cal_events(arr)
    if got:
        src = "calendario pubblico"
    else:
        bk = _get_json(CAL_BACKUP, why)
        if isinstance(bk, dict) and isinstance(bk.get("events"), list) and bk["events"]:
            events, got, src = bk["events"], True, "copia del calendario pubblico (aggiornata da GitHub)"
    if not got:
        if CAL["data"] is not None:
            return CAL["data"]
        raise ValueError("calendario non raggiungibile adesso (%s)" % "; ".join(why)[:300])
    events.sort(key=lambda e: e["ts"])
    CAL["data"], CAL["t"] = {"events": events, "updated": int(now), "source": src}, now
    return CAL["data"]


PM = {"t": 0.0, "data": None}
MESI_IT = {"January": "gennaio", "February": "febbraio", "March": "marzo", "April": "aprile", "May": "maggio", "June": "giugno", "July": "luglio",
           "August": "agosto", "September": "settembre", "October": "ottobre", "November": "novembre", "December": "dicembre"}


def api_polymarket(q):
    """Probabilità che il mercato di previsione Polymarket assegna alle prossime decisioni della Fed (dati pubblici, sola lettura).
    Sono scommesse con soldi veri: un termometro delle aspettative, non una previsione nostra. Cache di 10 minuti."""
    now = time.time()
    if PM["data"] is not None and now - PM["t"] < 600:
        return PM["data"]
    why = []
    j = _get_json("https://gamma-api.polymarket.com/public-search?q=Fed%20Decision&limit_per_type=14", why)
    if not j or "events" not in j:
        if PM["data"] is not None:
            return PM["data"]
        raise ValueError("Polymarket non raggiungibile adesso (%s)" % "; ".join(why)[:200])
    out = []
    for e in j["events"]:
        title = str(e.get("title", ""))
        if not title.lower().startswith("fed decision in"):
            continue
        try:
            end = int(datetime.datetime.fromisoformat(str(e["endDate"]).replace("Z", "+00:00")).timestamp())
        except (KeyError, ValueError):
            continue
        if end < now:
            continue
        opts = []
        for m in e.get("markets") or []:
            ql = str(m.get("question", "")).lower()
            try:
                pr = m.get("outcomePrices")
                pr = json.loads(pr) if isinstance(pr, str) else pr
                p = float(pr[0])
            except (TypeError, ValueError, IndexError):
                continue
            if "decrease" in ql and "50" in ql:
                lab, order = "Taglio di 0,50 o più", 0
            elif "decrease" in ql:
                lab, order = "Taglio di 0,25", 1
            elif "no change" in ql:
                lab, order = "Tassi invariati", 2
            elif "increase" in ql and "50" in ql:
                lab, order = "Rialzo di 0,50 o più", 4
            elif "increase" in ql:
                lab, order = "Rialzo di 0,25", 3
            else:
                continue
            opts.append((order, {"label": lab, "p": round(p, 4)}))
        if not opts:
            continue
        month = MESI_IT.get(title.split(" in ")[-1].strip("? "), title)
        out.append({"title": "Riunione della Fed di %s" % month, "end": end, "volume": round(float(e.get("volume") or 0)),
                    "options": [o for _, o in sorted(opts, key=lambda x: x[0])]})
    out.sort(key=lambda m: m["end"])
    if not out:
        raise ValueError("nessun mercato sulla Fed trovato")
    PM["data"], PM["t"] = {"meetings": out[:3], "updated": int(now), "source": "Polymarket"}, now
    return PM["data"]


def api_log(q):
    """Registro dei segnali trovati dal server (oro + scanner di titoli e cripto). Dopo un riavvio si ripristina dal ramo dati."""
    try:
        import notify as N
        items = N.load_log()
    except Exception:  # noqa: BLE001
        items = []
    if os.environ.get("SCANNER", "1") != "0":
        try:
            import scanner as SC
            items = list(items) + SC.history()
        except Exception:  # noqa: BLE001
            pass
    return sorted(items, key=lambda x: x.get("entry_ts", 0))


def api_journal(body):
    now_ts = E.epoch(E.now_utc())
    items = []
    for x in (body.get("items") or [])[:500]:
        if isinstance(x, dict) and all(k in x for k in JOURNAL_KEYS) and x["status"] in ("open", "target", "stop", "none") \
                and all(isinstance(x[k], (int, float)) for k in ("entry", "stop", "rr", "hold", "entry_ts")):
            items.append(x)
    if len({(str(x["symbol"]), str(x["tf"])) for x in items if x["status"] == "open"}) > 12:
        raise ValueError("Troppi strumenti diversi aperti nel diario.")
    items = refresh_journal(items, now_ts)
    items = sorted(items, key=lambda x: x["entry_ts"], reverse=True)
    closed = [x for x in items if x["status"] in ("target", "stop", "none")]

    def stats(sub):
        n = len(sub)
        if not n:
            return {"n": 0}
        w = sum(1 for x in sub if x["status"] == "target")
        l = sum(1 for x in sub if x["status"] == "stop")
        return {"n": n, "target": w, "stop": l, "none": n - w - l, "win_rate": w / n, "avg_r": sum(x["r"] for x in sub) / n,
                "total_r": sum(x["r"] for x in sub)}

    eq, run = [], 0.0
    for x in sorted(closed, key=lambda z: z.get("exit_ts", z["entry_ts"])):
        run += x["r"]
        eq.append([x.get("exit_ts", x["entry_ts"]), round(run, 3)])
    groups = {}
    for x in closed:
        groups.setdefault(x["stance"], []).append(x)
    return {"items": items, "stats": stats(closed), "by_stance": {k: stats(v) for k, v in groups.items()}, "equity": eq,
            "open": sum(1 for x in items if x["status"] == "open")}


# ---------------------------------------------------------------- Claude (opzionale)
def api_claude(body):
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return {"error": "Chiave non impostata. Per attivare la chat imposta la variabile d'ambiente ANTHROPIC_API_KEY e riavvia l'app."}
    question = (body.get("question") or "").strip()[:2000]
    context = json.dumps(body.get("context") or {}, ensure_ascii=False)[:12000]
    payload = {
        "model": os.environ.get("XAU_MODEL", "claude-sonnet-5-5"), "max_tokens": 1024,
        "system": ("Sei l'assistente di analisi di un trader di oro (XAUUSD). Rispondi in italiano, breve e chiaro. "
                   "Fai SOLO analisi: non dare mai ordini, lotti o istruzioni operative, non promettere risultati. "
                   "Usa solo i numeri del contesto; se non bastano, dillo. Ricorda quando serve che non è consulenza finanziaria."),
        "messages": [{"role": "user", "content": "Contesto dell'analisi (JSON):\n%s\n\nDomanda: %s" % (context, question)}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(payload).encode("utf-8"), method="POST",
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.load(r)
        return {"answer": "".join(c.get("text", "") for c in res.get("content", []))}
    except Exception as exc:  # noqa: BLE001
        return {"error": "Chiamata a Claude non riuscita: %s" % exc}


NOTIF_TEST = {"t": 0.0}


def api_notifstatus(q):
    """Stato delle notifiche sul telefono: collegate o no e ultimi invii (senza testo dei messaggi né nome del canale)."""
    import notify as N
    return {"ntfy": bool(os.environ.get("NTFY_TOPIC", "").strip()), "events": N.events()[-15:][::-1], "started": int(N.STARTED), "now": int(time.time()),
            "reminders": N.reminder_state(), "token": bool(N.NTFY_TOKEN), "telegram": N.telegram_on(), "prefs": N.prefs(), "pin_required": bool(os.environ.get("PREFS_PIN", "").strip()), "pause": N.cooling(), "budget": [N.BUDGET["n"], N.DAILY_MAX],
            "last_tick": TICK["result"], "tick_age": int(time.time() - TICK["last"]) if TICK["last"] else None}


def api_prefs(body):
    """Scelte per le notifiche (time frame su cui avvisare, riepilogo serale). Con la variabile PREFS_PIN impostata serve il PIN."""
    import notify as N
    pin = os.environ.get("PREFS_PIN", "").strip()
    if pin and not hmac.compare_digest(str(body.get("pin", "")).encode("utf-8"), pin.encode("utf-8")):
        raise ValueError("PIN non valido.")
    tfs = body.get("tfs")
    if not isinstance(tfs, list) or any(t not in E.TF_ORDER for t in tfs):
        raise ValueError("Time frame non validi.")
    return {"ok": True, "prefs": N.save_prefs(tfs, body.get("evening", True))}


def api_notiftest(body):
    """Notifica di prova (al massimo una ogni 5 minuti per tutti): serve a vedere subito se il telefono la riceve."""
    import notify as N
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic and not N.telegram_on():
        raise ValueError("Le notifiche non sono collegate sul server (manca NTFY_TOPIC, oppure TELEGRAM_TOKEN e TELEGRAM_CHAT_ID).")
    now = time.time()
    if now - NOTIF_TEST["t"] < 300:
        raise ValueError("Prova già inviata da poco: aspetta qualche minuto.")
    NOTIF_TEST["t"] = now
    N.TOPIC = topic
    try:
        N.send("Prova avvisi XAU", "Se leggi questo messaggio le notifiche funzionano. Solo analisi, nessun ordine.", "bell", essential=True)
    except RuntimeError as exc:  # pausa o limite: il messaggio è scritto da noi
        raise ValueError(str(exc))
    except Exception:  # noqa: BLE001
        e = N.events()[-1] if N.events() else {}
        raise ValueError("Il servizio ha rifiutato l'invio: " + str(e.get("err", "errore sconosciuto")))
    return {"ok": True}


import market as MK  # noqa: E402  (quadro di mercato, sessioni, reazione alla Fed, confronto con la regola, livelli personali)

ROUTES = {"/api/overview": api_overview, "/api/setup": api_setup, "/api/signals": api_signals, "/api/tick": api_tick, "/api/log": api_log, "/api/calendar": api_calendar, "/api/scan": api_scan, "/api/polymarket": api_polymarket,
          "/api/context": MK.api_context, "/api/sessions": MK.api_sessions, "/api/fomc": MK.api_fomc, "/api/benchmark": MK.api_benchmark, "/api/notifstatus": api_notifstatus}
POST_ROUTES = {"/api/claude": api_claude, "/api/journal": api_journal, "/api/notiftest": api_notiftest, "/api/prefs": api_prefs}
PUBLIC_FILES = ("/api/tick", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png")
PASSWORD = os.environ.get("XAU_PASSWORD", "")
HITS = {}  # indirizzo -> orari delle ultime richieste
HITS_LOCK = threading.Lock()
RATE_PER_MIN = 90


def too_many(ip):
    now = time.time()
    with HITS_LOCK:
        lst = [t for t in HITS.get(ip, []) if now - t < 60]
        lst.append(now)
        HITS[ip] = lst
        if len(HITS) > 5000:
            for k in [k for k, v in HITS.items() if not v or now - v[-1] > 60]:
                HITS.pop(k, None)
        return len(lst) > RATE_PER_MIN
MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silenzioso
        pass

    def _ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        # il PRIMO valore lo può scrivere il client (basterebbe cambiarlo a ogni richiesta per aggirare il limite): vale l'ULTIMO, aggiunto dal proxy
        return (fwd.split(",")[-1].strip() if fwd else self.client_address[0]) or "?"

    def _authorized(self):
        if not PASSWORD or urlparse(self.path).path in PUBLIC_FILES:
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                pw = base64.b64decode(h[6:]).decode("utf-8").partition(":")[2]
                return hmac.compare_digest(pw.encode("utf-8"), PASSWORD.encode("utf-8"))
            except Exception:  # noqa: BLE001
                return False
        return False

    def _deny(self):
        body = b"Serve la password."
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="XAU analisi"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _sec(self):
        """Intestazioni di sicurezza: niente script o risorse da altri siti, niente pagina dentro frame altrui, niente indovinare il tipo di file."""
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                         "connect-src 'self' https://raw.githubusercontent.com; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self._sec()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(clean(obj), ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        if not self._authorized():
            return self._deny()
        u = urlparse(self.path)
        if u.path.startswith("/api/") and u.path != "/api/health" and too_many(self._ip()):
            self._json(429, {"error": "Troppe richieste: aspetta un minuto."})
            return
        if u.path in ROUTES:
            try:
                self._json(200, ROUTES[u.path](parse_qs(u.query)))
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                print("errore %s: %s" % (u.path, exc))  # il dettaglio resta nei log del server, non va al visitatore
                self._json(500, {"error": "Errore temporaneo del server o dei dati: riprova tra poco."})
            return
        if u.path == "/api/health":
            self._json(200, {"ok": True, "claude": bool(os.environ.get("ANTHROPIC_API_KEY"))})
            return
        rel = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        full = os.path.normpath(os.path.join(WEB, rel))
        if os.path.splitext(full)[1] == ".md" and os.path.basename(full) != "manuale.md":  # tra i file di testo si serve solo il manuale d'uso
            self._send(404, b"Non trovato", "text/plain; charset=utf-8")
            return
        if not full.startswith(WEB) or not os.path.isfile(full) or os.path.splitext(full)[1] not in MIME:
            self._send(404, b"Non trovato", "text/plain; charset=utf-8")
            return
        with open(full, "rb") as fh:
            self._send(200, fh.read(), MIME.get(os.path.splitext(full)[1], "application/octet-stream"))

    def do_POST(self):
        if not self._authorized():
            return self._deny()
        fn = POST_ROUTES.get(urlparse(self.path).path)
        if fn is not None and too_many(self._ip()):
            self._json(429, {"error": "Troppe richieste: aspetta un minuto."})
            return
        if fn is None:
            self._send(404, b"Non trovato", "text/plain; charset=utf-8")
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 400000:
                raise ValueError("richiesta troppo grande")
            body = json.loads(self.rfile.read(n) or b"{}")
            self._json(200, fn(body))
        except ValueError as exc:  # richiesta non valida (anche JSON malformato): il messaggio è scritto da noi
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            print("errore POST %s: %s" % (self.path, exc))  # il dettaglio resta nei log del server
            self._json(500, {"error": "Errore temporaneo del server: riprova tra poco."})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=None, help="indirizzo (default 127.0.0.1; online 0.0.0.0)")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--open", action="store_true")
    a = ap.parse_args()
    online = os.environ.get("XAU_ONLINE") == "1"  # lo imposta il Dockerfile per la versione online
    host = a.host or ("0.0.0.0" if online else "127.0.0.1")
    port = a.port or int(os.environ.get("PORT") or 8765)
    if host not in ("127.0.0.1", "localhost") and os.environ.get("ANTHROPIC_API_KEY") and not PASSWORD:
        raise SystemExit("Online con la chiave di Claude serve anche XAU_PASSWORD (altrimenti chiunque userebbe la tua chiave). Mi fermo.")
    srv = ThreadingHTTPServer((host, port), Handler)
    url = "http://127.0.0.1:%d" % port
    print("XAU App pronta su %s:%d  (solo analisi, nessun broker%s). Ctrl+C per chiudere." % (host, port, ", protetta da password" if PASSWORD else ", accesso libero"))
    if a.open and host in ("127.0.0.1", "localhost"):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
