"""Server locale di xau-app. SOLO ANALISI: nessun broker, nessun ordine.

    python server.py            ->  http://127.0.0.1:8765
    python server.py --open     ->  apre anche il browser

Solo libreria standard. Ascolta solo su 127.0.0.1 (il tuo computer).
"""
import argparse
import base64
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
DEFAULT_HOLD = {"1m": 60, "5m": 36, "15m": 24, "1h": 24, "4h": 18, "1d": 10, "1w": 8}
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
    if hit and time.time() - hit[0] < 30 and all("%g" % rr in next(iter(hit[2]["dirs"].values()))["blocks"] for rr in rrs if "dirs" in hit[2]):
        bars, st = hit[1], hit[2]
    else:
        bars, st = build_setup(ys, now_u, tf, setup, rrs, q, True, bounded(q, "replays", 10000, 1000, 20000, int))
        SETUP_CACHE[ck] = (time.time(), bars, st)
    info = E.price_info(ys, now_ts, num(q, "spot", None))
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
    tfs = [t for t in q.get("tfs", ["5m,15m,1h"])[0].split(",") if t in E.TF][:4]
    setups = [s for s in q.get("setups", ["breakout"])[0].split(",") if s][:3]
    rr = bounded(q, "rr", 2.0, 0.25, 20.0)
    now_u = E.now_utc()
    found, errors = [], []
    for setup in setups:
        for tf in tfs:
            if setup != "breakout" and tf not in ("5m", "15m"):
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


def api_journal(body):
    now_ts = E.epoch(E.now_utc())
    items = []
    for x in (body.get("items") or [])[:500]:
        if isinstance(x, dict) and all(k in x for k in JOURNAL_KEYS) and x["status"] in ("open", "target", "stop", "none") \
                and all(isinstance(x[k], (int, float)) for k in ("entry", "stop", "rr", "hold", "entry_ts")):
            items.append(x)
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


ROUTES = {"/api/overview": api_overview, "/api/setup": api_setup, "/api/signals": api_signals}
POST_ROUTES = {"/api/claude": api_claude, "/api/journal": api_journal}
PUBLIC_FILES = ("/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png")
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
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silenzioso
        pass

    def _ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return (fwd.split(",")[0].strip() if fwd else self.client_address[0]) or "?"

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

    def _send(self, code, body, ctype):
        self.send_response(code)
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
                self._json(500, {"error": str(exc)})
            return
        if u.path == "/api/health":
            self._json(200, {"ok": True, "claude": bool(os.environ.get("ANTHROPIC_API_KEY"))})
            return
        rel = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        full = os.path.normpath(os.path.join(WEB, rel))
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
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})


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
