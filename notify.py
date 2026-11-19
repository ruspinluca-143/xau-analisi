"""Controllo automatico dei segnali, registro e notifiche (ntfy). SOLO ANALISI: nessun ordine.

Pensato per girare da solo ogni 5 minuti su GitHub Actions (vedi .github/workflows/avvisi.yml):
  1. cerca i segnali appena scattati su tutti i time frame utili (breakout 5m 15m 1h 4h 1d 1w + aperture Londra e
     New York a 5m e 15m), buy e short, con tutti i target da 1R a 5R;
  2. li REGISTRA tutti in log.json (anche quelli non favorevoli, col loro giudizio) per poterli confrontare;
  3. avvisa sul telefono SOLO quelli favorevoli (simulazione e storico concordano, almeno 10 casi);
  4. segue ogni segnale fino all'esito (target, stop o chiuso) e, per quelli avvisati, manda una seconda
     notifica con com'è andata: così capisci anche a posteriori se il segnale era buono.

    python notify.py --dry      mostra cosa farebbe, senza inviare né scrivere
    python notify.py            lavora davvero (serve NTFY_TOPIC per le notifiche)
    python notify.py --test     manda anche un messaggio di prova
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E  # noqa: E402
import persist as PS  # noqa: E402

SYMBOL = os.environ.get("XAU_SYMBOL", "XAUUSD")
TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
LOG_FILE = os.environ.get("LOG_FILE", "log.json")
DRY = "--dry" in sys.argv
TEST = "--test" in sys.argv
HOLD = {"1m": 60, "5m": 36, "15m": 24, "30m": 24, "1h": 24, "4h": 18, "1d": 10, "1w": 8}
BREAKOUT_TFS = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w")
SESSION_TFS = ("1m", "5m", "15m")
REPLAYS = 3000
KEEP_DAYS = 90


def fmt(x):
    return ("{:,.2f}".format(x)).replace(",", "X").replace(".", ",").replace("X", ".")


def sgn(x):
    return ("%+.2f" % x).replace(".", ",")


def load_log():
    PS.restore(LOG_FILE, "log.json")  # dopo un riavvio del server il registro si ripristina dal ramo dati
    try:
        with open(LOG_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def save_log(items, urgent=False):
    cut = time.time() - KEEP_DAYS * 86400
    items = [x for x in items if x["entry_ts"] > cut][-1500:]
    d = os.path.dirname(LOG_FILE)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(LOG_FILE, "w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, separators=(",", ":"))
    PS.push(LOG_FILE, "log.json", min_gap=0 if urgent else 600)  # senza fretta una copia ogni 10 minuti al massimo (non un salvataggio a ogni controllo)


def closed_bars(ys, tf, now_ts):
    """Barre chiuse del time frame (per 1d e 1w tolgo la barra ancora in corso)."""
    bars, _ = E.get_bars(ys, tf, now_ts)
    if tf in ("1d", "1w") and bars and bars[-1][0] + E.TF[tf][2] > now_ts:
        bars = bars[:-1]
    return bars


def candidates(ys, now_u):
    """Segnali freschi di ogni gruppo (setup, time frame, direzione), col target che conviene di più."""
    now_ts = E.epoch(now_u)
    rrs = E.DEFAULT_RRS
    combos = [("breakout", tf) for tf in BREAKOUT_TFS]
    if E.is_gold(ys):
        combos += [(k, tf) for k in E.sessions_for(ys) for tf in SESSION_TFS]
    out = []
    for setup, tf in combos:
        try:
            bars = closed_bars(ys, tf, now_ts)
            if setup == "breakout":
                st = E.build_breakout(bars, tf, rrs, 20, 1.0, HOLD[tf], REPLAYS, 19, True)
            else:
                st = E.build_session(ys, setup, tf, bars, now_u, rrs, 15, REPLAYS, 19, True)
        except Exception as exc:  # noqa: BLE001
            print("  salto %s %s: %s" % (setup, tf, exc))
            continue
        if st.get("error") or "dirs" not in st:
            continue
        sec = E.TF[tf][2]
        for d, r in st["dirs"].items():
            if r["state"] != "triggered":
                continue
            fresh = r.get("age_bars", 99) <= 2 if setup == "breakout" else r.get("age_min", 999) <= 30
            if not fresh:
                continue
            best, favs = None, []
            for rr in rrs:
                b = r["blocks"].get("%g" % rr)
                if not b or b["closed"] or not b.get("mc"):
                    continue
                h = b["hist"]
                if b["stance"] == "favorevole":
                    favs.append([rr, b["target"]])
                exp = min(b["mc"]["avg_r"], h["avg_r"] if h["fired"] >= 10 else -9)
                if best is None or (b["stance"] == "favorevole", exp) > (best[2]["stance"] == "favorevole", best[0]):
                    best = (exp, rr, b)
            if best:
                exp, rr, b = best
                hold = HOLD[tf] if setup == "breakout" else r.get("age_bars", 0) + r.get("bars_left", 0)
                out.append({"id": "%s|%s|%s|%s|%d" % (SYMBOL, setup, tf, d, r["trigger_ts"] - sec), "setup": setup, "tf": tf,
                            "label": st["label"], "dir": d, "rr": rr, "entry": r["entry"], "stop": r["stop"], "target": b["target"],
                            "entry_ts": r["trigger_ts"] - sec, "hold": hold, "stance": b["stance"],
                            "sim_target": round(b["mc"]["target"], 3), "sim_stop": round(b["mc"]["stop"], 3),
                            "hist_n": b["hist"]["fired"], "hist_r": round(b["hist"]["avg_r"], 3), "age_min": r.get("age_min", 0), "favs": favs})
    return out


def title_of(c, prefix=""):
    dn = "BUY" if c["dir"] == "buy" else "SHORT"
    sym = "XAUUSD" if SYMBOL.upper() in ("XAUUSD", "GC=F") else SYMBOL
    t = "%s%s %s - %s - target %gR" % (prefix, dn, sym, c["label"], c["rr"])
    return t.encode("ascii", "ignore").decode("ascii")


def favs_line(c):
    f = c.get("favs") or []
    if len(f) < 2:
        return ""
    return "Target favorevoli: " + " - ".join("%gR a %s" % (rr, fmt(t)) for rr, t in f) + ".\n"


def message(c):
    body = ("Segnale favorevole scattato %d min fa (alle %s ora italiana).\nIngresso %s - Stop %s - Target %s\n"
            "Simulazione: target %.0f%%, stop %.0f%%. Storico: %d casi, R medio %s.\n"
            "%sI prezzi sono quelli dei dati: confrontali col tuo grafico. Solo analisi, decidi tu."
            % (c["age_min"], E.hhmm_it(c["entry_ts"] + E.TF[c["tf"]][2]), fmt(c["entry"]), fmt(c["stop"]), fmt(c["target"]),
               c["sim_target"] * 100, c["sim_stop"] * 100, c["hist_n"], sgn(c["hist_r"]), favs_line(c)))
    return title_of(c), body


def outcome_message(c):
    st, r = c["status"], c["r"]
    word = {"target": "TARGET RAGGIUNTO", "stop": "STOP COLPITO", "none": "CHIUSO SENZA TARGET NE STOP"}[st]
    tag = {"target": "white_check_mark", "stop": "x", "none": "hourglass_flowing_sand"}[st]
    verdict = {"target": "Il segnale era buono.", "stop": "Questa volta il segnale non era buono.",
               "none": "Il segnale non ha dato un esito netto."}[st]
    title = title_of(c, "Esito: ") + " - " + word + " (%s R)" % ("%+.1f" % r)
    body = ("%s Segnale delle %s ora italiana: ingresso %s, stop %s, target %s. Risultato %s R.\n%s"
            % (word.capitalize(), E.hhmm_it(c["entry_ts"] + E.TF[c["tf"]][2]), fmt(c["entry"]), fmt(c["stop"]), fmt(c["target"]), sgn(r), verdict))
    return title.encode("ascii", "ignore").decode("ascii"), body, tag


EVENTS = []      # ultime notifiche tentate: {"t", "title", "ok", "err"}; si azzera a ogni riavvio del server
STARTED = time.time()


def record(title, ok, err=""):
    EVENTS.append({"t": int(time.time()), "title": str(title)[:90], "ok": bool(ok), "err": str(err)[:120]})
    del EVENTS[:-40]


def send(title, body, tags):
    req = urllib.request.Request("https://ntfy.sh/" + TOPIC, data=body.encode("utf-8"), method="POST",
                                 headers={"Title": title, "Priority": "high", "Tags": tags})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            record(title, True)
            return r.status
    except Exception as exc:  # noqa: BLE001
        record(title, False, exc.__class__.__name__ + ": " + str(exc))  # l'errore non contiene il nome del canale
        raise


def resolve(items, ys, now_ts):
    """Aggiorna l'esito dei segnali ancora aperti. Restituisce quelli appena chiusi."""
    cache, closed = {}, []
    for it in items:
        if it["status"] != "open":
            continue
        try:
            sy = E.yahoo_symbol(it["symbol"]) if it.get("symbol") else ys  # i segnali dello scanner portano il loro simbolo
            if (sy, it["tf"]) not in cache:
                cache[(sy, it["tf"])] = closed_bars(sy, it["tf"], now_ts)
            bars = cache[(sy, it["tf"])]
            idx = next((i for i, b in enumerate(bars) if b[0] == it["entry_ts"]), None)
            if idx is None:
                if now_ts - it["entry_ts"] > 3 * 86400:
                    it["status"], it["r"] = "nd", None  # fuori dai dati disponibili: non determinabile
                continue
            _, out = E.walk_multi(bars, idx, it["dir"], it["entry"], it["stop"], E.DEFAULT_RRS, it["hold"])
            o = out[it["rr"]]
            if o[0] in ("target", "stop", "none"):
                it["status"], it["r"] = o[0], round(o[1], 3)
                it["exit_ts"] = bars[min(o[2], len(bars) - 1)][0]
                it["all"] = {"%g" % rr: [v[0], round(v[1], 2)] for rr, v in out.items()}
                closed.append(it)
        except Exception as exc:  # noqa: BLE001
            print("  esito non calcolabile per %s: %s" % (it["id"], exc))
    return closed


def main():
    return run()


REM_FILE = os.path.join(os.path.dirname(LOG_FILE) or ".", "reminders.json")
REM_CUR = [c.strip().upper() for c in os.environ.get("CAL_CUR", "USD,EUR,GBP").split(",") if c.strip()]  # valute per cui avvisare prima di una notizia rossa ("ALL" = tutte)


def _load_rem():
    PS.restore(REM_FILE, "reminders.json")
    try:
        with open(REM_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _save_rem(d):
    cut = time.time() - 3 * 86400
    d = {k: v for k, v in d.items() if v > cut}
    try:
        with open(REM_FILE, "w", encoding="utf-8") as fh:
            json.dump(d, fh)
        PS.push(REM_FILE, "reminders.json", min_gap=0)
    except OSError:
        pass


def reminders(events, now_u, now_ts, can_send):
    """Promemoria sul telefono: (1) ogni mattina alle 7:00 ora italiana 'carica l'email'; (2) 30 minuti prima di ogni notizia rossa
    (USD, EUR, GBP). Ogni promemoria parte una volta sola."""
    done, sent, changed = _load_rem(), 0, False
    loc = E.to_local("rome", now_u)
    k = "mattina|" + loc.strftime("%Y-%m-%d")
    if 7 <= loc.hour < 10 and k not in done:
        print("Promemoria delle 7: carica l'email di Vantage")
        if can_send:
            try:
                send("Buongiorno - carica l'email di Vantage", "Apri l'email giornaliera di Vantage, copia il testo e incollalo nell'app: Operazioni, Incolla testo, Importa. Così le operazioni di ieri sono registrate e le statistiche tornano esatte.", "memo")
                done[k] = now_ts; changed = True; sent += 1
            except Exception as exc:  # noqa: BLE001
                print("  promemoria non inviato: %s" % exc)
    groups = {}
    for e in events or []:
        dt = e["ts"] - now_ts
        if 0 < dt <= 1800 and (not REM_CUR or "ALL" in REM_CUR or e.get("country", "").upper() in REM_CUR):
            groups.setdefault(e["ts"], []).append(e)
    for ts, evs in sorted(groups.items()):
        k = "evento|%d" % ts
        if k in done:
            continue
        mins = max(1, int((ts - now_ts) / 60))
        cur = "/".join(sorted({e.get("country", "") for e in evs}))
        title = "NOTIZIA ROSSA tra %d min - %s ore %s" % (mins, cur, E.hhmm_it(ts))
        lines = []
        for e in evs:
            extra = ", ".join(x for x in ("previsto " + e["forecast"] if e.get("forecast") else "", "prima " + e["previous"] if e.get("previous") else "") if x)
            lines.append("%s (%s)%s" % (e.get("title", ""), e.get("country", ""), " - " + extra if extra else ""))
        body = "\n".join(lines) + "\nL'oro puo' muoversi molto e in fretta: valuta di non operare nei minuti attorno alla notizia."
        print("Promemoria notizia: %s | %s" % (title, "; ".join(lines)))
        if can_send:
            try:
                send(title.encode("ascii", "ignore").decode("ascii"), body, "rotating_light")
                done[k] = now_ts; changed = True; sent += 1
            except Exception as exc:  # noqa: BLE001
                print("  promemoria non inviato: %s" % exc)
    if changed:
        _save_rem(done)
    return sent


def run(topic=None, calendar=None):
    global TOPIC
    if topic is not None:
        TOPIC = topic
    now_u = E.now_utc()
    now_ts = E.epoch(now_u)
    ys = E.yahoo_symbol(SYMBOL)
    print("Controllo %s alle %s UTC%s" % (SYMBOL, now_u.strftime("%d/%m %H:%M"), " (prova, non scrivo né invio)" if DRY else ""))
    can_send = bool(TOPIC) and not DRY
    if not DRY and not TOPIC:
        print("NTFY_TOPIC non impostato: registro i segnali ma non posso inviare notifiche. Vedi AVVISI.md.")
    if TEST and can_send:
        try:
            send("Prova avvisi XAU", "Tutto collegato: se leggi questo messaggio, le notifiche funzionano. Solo analisi, nessun ordine.", "bell")
            print("Messaggio di prova inviato.")
        except Exception as exc:  # noqa: BLE001
            print("Invio di prova non riuscito: %s" % exc)
    try:
        reminders(calendar, now_u, now_ts, can_send)
    except Exception as exc:  # noqa: BLE001
        print("Promemoria non riusciti: %s" % exc)
    try:
        bars, _ = E.get_bars(ys, "5m", now_ts)
    except Exception as exc:  # noqa: BLE001
        print("Dati non raggiungibili: %s" % exc)
        return 0
    if not bars or now_ts - bars[-1][0] > 3600:
        print("Mercato chiuso o dati fermi: niente da controllare.")
        return 0
    items = load_log()
    known = {x["id"] for x in items}
    found = candidates(ys, now_u)
    new = [c for c in found if c["id"] not in known]
    print("Segnali freschi: %d (nuovi: %d, di cui favorevoli: %d)" % (len(found), len(new), sum(1 for c in new if c["stance"] == "favorevole")))
    sent = 0
    for c in new:
        c.update({"status": "open", "r": None, "notified": False, "out_sent": False})
        if c["stance"] == "favorevole":
            title, body = message(c)
            print("  FAVOREVOLE: %s\n    %s" % (title, body.replace("\n", "\n    ")))
            if can_send:
                try:
                    send(title, body, "chart_with_upwards_trend" if c["dir"] == "buy" else "chart_with_downwards_trend")
                    c["notified"] = True
                    sent += 1
                except Exception as exc:  # noqa: BLE001
                    print("  invio non riuscito: %s" % exc)
        else:
            print("  registrato (non favorevole, %s): %s" % (c["stance"], title_of(c)))
        items.append(c)
    closed = resolve(items, ys, now_ts)
    for it in closed:
        print("  ESITO %s: %s %s R" % (it["id"], it["status"], it["r"]))
        if it["notified"] and not it["out_sent"] and can_send:
            title, body, tag = outcome_message(it)
            try:
                send(title, body, tag)
                it["out_sent"] = True
                sent += 1
            except Exception as exc:  # noqa: BLE001
                print("  invio dell'esito non riuscito: %s" % exc)
    if not DRY and (new or closed):
        save_log(items, urgent=bool(sent))
    print("Registrati: %d nuovi, esiti chiusi: %d, notifiche inviate: %d" % (len(new), len(closed), sent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
