/* Copia di sicurezza dei dati che stanno solo sul telefono (operazioni, depositi e prelievi, diario, archivio dei segnali, impostazioni).
   "Salva copia" scarica un file; "Ripristina da copia" lo rilegge UNENDO i dati (non cancella e non sovrascrive quelli già presenti). */
(function () {
  const $ = (s) => document.querySelector(s);
  const ARR = ["xau_trades_v1", "xau_movimenti_v1", "xau_journal"];       // elenchi di elementi con "id"
  const OBJ = ["xau_archive_v1"];                                          // oggetti indicizzati per "id"
  const SET = ["xau_lotto", "xau_reset_fav", "xau_whatif", "xau_chart_opts", "xau_alerts", "xau_collapsed_v2", "xau_pin"];  // impostazioni: si ripristinano solo se mancano
  const KEYS = ARR.concat(OBJ, SET);
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const note = (t, bad) => { const n = $("#bkNote"); if (n) { n.textContent = t; n.className = "small" + (bad ? " r" : ""); } };
  function warn() {
    const w = $("#bkWarn"); if (!w) return;
    const n = read("xau_trades_v1", []).length, ts = Number(localStorage.getItem("xau_backup_ts")) || 0, days = ts ? Math.floor((Date.now() - ts) / 86400000) : null;
    if (n < 1 || (ts && days < 14)) { w.hidden = true; return; }
    w.hidden = false;
    w.textContent = ts ? "L'ultima copia di sicurezza è di " + days + " giorni fa: salvane una nuova (in fondo a questa schermata)." : "Non hai ancora una copia di sicurezza dei tuoi dati: salvala (in fondo a questa schermata). Se cancelli i dati del browser li perdi.";
  }
  function save() {
    const data = {};
    KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v != null) data[k] = v; });
    const obj = { app: "xau-analisi", versione: 1, salvato: new Date().toISOString(), dati: data };
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "xau-copia-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    try { localStorage.setItem("xau_backup_ts", String(Date.now())); } catch (e) { /* senza: la copia è stata scaricata lo stesso */ }
    const t = read("xau_trades_v1", []).length;
    note("Copia salvata (" + t + " operazioni). Tienila fuori dal telefono: nel cloud o via email.");
    warn();
  }
  async function restore(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { return note("Il file non è una copia valida.", true); }
    if (!obj || obj.app !== "xau-analisi" || typeof obj.dati !== "object") return note("Il file non è una copia di sicurezza di questa app.", true);
    let added = 0;
    try {
      ARR.forEach((k) => {
        if (obj.dati[k] == null) return;
        const inc = JSON.parse(obj.dati[k]), cur = read(k, []), ids = new Set(cur.map((x) => x && x.id));
        if (!Array.isArray(inc)) return;
        inc.forEach((x) => { if (x && x.id != null && !ids.has(x.id)) { cur.push(x); ids.add(x.id); if (k === "xau_trades_v1") added++; } });
        localStorage.setItem(k, JSON.stringify(cur));
      });
      OBJ.forEach((k) => { if (obj.dati[k] == null) return; const inc = JSON.parse(obj.dati[k]), cur = read(k, {}); if (inc && typeof inc === "object") localStorage.setItem(k, JSON.stringify(Object.assign({}, inc, cur))); });
      SET.forEach((k) => { if (obj.dati[k] != null && localStorage.getItem(k) == null) localStorage.setItem(k, obj.dati[k]); });
    } catch (e) { return note("Non riesco a leggere la copia: " + e.message, true); }
    note("Ripristino fatto: " + added + " operazioni aggiunte. Ricarico la pagina…");
    setTimeout(() => location.reload(), 900);
  }
  const b = $("#bkSave"), f = $("#bkFile");
  if (b) b.onclick = save;
  if (f) f.onchange = () => { if (f.files[0]) restore(f.files[0]); f.value = ""; };
  warn();
  setInterval(warn, 60000);
})();
