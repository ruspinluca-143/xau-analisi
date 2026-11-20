"""Scanner di titoli e cripto: cerca i segnali di breakout con vantaggio dimostrato (solo analisi, nessun ordine).

Controlla una lista di circa 100 simboli (grandi titoli USA e cripto principali) sul giornaliero e sull'ora, buy e short, con tutti i target
2R, 3R e 4R. Un segnale entra nell'elenco solo se simulazione e storico concordano (come per l'oro). Due livelli: "netto" = almeno 20 casi storici e R medio
sopra 2 volte l'errore statistico (più severo, perché guardando tanti simboli qualche falso segnale capita per caso); "possibile" = il criterio normale
dell'oro (almeno 10 casi, R medio sopra l'errore statistico). Gli avvisi sul telefono partono per entrambi i livelli (il titolo dice "possibile" per il meno severo).

    python scanner.py --dry --limit 10    prova su 10 simboli, senza salvare né inviare
    python scanner.py                     scansione completa di giornaliero e ora
"""
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E  # noqa: E402
import persist as PS  # noqa: E402

STOCKS = ("AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO COST NFLX AMD PEP ADBE CSCO TMUS CMCSA INTC QCOM TXN AMGN INTU AMAT HON ISRG BKNG SBUX GILD ADI "
          "VRTX MDLZ REGN LRCX PANW ADP MU KLAC SNPS CDNS PYPL CRWD MELI MAR CSX ORLY ABNB CTAS MRVL NXPI FTNT PCAR WDAY ROP MNST CHTR AEP MCHP PAYX "
          "ADSK EXC ROST IDXX LULU FAST DDOG EA TEAM DXCM TTD ZS MDB JPM V MA UNH XOM LLY JNJ WMT PG HD ORCL CRM BAC KO MRK ABBV CVX NKE DIS MCD T PFE "
          "BRK-B GS CAT BA IBM UBER PLTR COIN").split()
CRYPTO = "BTC-USD ETH-USD SOL-USD XRP-USD BNB-USD DOGE-USD ADA-USD AVAX-USD".split()
SYMBOLS = STOCKS + CRYPTO
HOLD = {"1h": 24, "1d": 10}
REPS = 1500
MIN_CASES = 20
SE_MULT = 2.0
WORKERS = 3
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except OSError:
    pass
OUT = os.environ.get("SCAN_FILE", os.path.join(DATA_DIR, "scan.json"))
HIST_FILE = os.environ.get("SCAN_HIST_FILE", os.path.join(DATA_DIR, "scan_hist.json"))  # tutti i segnali trovati: restano (con l'esito) anche quando la scansione dopo non li vede più
TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
LOCK = threading.Lock()
STATE = {"running": False, "runs": {}, "signals": {"1d": [], "1h": []}, "seen": [], "errors": {}, "loaded": False, "hist": {}, "last_resolve": 0, "resolving": False}


def _load():
    if STATE["loaded"]:
        return
    STATE["loaded"] = True
    PS.restore(OUT, "scan.json")  # dopo un riavvio si riparte dalla memoria salvata: niente avvisi doppi
    PS.restore(HIST_FILE, "scan_hist.json")
    try:
        with open(HIST_FILE, encoding="utf-8") as fh:
            STATE["hist"] = {x["id"]: x for x in json.load(fh)}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        with open(OUT, encoding="utf-8") as fh:
            d = json.load(fh)
        for k in ("runs", "signals", "seen"):
            if k in d:
                STATE[k] = d[k]
    except (OSError, ValueError):
        pass


def _save():
    try:
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump({"runs": STATE["runs"], "signals": STATE["signals"], "seen": STATE["seen"][-800:]}, fh, ensure_ascii=False, separators=(",", ":"))
        PS.push(OUT, "scan.json", min_gap=300)
    except OSError:
        pass
    _save_hist()


def _save_hist():
    cut = time.time() - 120 * 86400
    items = sorted((x for x in STATE["hist"].values() if x.get("entry_ts", 0) > cut), key=lambda x: x["entry_ts"])[-1500:]
    STATE["hist"] = {x["id"]: x for x in items}
    try:
        with open(HIST_FILE, "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False, separators=(",", ":"))
        PS.push(HIST_FILE, "scan_hist.json", min_gap=300)
    except OSError:
        pass


def _as_log_item(s):
    """Il segnale dello scanner nello stesso formato del registro dell'oro, così compare tra i "Segnali automatici"."""
    return {"id": s["id"], "symbol": s["sym"], "setup": "breakout", "tf": s["tf"], "label": "Breakout 20 barre (%s)" % s["tf"], "dir": s["dir"], "rr": s["rr"],
            "entry": s["entry"], "stop": s["stop"], "target": s["target"], "entry_ts": s["entry_ts"], "hold": HOLD[s["tf"]], "stance": "favorevole",
            "tier": s["tier"], "sim_target": s["sim_target"], "sim_stop": s["sim_stop"], "hist_n": s["hist_n"], "hist_r": s["hist_r"],
            "favs": s.get("favs", []), "status": "open", "r": None, "notified": False, "out_sent": False, "src": "scanner"}


def history():
    _load()
    return list(STATE["hist"].values())


def flush():
    """Invia in UN SOLO messaggio i segnali favorevoli non ancora notificati (anche quelli rimasti indietro per un errore 429) e, in un altro, gli esiti nuovi."""
    _load()
    if not TOPIC:
        return 0
    import notify as N
    if N.cooling():
        return 0
    now = time.time()
    sent = 0
    with LOCK:
        pend = sorted((x for x in STATE["hist"].values() if x.get("status") == "open" and not x.get("notified") and now - x.get("entry_ts", 0) < 6 * 3600 and x.get("rr") in E.DEFAULT_RRS and x.get("tf") in N.prefs()["tfs"]),
                      key=lambda x: (x.get("tier") != "netto", -x.get("entry_ts", 0)))
    if pend:
        def one(x):
            return "%s %s %s - target %gR%s: ingresso %s, stop %s, target %s (simulazione %.0f%%, storico %d casi, R %+.2f)" % (
                x["symbol"], "BUY" if x["dir"] == "buy" else "SHORT", x["tf"], x["rr"], "" if x.get("tier") == "netto" else " (possibile)", _fmt(x["entry"]), _fmt(x["stop"]),
                _fmt(x["target"]), x["sim_target"] * 100, x["hist_n"], x["hist_r"])
        try:
            if len(pend) == 1:
                x = pend[0]
                _send("TITOLO %s - %s %s - target %gR%s" % (x["symbol"], "BUY" if x["dir"] == "buy" else "SHORT", x["tf"], x["rr"], "" if x.get("tier") == "netto" else " (possibile)"),
                      "Segnale favorevole su %s (%s), livello %s.\n%s\nPrezzi dei dati (possono avere ritardo). Solo analisi, decidi tu." % (
                          x["symbol"], x["tf"], "netto" if x.get("tier") == "netto" else "possibile", one(x)), "chart_with_upwards_trend" if x["dir"] == "buy" else "chart_with_downwards_trend")
            else:
                shown = pend[:10]
                _send("%d segnali favorevoli su titoli e cripto" % len(pend), "\n".join(one(x) for x in shown) + ("\n...e altri %d nell'app (Avvisi, Segnali automatici)." % (len(pend) - len(shown)) if len(pend) > len(shown) else "")
                      + "\nPrezzi dei dati (possono avere ritardo). Solo analisi, decidi tu.", "chart_with_upwards_trend")
            with LOCK:
                for x in pend:
                    x["notified"] = True
                _save_hist()
            sent += 1
        except Exception as exc:  # noqa: BLE001
            print("  invio non riuscito (si riprova): %s" % exc)
    return sent


def resolve_open(force=False):
    """Segue i segnali dello scanner fino a target, stop o fine finestra (al massimo ogni 5 minuti) e avvisa dell'esito."""
    _load()
    now = time.time()
    with LOCK:
        if STATE["resolving"] or (not force and now - STATE["last_resolve"] < 300):
            return 0
        STATE["resolving"], STATE["last_resolve"] = True, now
        items = [x for x in STATE["hist"].values() if x.get("status") == "open"]
    done = 0
    try:
        flush()  # riprova gli avvisi rimasti indietro per un errore 429
        if items:
            import notify as N
            closed = N.resolve(items, None, int(now))
            done = len(closed)
            outs = [it for it in STATE["hist"].values() if it.get("notified") and not it.get("out_sent") and it.get("status") in ("target", "stop", "none") and TOPIC and not N.cooling()]
            if outs:
                try:
                    W = {"target": "TARGET preso", "stop": "STOP preso", "none": "finestra finita"}
                    lines = ["%s %s %s: %s (%+.2f R)" % (it["symbol"], "BUY" if it["dir"] == "buy" else "SHORT", it["tf"], W.get(it["status"], it["status"]), it["r"] or 0.0) for it in outs]
                    _send(("ESITO TITOLO %s - %s" % (outs[0]["symbol"], W.get(outs[0]["status"], ""))) if len(outs) == 1 else "%d esiti su titoli e cripto" % len(outs), "\n".join(lines) + "\nSolo analisi.",
                          "white_check_mark" if len(outs) == 1 and outs[0]["status"] == "target" else "bell")
                    for it in outs:
                        it["out_sent"] = True
                except Exception as exc:  # noqa: BLE001
                    print("  esiti non inviati (si riprova): %s" % exc)
            if closed or outs:
                with LOCK:
                    _save_hist()
    finally:
        with LOCK:
            STATE["resolving"] = False
    return done


def is_crypto(sym):
    return sym.endswith("-USD")


def complete(sym, ts, now_ts):
    """La barra giornaliera è chiusa? Titoli USA: sessione di 6,5 ore dall'apertura; cripto: 24 ore."""
    return now_ts >= ts + (86400 if is_crypto(sym) else 23400)


def scan_symbol(sym, tf, now_ts):
    """Segnali freschi con vantaggio netto per un simbolo e un time frame."""
    ys = E.yahoo_symbol(sym)
    try:
        bars, _ = E.get_bars(ys, tf, now_ts)
        if tf == "1d" and bars and not complete(sym, bars[-1][0], now_ts):
            bars = bars[:-1]
        if tf == "1h":
            bars = bars[-4000:]
        if len(bars) < 120:
            return []
        st = E.build_breakout(bars, tf, E.DEFAULT_RRS, 20, 1.0, HOLD[tf], REPS, 19, True)
    finally:
        with E._lock:  # libero la memoria: i dati di centinaia di simboli non devono restare in cache
            for k in [k for k in E._cache if k[0] == ys]:
                del E._cache[k]
    if st.get("error") or "dirs" not in st:
        return []
    sec = E.TF[tf][2]
    out = []
    for d, r in st["dirs"].items():
        if r["state"] != "triggered" or r.get("age_bars", 99) > 2:
            continue
        best, favs = None, []
        for rr in E.DEFAULT_RRS:
            b = r["blocks"].get("%g" % rr)
            if not b or b["closed"] or not b.get("mc") or b["stance"] != "favorevole":
                continue
            h = b["hist"]
            se = h.get("se")
            net = h["fired"] >= MIN_CASES and se is not None and h["avg_r"] > SE_MULT * se
            favs.append([rr, b["target"]])
            exp = min(b["mc"]["avg_r"], h["avg_r"])
            if best is None or (net, exp) > (best[4], best[0]):
                best = (exp, rr, b, h, net)
        if best:
            exp, rr, b, h, net = best
            ts = r["trigger_ts"] - sec
            out.append({"id": "%s|%s|%s|%d" % (sym, tf, d, ts), "sym": sym, "tf": tf, "dir": d, "rr": rr, "entry": r["entry"], "stop": r["stop"], "target": b["target"],
                        "entry_ts": ts, "age_bars": r.get("age_bars", 0), "sim_target": round(b["mc"]["target"], 3), "sim_stop": round(b["mc"]["stop"], 3),
                        "hist_n": h["fired"], "hist_r": round(h["avg_r"], 3), "hist_se": round(h["se"], 3) if h.get("se") is not None else None, "favs": favs, "tier": "netto" if net else "possibile"})
    return out


def _send(title, body, tags):
    """Un solo canale di invio per tutta l'app (notify.send): pausa dopo un 429, token facoltativo, registro degli invii."""
    import notify as N
    N.TOPIC = N.TOPIC or TOPIC
    return N.send(title.encode("ascii", "ignore").decode("ascii"), body, tags)


def _fmt(x):
    return ("{:,.2f}".format(x)).replace(",", "X").replace(".", ",").replace("X", ".") if x < 1000 else ("{:,.0f}".format(x)).replace(",", ".")


def scan(tfs, limit=None, dry=False):
    """Scansione completa dei time frame indicati. Restituisce i segnali nuovi."""
    _load()
    now_ts = int(time.time())
    syms = SYMBOLS[:limit] if limit else SYMBOLS
    new = []
    for tf in tfs:
        t0, found, errors = time.time(), [], []

        def one(sym):
            try:
                return scan_symbol(sym, tf, now_ts)
            except Exception as exc:  # noqa: BLE001
                errors.append("%s: %s" % (sym, str(exc)[:60]))
                return []
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for res in ex.map(one, syms):
                found += res
        found.sort(key=lambda s: (s["tier"] != "netto", -(s["sim_target"] - s["sim_stop"] + s["hist_r"])))
        with LOCK:
            STATE["signals"][tf] = found
            STATE["runs"][tf] = {"t": now_ts, "checked": len(syms) - len(errors), "errors": len(errors), "secs": int(time.time() - t0),
                                 "win": STATE["runs"].get(tf, {}).get("win")}
            STATE["errors"][tf] = errors[:5]
            if not STATE["runs"][tf]["checked"]:  # fonte non raggiungibile: riprovo tra 10 minuti, non a ogni minuto
                STATE["runs"][tf]["retry"] = now_ts + 600
        fresh = [s for s in found if s["id"] not in STATE["seen"]]
        new += fresh  # avviso sul telefono per ogni segnale favorevole (netto o possibile)
        with LOCK:
            for s in found:  # il segnale resta nel registro anche quando la scansione dopo non lo vede più
                if s["id"] not in STATE["hist"]:
                    STATE["hist"][s["id"]] = _as_log_item(s)
        print("%s: %d simboli controllati, %d errori, %d segnali (%d nuovi) in %ds" % (tf, len(syms) - len(errors), len(errors), len(found), len(fresh), time.time() - t0))
    if not dry:
        with LOCK:
            STATE["seen"] += [s["id"] for s in new]
            _save()
        sent = flush()
        print("Notifiche inviate: %d" % sent)
    return new


def due(now=None):
    """Quali time frame vanno controllati adesso. Giornaliero: dopo la chiusura di Wall Street (>=21:30 UTC) e al mattino (>=06:30 UTC), una volta per finestra.
    Ora: ogni ora dal lunedì al venerdì tra le 14:00 e le 21:59 UTC. La prima volta in assoluto, tutti e due."""
    _load()
    import datetime as dt
    now = now or dt.datetime.now(dt.timezone.utc)
    ts, key, hm = int(now.timestamp()), now.strftime("%Y-%m-%d"), now.hour * 60 + now.minute
    runs, out = STATE["runs"], []
    win = key + "pm" if hm >= 21 * 60 + 30 else key + "am" if hm >= 6 * 60 + 30 else None
    wait = lambda k: ts < runs.get(k, {}).get("retry", 0)  # dopo un tentativo senza dati si aspettano 10 minuti
    if (not runs.get("1d") or (win and runs["1d"].get("win") != win)) and not wait("1d"):
        out.append(("1d", win))
    if (not runs.get("1h") or (now.weekday() < 5 and 14 * 60 <= hm < 22 * 60 and ts - runs["1h"].get("t", 0) >= 3300)) and not wait("1h"):
        out.append(("1h", None))
    return out


def maybe_start():
    """Chiamata a ogni controllo automatico (ogni minuto): se è ora, avvia la scansione in un thread."""
    threading.Thread(target=resolve_open, daemon=True).start()  # esiti dei segnali già trovati (ogni 5 minuti al massimo)
    with LOCK:
        if STATE["running"]:
            return False
        todo = due()
        if not todo:
            return False
        STATE["running"] = True

    def work():
        try:
            for tf, win in todo:
                scan([tf])
                if win and STATE["runs"][tf].get("checked"):
                    STATE["runs"][tf]["win"] = win
                    _save()
        except Exception as exc:  # noqa: BLE001
            print("Scanner: errore %s" % exc)
        finally:
            STATE["running"] = False
    threading.Thread(target=work, daemon=True).start()
    return True


def snapshot():
    _load()
    sigs = [s for tf in ("1d", "1h") for s in STATE["signals"].get(tf, [])]
    return {"running": STATE["running"], "runs": STATE["runs"], "signals": sigs, "symbols": len(SYMBOLS), "errors": STATE["errors"]}


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    scan(["1d", "1h"], limit=lim, dry=dry)
    for s in snapshot()["signals"]:
        print(" ", s["tier"], s["sym"], s["tf"], s["dir"], "%gR" % s["rr"], "ingresso", s["entry"], "stop", s["stop"], "target", s["target"], "sim %.0f%%/%.0f%%" % (s["sim_target"] * 100, s["sim_stop"] * 100), "storico", s["hist_n"], s["hist_r"])
    print("simboli in lista:", len(SYMBOLS))
