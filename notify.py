"""Controllo automatico dei segnali, registro e notifiche (ntfy). SOLO ANALISI: nessun ordine.

Pensato per girare da solo ogni 5 minuti su GitHub Actions (vedi .github/workflows/avvisi.yml):
  1. cerca i segnali appena scattati su tutti i time frame utili (breakout 30m 1h 4h 1d), buy e short, con i target 2R, 3R e 4R;
  2. li REGISTRA tutti in log.json (anche quelli non favorevoli, col loro giudizio) per poterli confrontare;
  3. avvisa sul telefono SOLO quelli favorevoli (simulazione e storico concordano, almeno 10 casi);
  4. segue ogni segnale fino all'esito (target, stop o chiuso) e, per quelli avvisati, manda una seconda
     notifica con com'è andata: così capisci anche a posteriori se il segnale era buono.

    python notify.py --dry      mostra cosa farebbe, senza inviare né scrivere
    python notify.py            lavora davvero (serve NTFY_TOPIC per le notifiche)
    python notify.py --test     manda anche un messaggio di prova
"""
import errno
import http.client
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E  # noqa: E402
import persist as PS  # noqa: E402

SYMBOL = os.environ.get("XAU_SYMBOL", "XAUUSD")
TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")  # i file di stato stanno sempre accanto al programma, mai nella cartella da cui lo si avvia
try:
    os.makedirs(DATA_DIR, exist_ok=True)  # senza questa cartella nessun file di stato (registro, promemoria, scelte) si potrebbe scrivere
except OSError:
    pass
LOG_FILE = os.environ.get("LOG_FILE", os.path.join(DATA_DIR, "log.json"))
DRY = "--dry" in sys.argv
TEST = "--test" in sys.argv
HOLD = {"1m": 60, "5m": 36, "15m": 24, "30m": 24, "1h": 24, "4h": 18, "1d": 10, "1w": 8}
BREAKOUT_TFS = ("30m", "1h", "4h", "1d")  # solo questi (niente 1m, 5m, 15m, 1w)
SESSION_TFS = ()  # le aperture di Londra e New York esistevano solo a 5 minuti: tolte insieme al 5m
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


TFN = {"5m": "5min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1d"}


def compact(c):
    """Nome del segnale nel formato scelto da Luca: STRUMENTO-BUY/SELL-TIMEFRAME-R, per esempio XAUUSD-SELL-5min-4R."""
    sym = str(c.get("symbol") or "XAUUSD").upper()
    t = "%s-%s-%s-%gR" % (sym, "BUY" if c.get("dir") == "buy" else "SELL", TFN.get(c.get("tf"), c.get("tf")), c.get("rr"))
    return t.encode("ascii", "ignore").decode("ascii")


def title_of(c, prefix=""):
    return prefix + compact(c)


def favs_line(c):
    f = c.get("favs") or []
    if len(f) < 2:
        return ""
    return "Target favorevoli: " + " - ".join("%gR a %s" % (rr, fmt(t)) for rr, t in f) + ".\n"


def message(c):
    body = ("Setup: %s.\nSegnale favorevole scattato %d min fa (alle %s ora italiana).\nIngresso %s - Stop %s - Target %s\n"
            "Simulazione: target %.0f%%, stop %.0f%%. Storico: %d casi, R medio %s.\n"
            "%sI prezzi sono quelli dei dati: confrontali col tuo grafico. Solo analisi, decidi tu."
            % (c.get("label", "Breakout"), c["age_min"], E.hhmm_it(c["entry_ts"] + E.TF[c["tf"]][2]), fmt(c["entry"]), fmt(c["stop"]), fmt(c["target"]),
               c["sim_target"] * 100, c["sim_stop"] * 100, c["hist_n"], sgn(c["hist_r"]), favs_line(c)))
    return title_of(c), body


def outcome_message(c):
    st, r = c["status"], c["r"]
    word = {"target": "TARGET RAGGIUNTO", "stop": "STOP COLPITO", "none": "CHIUSO SENZA TARGET NE STOP"}[st]
    tag = {"target": "white_check_mark", "stop": "x", "none": "hourglass_flowing_sand"}[st]
    verdict = {"target": "Il segnale era buono.", "stop": "Questa volta il segnale non era buono.",
               "none": "Il segnale non ha dato un esito netto."}[st]
    title = "%s: %s (%s R)" % (compact(c), word, "%+.1f" % r)
    body = ("%s Segnale delle %s ora italiana: ingresso %s, stop %s, target %s. Risultato %s R.\n%s"
            % (word.capitalize(), E.hhmm_it(c["entry_ts"] + E.TF[c["tf"]][2]), fmt(c["entry"]), fmt(c["stop"]), fmt(c["target"]), sgn(r), verdict))
    return title.encode("ascii", "ignore").decode("ascii"), body, tag


EVENTS = []      # ultime notifiche tentate: {"t", "title", "ok", "err"}; si salvano su file e (con GITHUB_TOKEN) sul ramo dati: non si perdono a ogni riavvio
STARTED = time.time()
EVENTS_FILE = os.path.join(os.path.dirname(LOG_FILE) or ".", "events.json")
_ev_loaded = False


def events():
    """Elenco degli ultimi invii; la prima volta recupera quelli salvati prima dell'ultimo riavvio."""
    global _ev_loaded
    if not _ev_loaded:
        _ev_loaded = True
        PS.restore(EVENTS_FILE, "events.json")
        try:
            with open(EVENTS_FILE, encoding="utf-8") as fh:
                EVENTS[:0] = [x for x in json.load(fh) if isinstance(x, dict) and "t" in x and "title" in x][-40:]
        except (OSError, ValueError):
            pass
    return EVENTS


def record(title, ok, err=""):
    events()
    EVENTS.append({"t": int(time.time()), "title": str(title)[:90], "ok": bool(ok), "err": str(err)[:120]})
    del EVENTS[:-40]
    try:
        with open(EVENTS_FILE, "w", encoding="utf-8") as fh:
            json.dump(EVENTS, fh, ensure_ascii=False, separators=(",", ":"))
        PS.push(EVENTS_FILE, "events.json", min_gap=120)
    except OSError:
        pass


NTFY_TOKEN = os.environ.get("NTFY_TOKEN", "").strip()  # facoltativo: con un account ntfy i limiti sono i tuoi e non quelli dell'indirizzo condiviso del server
class _V4Conn(http.client.HTTPSConnection):
    """Connessione solo IPv4: serve quando il server non ha una rotta IPv6 e il nome del servizio risponde (anche) con indirizzi IPv6."""

    def connect(self):
        last = None
        for _fam, _typ, _pro, _cn, sa in socket.getaddrinfo(self.host, self.port, socket.AF_INET, socket.SOCK_STREAM):
            try:
                sock = socket.create_connection(sa[:2], self.timeout)
                break
            except OSError as exc:
                last = exc
        else:
            raise last or OSError("nessun indirizzo IPv4 per %s" % self.host)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _V4Handler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_V4Conn, req)


def _unreachable(exc):
    r = getattr(exc, "reason", exc)
    return isinstance(r, OSError) and getattr(r, "errno", None) in (errno.ENETUNREACH, errno.EHOSTUNREACH, 101, 113, 10051, 10065)


COOL = {"until": 0.0, "n": 0}  # pausa dopo un errore 429 (troppe richieste): niente tentativi a raffica che peggiorano il blocco


TG_TOKEN = os.environ.get("TELEGRAM_TOKEN", "").strip()    # secondo canale (facoltativo): bot Telegram, indipendente da ntfy
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID", "").strip()


def telegram_on():
    return bool(TG_TOKEN and TG_CHAT)


def enabled():
    """True se c'è almeno un canale per le notifiche (ntfy o Telegram)."""
    return bool(TOPIC) or telegram_on()


def _ntfy_wait():
    return max(0, int(COOL["until"] - time.time()))


def cooling():
    """Secondi di pausa rimasti prima di poter inviare: con Telegram collegato non si aspetta mai (l'altro canale è libero)."""
    return 0 if telegram_on() else _ntfy_wait()


def _send_ntfy(title, body, tags):
    headers = {"Title": title, "Priority": "high", "Tags": tags}
    if NTFY_TOKEN:
        headers["Authorization"] = "Bearer " + NTFY_TOKEN
    req = urllib.request.Request("https://ntfy.sh/" + TOPIC, data=body.replace("**", "").encode("utf-8"), method="POST", headers=headers)
    try:
        try:
            r = urllib.request.urlopen(req, timeout=12)
        except urllib.error.URLError as exc:
            if isinstance(exc, urllib.error.HTTPError) or not _unreachable(exc):
                raise
            r = urllib.request.build_opener(_V4Handler).open(req, timeout=12)  # "rete non raggiungibile": riprovo solo con IPv4
        with r:
            COOL["n"] = 0
            record(title, True)
            return r.status
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "ignore")[:160].replace("\n", " ")
        except Exception:  # noqa: BLE001
            pass
        if exc.code == 429:  # troppe richieste: pausa crescente (2, 4, 8... fino a 30 minuti), o quella indicata dal servizio
            try:
                ra = int(exc.headers.get("Retry-After", "0") or 0)
            except ValueError:
                ra = 0
            pause = min(1800, max(ra, 120 * (2 ** min(COOL["n"], 4))))
            if telegram_on():
                pause = max(pause, 1800)  # con Telegram collegato non si insiste con ntfy: un tentativo ogni 30 minuti
            COOL["until"], COOL["n"] = time.time() + pause, COOL["n"] + 1
            record(title, False, "ntfy 429 troppe richieste: riprovo tra %d minuti. %s" % (pause // 60, detail))
        else:
            record(title, False, "ntfy HTTP %s %s" % (exc.code, detail))
        raise
    except Exception as exc:  # noqa: BLE001
        pause = min(300, 60 * (COOL["n"] + 1))  # errore di rete: pausa breve e crescente (1, 2, 3... fino a 5 minuti), non un tentativo al minuto
        if telegram_on():
            pause = 1800  # con Telegram collegato ntfy si riprova solo ogni 30 minuti: niente attese di 12 secondi a ogni avviso, niente insistenza su un servizio che non risponde
        COOL["until"], COOL["n"] = time.time() + pause, COOL["n"] + 1
        record(title, False, "ntfy " + exc.__class__.__name__ + ": " + str(exc) + " (riprovo tra %d min)" % (pause // 60))  # l'errore non contiene il nome del canale
        raise


def _tg_html(title, body):
    import html
    import re as _re
    t = "<b>%s</b>\n%s" % (html.escape(title), _re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html.escape(body)))
    return t[:3900]


def _send_telegram(title, body):
    url = "https://api.telegram.org/bot%s/sendMessage" % TG_TOKEN
    for html_mode in (True, False):  # prima in grassetto; se Telegram non accetta il formato, testo semplice
        payload = {"chat_id": TG_CHAT, "disable_web_page_preview": True}
        if html_mode:
            payload.update({"text": _tg_html(title, body), "parse_mode": "HTML"})
        else:
            payload["text"] = ("%s\n%s" % (title, body.replace("**", "")))[:3900]
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST", headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                record(title + " (via Telegram)", True)
                return r.status
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = json.loads(exc.read().decode("utf-8", "ignore")).get("description", "")[:120]
            except Exception:  # noqa: BLE001
                pass
            if html_mode and exc.code == 400 and "parse" in detail.lower():
                continue
            record(title, False, "Telegram HTTP %s %s" % (exc.code, detail))  # mai il token nei messaggi
            raise
        except Exception as exc:  # noqa: BLE001
            record(title, False, "Telegram " + exc.__class__.__name__)
            raise


BUDGET = {"day": "", "n": 0}
DAILY_MAX = int(os.environ.get("NTFY_DAILY_MAX", "150"))  # il servizio gratuito ferma a 250 messaggi al giorno: teniamo un margine, e i promemoria passano sempre


def send(title, body, tags, essential=False):
    """Invia su ntfy e, se non riesce (o in più, se è l'unico collegato), su Telegram. Riesce se almeno un canale accetta il messaggio."""
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if BUDGET["day"] != day:
        BUDGET["day"], BUDGET["n"] = day, 0
    if not essential and BUDGET["n"] >= DAILY_MAX:
        raise RuntimeError("limite giornaliero di %d messaggi raggiunto: gli altri avvisi restano nell'elenco dell'app" % DAILY_MAX)
    err = None
    ok = False
    if TOPIC:
        wait = _ntfy_wait()
        if wait:
            err = RuntimeError("ntfy in pausa per altri %d minuti dopo un errore del servizio" % (wait // 60 + 1))  # non si registra: non è un nuovo tentativo
        else:
            try:
                _send_ntfy(title, body, tags)
                ok = True
            except Exception as exc:  # noqa: BLE001
                err = exc
    if not ok and telegram_on():
        try:
            _send_telegram(title, body)
            ok = True
        except Exception as exc:  # noqa: BLE001
            err = exc
    if ok:
        BUDGET["n"] += 1
        return 200
    raise err or RuntimeError("nessun canale di notifica collegato")


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


def flush(items, now_ts, can_send):
    """Invia in UN SOLO messaggio i segnali favorevoli non ancora notificati (anche quelli rimasti indietro per un errore 429) e, in un altro,
    gli esiti nuovi: meno messaggi, e se il servizio rifiuta si riprova al giro dopo. Restituisce (messaggi inviati, qualcosa è cambiato)."""
    sent, changed = 0, False
    if not can_send or cooling():
        return sent, changed
    P = prefs()
    pend = [it for it in items if it.get("stance") == "favorevole" and not it.get("notified") and not it.get("symbol") and it.get("status") == "open"
            and it.get("rr") in E.DEFAULT_RRS and it.get("tf") in P["tfs"] and (it.get("sim_target") or 0) * 100 > P["min_target"] and now_ts - it["entry_ts"] < 6 * 3600]
    if pend:
        try:
            for c in pend:
                c["age_min"] = max(0, int((now_ts - (c["entry_ts"] + E.TF[c["tf"]][2])) / 60))
            if len(pend) == 1:
                c = pend[0]
                title, body = message(c)
                send(title, body, "chart_with_upwards_trend" if c["dir"] == "buy" else "chart_with_downwards_trend")
            else:
                title = ("%d segnali favorevoli sull'oro" % len(pend))
                lines = []
                for c in pend:
                    lines.append("**%s** - ingresso %s, stop %s, target %s (scattato alle %s ora italiana; simulazione %.0f%%, storico R %s)" % (
                        title_of(c), fmt(c["entry"]), fmt(c["stop"]), fmt(c["target"]), E.hhmm_it(c["entry_ts"] + E.TF[c["tf"]][2]), c["sim_target"] * 100, sgn(c["hist_r"])))
                send(title, "\n".join(lines) + "\nI prezzi sono quelli dei dati: confrontali col tuo grafico. Solo analisi, decidi tu.", "chart_with_upwards_trend")
            for c in pend:
                c["notified"] = True
            sent, changed = sent + 1, True
        except Exception as exc:  # noqa: BLE001
            print("  invio non riuscito (si riprova): %s" % exc)
    for it in items:  # esiti di vecchi segnali fuori dall'elenco (altri target o time frame): non si avvisano mai, si segnano come già gestiti
        if it.get("notified") and not it.get("out_sent") and not E.IN_SCOPE(it):
            it["out_sent"], changed = True, True
    outs = [it for it in items if it.get("notified") and not it.get("out_sent") and it.get("status") in ("target", "stop", "none") and not it.get("symbol") and E.IN_SCOPE(it)]
    if outs and not cooling():
        try:
            if len(outs) == 1:
                title, body, tag = outcome_message(outs[0])
                send(title, body, tag)
            else:
                lines = []
                for it in outs:
                    word = {"target": "TARGET", "stop": "STOP", "none": "senza esito netto"}[it["status"]]
                    lines.append("**%s**: %s (%s R)" % (compact(it), word, "%+.1f" % it["r"]))
                send("%d esiti dei segnali" % len(outs), "\n".join(lines) + "\nSolo analisi.", "bell")
            for it in outs:
                it["out_sent"] = True
            sent, changed = sent + 1, True
        except Exception as exc:  # noqa: BLE001
            print("  invio degli esiti non riuscito (si riprova): %s" % exc)
    return sent, changed


PREFS_FILE = os.path.join(os.path.dirname(LOG_FILE) or ".", "prefs.json")


def prefs():
    """Scelte di Luca per le notifiche: su quali time frame avvisare e se mandare il riepilogo serale (predefinito: tutti i time frame, riepilogo sì)."""
    PS.restore(PREFS_FILE, "prefs.json")
    d = {"tfs": list(E.TF_ORDER), "evening": True, "min_target": 30.0}
    try:
        with open(PREFS_FILE, encoding="utf-8") as fh:
            x = json.load(fh)
        if isinstance(x.get("tfs"), list):
            d["tfs"] = [t for t in x["tfs"] if t in E.TF_ORDER]
        d["evening"] = bool(x.get("evening", True))
        if isinstance(x.get("min_target"), (int, float)):
            d["min_target"] = max(0.0, min(95.0, float(x["min_target"])))
    except (OSError, ValueError, AttributeError):
        pass
    return d


def save_prefs(tfs, evening, min_target=None):
    d = {"tfs": [t for t in E.TF_ORDER if t in (tfs or [])], "evening": bool(evening),
         "min_target": max(0.0, min(95.0, float(prefs()["min_target"] if min_target is None else min_target)))}
    with open(PREFS_FILE, "w", encoding="utf-8") as fh:
        json.dump(d, fh)
    PS.push(PREFS_FILE, "prefs.json", min_gap=0)
    return d


def evening_summary(items, now_u, now_ts, can_send):
    """Riepilogo serale in UN messaggio (dalle 22:00 ora italiana, una volta al giorno): segnali favorevoli di oggi, esiti e categoria più debole."""
    loc = E.to_local("rome", now_u)
    if loc.hour < 22 or not can_send or cooling() or not prefs()["evening"]:
        return 0
    done = _load_rem()
    k = "sera|" + loc.strftime("%Y-%m-%d")
    if k in done:
        return 0
    import datetime as _dt
    start = E.epoch(E.from_local("rome", _dt.datetime(loc.year, loc.month, loc.day)))
    allit = list(items)
    if os.environ.get("SCANNER", "1") != "0":
        try:
            import scanner as SC
            allit += SC.history()
        except Exception:  # noqa: BLE001
            pass
    sel = [x for x in allit if x.get("stance") == "favorevole" and x.get("entry_ts", 0) >= start and E.IN_SCOPE(x)]
    if not sel:
        return 0
    closed = [x for x in sel if x.get("status") in ("target", "stop", "none") and x.get("r") is not None]
    w, l, op = sum(1 for x in sel if x.get("status") == "target"), sum(1 for x in sel if x.get("status") == "stop"), sum(1 for x in sel if x.get("status") == "open")
    tot = sum(x["r"] for x in closed)
    lines = ["Segnali favorevoli di oggi: %d (target %d, stop %d, ancora aperti %d)." % (len(sel), w, l, op), "R totale dei chiusi: %s." % sgn(tot)]
    by = {}
    for x in closed:
        by.setdefault(x["tf"], []).append(x["r"])
    cand = [(sum(v) / len(v), t, len(v)) for t, v in by.items() if len(v) >= 3]
    if len(cand) >= 2:
        cand.sort()
        lines.append("Time frame più debole oggi: %s (R medio %s su %d). Il più forte: %s (%s su %d)." % (cand[0][1], sgn(cand[0][0]), cand[0][2], cand[-1][1], sgn(cand[-1][0]), cand[-1][2]))
    lines.append("Dettagli in Avvisi, Segnali automatici. Solo analisi.")
    try:
        send("Riepilogo di oggi: %d segnali favorevoli" % len(sel), "\n".join(lines), "bar_chart")
    except Exception as exc:  # noqa: BLE001
        print("  riepilogo serale non inviato (si riprova): %s" % exc)
        return 0
    done[k] = now_ts
    _save_rem(done)
    return 1


def reminder_state():
    """Promemoria già inviati (chiave -> istante): serve a vedere nell'app se quello delle 7:00 è partito."""
    d = _load_rem()
    return dict(sorted(((k, v) for k, v in d.items() if k.startswith("mattina|")), key=lambda kv: kv[1])[-4:])


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
                send("Buongiorno - carica l'email di Vantage", "Apri l'email giornaliera di Vantage, copia il testo e incollalo nell'app: Operazioni, Incolla testo, Importa. Così le operazioni di ieri sono registrate e le statistiche tornano esatte.", "memo", essential=True)
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
                send(title.encode("ascii", "ignore").decode("ascii"), body, "rotating_light", essential=True)
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
    can_send = enabled() and not DRY
    if not DRY and not enabled():
        print("Nessun canale di notifica (NTFY_TOPIC o TELEGRAM_TOKEN e TELEGRAM_CHAT_ID): registro i segnali ma non posso inviare notifiche. Vedi GUIDA-GESTIONE.md.")
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
    for c in new:
        c.update({"status": "open", "r": None, "notified": False, "out_sent": False})
        if c["stance"] == "favorevole":
            title, body = message(c)
            print("  FAVOREVOLE: %s\n    %s" % (title, body.replace("\n", "\n    ")))
        else:
            print("  registrato (non favorevole, %s): %s" % (c["stance"], title_of(c)))
        items.append(c)
    closed = resolve(items, ys, now_ts)
    for it in closed:
        print("  ESITO %s: %s %s R" % (it["id"], it["status"], it["r"]))
    sent, changed = flush(items, now_ts, can_send)
    try:
        sent += evening_summary(items, now_u, now_ts, can_send)
    except Exception as exc:  # noqa: BLE001
        print("Riepilogo serale non riuscito: %s" % exc)
    if not DRY and (new or closed or changed):
        save_log(items, urgent=bool(sent))
    print("Registrati: %d nuovi, esiti chiusi: %d, notifiche inviate: %d" % (len(new), len(closed), sent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
