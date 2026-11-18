"""Memoria che sopravvive ai riavvii del server (solo analisi, nessun ordine).

Su Render gratuito il disco si azzera a ogni nuova pubblicazione o riavvio: i registri dei segnali (log.json, scan_hist.json, scan.json,
reminders.json) sparirebbero. Se è impostata la variabile GITHUB_TOKEN (token con permesso di scrittura sul solo repository dell'app),
ogni modifica viene copiata nel ramo "dati" del repository e all'avvio il file mancante viene ripristinato da lì.
Senza token si prova comunque a ripristinare da quello che c'è già sul ramo "dati" (copia pubblica, nessun dato personale: solo segnali).
Mai scrivere il token in un file: solo variabile d'ambiente.
"""
import base64
import hashlib
import json
import os
import threading
import time
import urllib.request

REPO = os.environ.get("GITHUB_REPO", "ruspinluca-143/xau-analisi")
BRANCH = os.environ.get("GITHUB_DATA_BRANCH", "dati")
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
UA = {"User-Agent": "xau-analisi/1.0", "Accept": "application/vnd.github+json"}
_last = {}      # nome remoto -> (istante, hash) dell'ultimo invio riuscito
_tried = set()  # file per i quali il ripristino è già stato tentato in questa esecuzione
_lock = threading.Lock()
_busy = set()


def enabled():
    return bool(TOKEN)


def _req(url, method="GET", body=None, timeout=20):
    h = dict(UA)
    if TOKEN:
        h["Authorization"] = "Bearer " + TOKEN
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def restore(local_path, remote_name):
    """Se il file locale manca (disco azzerato), lo ripristina dal ramo dati. Restituisce True se l'ha ripristinato."""
    if local_path in _tried or os.path.exists(local_path):
        return False
    _tried.add(local_path)
    try:
        if TOKEN:
            j = _req("https://api.github.com/repos/%s/contents/%s?ref=%s" % (REPO, remote_name, BRANCH))
            raw = base64.b64decode(j["content"])
        else:
            u = "https://raw.githubusercontent.com/%s/%s/%s?t=%d" % (REPO, BRANCH, remote_name, int(time.time()))
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
                raw = r.read()
        json.loads(raw.decode("utf-8"))  # deve essere JSON valido
        d = os.path.dirname(local_path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(local_path, "wb") as fh:
            fh.write(raw)
        return True
    except Exception:  # noqa: BLE001  (ramo o file non ancora presenti: si riparte da zero)
        return False


def push(local_path, remote_name, min_gap=90):
    """Copia il file sul ramo dati (in un thread, al massimo ogni `min_gap` secondi e solo se è cambiato)."""
    if not TOKEN:
        return
    with _lock:
        if remote_name in _busy:
            return
        try:
            with open(local_path, "rb") as fh:
                raw = fh.read()
        except OSError:
            return
        digest = hashlib.sha1(raw).hexdigest()
        last = _last.get(remote_name)
        if last and (last[1] == digest or time.time() - last[0] < min_gap):
            return
        _busy.add(remote_name)

    def work():
        try:
            url = "https://api.github.com/repos/%s/contents/%s" % (REPO, remote_name)
            sha = None
            try:
                sha = _req(url + "?ref=" + BRANCH).get("sha")
            except Exception:  # noqa: BLE001  (file nuovo)
                sha = None
            body = {"message": "dati: aggiornamento %s" % remote_name, "branch": BRANCH, "content": base64.b64encode(raw).decode("ascii")}
            if sha:
                body["sha"] = sha
            _req(url, "PUT", body)
            with _lock:
                _last[remote_name] = (time.time(), digest)
        except Exception as exc:  # noqa: BLE001
            print("persist: invio di %s non riuscito: %s" % (remote_name, exc))
            with _lock:
                _last[remote_name] = (time.time() - min_gap + 30, "")  # riprova tra 30 secondi
        finally:
            with _lock:
                _busy.discard(remote_name)
    threading.Thread(target=work, daemon=True).start()
