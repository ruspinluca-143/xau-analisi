"""Controllo automatico dei segnali favorevoli e notifica sul telefono (ntfy). SOLO ANALISI: nessun ordine.

Pensato per girare da solo ogni 5 minuti su GitHub Actions (vedi .github/workflows/avvisi.yml), così la notifica
arriva anche con l'app chiusa. Non salva niente tranne l'elenco dei segnali già notificati (seen.json).

    python notify.py --dry      mostra cosa invierebbe, senza inviare
    python notify.py            invia (serve la variabile d'ambiente NTFY_TOPIC)
    python notify.py --test     manda anche un messaggio di prova
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E  # noqa: E402

SYMBOL = os.environ.get("XAU_SYMBOL", "XAUUSD")
TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
SEEN_FILE = os.environ.get("SEEN_FILE", "seen.json")
DRY = "--dry" in sys.argv
TEST = "--test" in sys.argv
HOLD = {"5m": 36, "15m": 24, "1h": 24, "4h": 18, "1d": 10}
BREAKOUT_TFS = ("5m", "15m", "1h", "4h")
SESSION_TFS = ("5m",)
REPLAYS = 3000


def fmt(x):
    return ("{:,.2f}".format(x)).replace(",", "X").replace(".", ",").replace("X", ".")


def load_seen():
    try:
        with open(SEEN_FILE, encoding="utf-8") as fh:
            d = json.load(fh)
        cut = time.time() - 3 * 86400
        return {k: v for k, v in d.items() if v > cut}
    except (OSError, ValueError):
        return {}


def save_seen(d):
    with open(SEEN_FILE, "w", encoding="utf-8") as fh:
        json.dump(d, fh)


def candidates(ys, now_u):
    """Segnali favorevoli e freschi, uno per gruppo (setup, time frame, direzione), col target che conviene di più."""
    now_ts = E.epoch(now_u)
    rrs = E.DEFAULT_RRS
    combos = [("breakout", tf) for tf in BREAKOUT_TFS]
    if E.is_gold(ys):
        combos += [(k, tf) for k in E.sessions_for(ys) for tf in SESSION_TFS]
    out = []
    for setup, tf in combos:
        try:
            bars, _ = E.get_bars(ys, tf, now_ts)
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
            best = None
            for rr in rrs:
                b = r["blocks"].get("%g" % rr)
                if not b or b["closed"] or b["stance"] != "favorevole" or not b.get("mc"):
                    continue
                exp = min(b["mc"]["avg_r"], b["hist"]["avg_r"])
                if best is None or exp > best[0]:
                    best = (exp, rr, b)
            if best:
                exp, rr, b = best
                out.append({"id": "%s|%s|%s|%s|%d" % (SYMBOL, setup, tf, d, r["trigger_ts"] - sec), "setup": setup, "tf": tf,
                            "label": st["label"], "dir": d, "rr": rr, "entry": r["entry"], "stop": r["stop"], "target": b["target"],
                            "mc": b["mc"], "hist": b["hist"], "age_min": r.get("age_min", 0)})
    return out


def message(c):
    dn = "BUY" if c["dir"] == "buy" else "SHORT"
    h = c["hist"]
    title = "%s %s - %s - target %gR" % (dn, "XAUUSD" if SYMBOL.upper() in ("XAUUSD", "GC=F") else SYMBOL, c["label"], c["rr"])
    title = title.encode("ascii", "ignore").decode("ascii")
    body = ("Segnale favorevole scattato %d min fa.\nIngresso %s - Stop %s - Target %s\n"
            "Simulazione: target %.0f%%, stop %.0f%%. Storico: %d casi, R medio %+.2f.\n"
            "I prezzi sono quelli dei dati: confrontali col tuo grafico. Solo analisi, decidi tu."
            % (c["age_min"], fmt(c["entry"]), fmt(c["stop"]), fmt(c["target"]), c["mc"]["target"] * 100, c["mc"]["stop"] * 100,
               h["fired"], h["avg_r"]))
    return title, body


def send(title, body, buy):
    req = urllib.request.Request("https://ntfy.sh/" + TOPIC, data=body.encode("utf-8"), method="POST",
                                 headers={"Title": title, "Priority": "high",
                                          "Tags": "chart_with_upwards_trend" if buy else "chart_with_downwards_trend"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def main():
    now_u = E.now_utc()
    ys = E.yahoo_symbol(SYMBOL)
    print("Controllo %s alle %s UTC%s" % (SYMBOL, now_u.strftime("%d/%m %H:%M"), " (prova, non invio)" if DRY else ""))
    if not DRY and not TOPIC:
        print("NTFY_TOPIC non impostato: non posso inviare notifiche. Vedi AVVISI.md.")
        return 0
    if TEST and not DRY:
        try:
            send("Prova avvisi XAU", "Tutto collegato: se leggi questo messaggio, le notifiche funzionano. Solo analisi, nessun ordine.", True)
            print("Messaggio di prova inviato.")
        except Exception as exc:  # noqa: BLE001
            print("Invio di prova non riuscito: %s" % exc)
    seen = load_seen()
    try:
        bars, _ = E.get_bars(ys, "5m", E.epoch(now_u))
    except Exception as exc:  # noqa: BLE001
        print("Dati non raggiungibili: %s" % exc)
        return 0
    if not bars or E.epoch(now_u) - bars[-1][0] > 3600:
        print("Mercato chiuso o dati fermi: niente da controllare.")
        return 0
    found = candidates(ys, now_u)
    print("Segnali favorevoli e freschi: %d" % len(found))
    sent = 0
    for c in found:
        if c["id"] in seen:
            print("  già notificato: %s" % c["id"])
            continue
        title, body = message(c)
        print("  %s\n    %s" % (title, body.replace("\n", "\n    ")))
        if not DRY:
            try:
                send(title, body, c["dir"] == "buy")
                seen[c["id"]] = time.time()
                sent += 1
            except Exception as exc:  # noqa: BLE001
                print("  invio non riuscito: %s" % exc)
    if not DRY:
        save_seen(seen)
    print("Notifiche inviate: %d" % sent)
    return 0


if __name__ == "__main__":
    sys.exit(main())
