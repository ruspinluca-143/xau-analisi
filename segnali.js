/* Segnali automatici: filtri e "Dove sbagli".
   I filtri restringono l'elenco e le statistiche; la tabella "Dove sbagli" confronta le categorie (time frame, setup, direzione, target, ora, giorno)
   per capire dove i segnali vanno peggio. Solo analisi del passato: pochi segnali = numeri poco affidabili, e lo dice. */
(function () {
  const box = document.getElementById("autoFilter"), where = document.getElementById("autoWhere");
  if (!box || !where) return;
  const WD = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  const partsRome = (ts) => { const f = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(ts * 1000)); const o = {}; f.forEach((p) => { o[p.type] = p.value; }); return o; };
  const hourOf = (x) => Number(partsRome(x.entry_ts).hour) % 24;
  const wdOf = (x) => { const w = partsRome(x.entry_ts).weekday.toLowerCase().slice(0, 3); return { lun: "Lun", mar: "Mar", mer: "Mer", gio: "Gio", ven: "Ven", sab: "Sab", dom: "Dom" }[w] || w; };
  const kindOf = (x) => (!x.symbol || x.symbol === "XAUUSD" ? "oro" : /-USD$/.test(x.symbol) ? "cripto" : "titoli");
  const KINDN = { oro: "Oro", titoli: "Titoli", cripto: "Cripto" };
  const SETUPN = { breakout: "Breakout", london: "Apertura Londra", ny: "Apertura New York" };
  const DIMS = {
    tf: { label: "Time frame", get: (x) => x.tf, order: ["5m", "30m", "1h", "4h", "1d"] },
    setup: { label: "Setup", get: (x) => SETUPN[x.setup] || x.setup, order: ["Breakout", "Apertura Londra", "Apertura New York"] },
    dir: { label: "Direzione", get: (x) => (x.dir === "buy" ? "BUY" : "SHORT"), order: ["BUY", "SHORT"] },
    rr: { label: "Target", get: (x) => x.rr + "R", order: ["2R", "3R", "4R"] },
    hour: { label: "Ora", get: (x) => String(hourOf(x)).padStart(2, "0") + ":00", order: null },
    wd: { label: "Giorno", get: (x) => wdOf(x), order: ["Lun", "Mar", "Mer", "Gio", "Ven"] },
    kind: { label: "Strumento", get: (x) => KINDN[kindOf(x)], order: ["Oro", "Titoli", "Cripto"] },
    sym: { label: "Simbolo", get: (x) => x.symbol || "XAUUSD", order: null, limit: 12 },
    tier: { label: "Livello", get: (x) => (x.tier === "netto" ? "Netto" : x.tier === "possibile" ? "Possibile" : "Oro (criterio normale)"), order: null },
  };
  const F = { tf: "", setup: "", dir: "", rr: "", res: "", kind: "" }; // filtri attivi
  let DIM = "tf";
  const FKEY = { tf: "tf", setup: "setup", dir: "dir", rr: "rr", kind: "kind", hour: null, wd: null, sym: null, tier: null };
  const passes = (x, skip) => (skip === "tf" || !F.tf || x.tf === F.tf) && (skip === "setup" || !F.setup || x.setup === F.setup) && (skip === "dir" || !F.dir || x.dir === F.dir)
    && (skip === "rr" || !F.rr || String(x.rr) === F.rr) && (skip === "kind" || !F.kind || kindOf(x) === F.kind) && (!F.res || (F.res === "open" ? x.status === "open" : F.res === "chiusi" ? ["target", "stop", "none"].includes(x.status) : x.status === F.res));
  window.autoPass = (x) => passes(x, null);
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  box.innerHTML = `<label class="small">Strumento<select data-f="kind">${opt("", "Tutti")}${opt("oro", "Oro")}${opt("titoli", "Titoli")}${opt("cripto", "Cripto")}</select></label>
    <label class="small">Time frame<select data-f="tf">${opt("", "Tutti")}${DIMS.tf.order.map((v) => opt(v, v)).join("")}</select></label>
    <label class="small">Setup<select data-f="setup">${opt("", "Tutti")}${opt("breakout", "Breakout")}${opt("london", "Apertura Londra")}${opt("ny", "Apertura New York")}</select></label>
    <label class="small">Direzione<select data-f="dir">${opt("", "Tutte")}${opt("buy", "BUY")}${opt("sell", "SHORT")}</select></label>
    <label class="small">Target<select data-f="rr">${opt("", "Tutti")}${opt("2", "2R")}${opt("3", "3R")}${opt("4", "4R")}</select></label>
    <label class="small">Esito<select data-f="res">${opt("", "Tutti")}${opt("chiusi", "Chiusi")}${opt("target", "Solo target")}${opt("stop", "Solo stop")}${opt("none", "Senza esito netto")}${opt("open", "Aperti")}</select></label>
    <button class="btn" id="afReset" type="button">Togli i filtri</button>
    <button class="btn" id="afCsv" type="button">Scarica segnali (CSV)</button>`;
  const sync = () => { box.querySelectorAll("select").forEach((s) => { s.value = F[s.dataset.f]; }); };
  box.querySelectorAll("select").forEach((s) => { s.onchange = () => { F[s.dataset.f] = s.value; if (typeof renderAuto === "function") renderAuto(); }; });
  box.querySelector("#afReset").onclick = () => { Object.keys(F).forEach((k) => (F[k] = "")); sync(); if (typeof renderAuto === "function") renderAuto(); };
  box.querySelector("#afCsv").onclick = () => {
    const L = (window.autoCurrent || []).slice().sort((x, y) => x.entry_ts - y.entry_ts);
    const when = (ts) => new Date(ts * 1000).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const num = (v) => (v == null ? "" : String(v).replace(".", ","));
    const rows = [["data_ora_italia", "strumento", "time_frame", "setup", "direzione", "target_R", "ingresso", "stop", "target_prezzo", "esito", "R", "livello"]];
    L.forEach((x) => rows.push([when(x.entry_ts), x.symbol || "XAUUSD", x.tf, SETUPN[x.setup] || x.setup, x.dir === "buy" ? "BUY" : "SHORT", num(x.rr), num(x.entry), num(x.stop), num(x.target), x.status, num(x.r), x.tier || ""]));
    const blob = new Blob(["\ufeff" + rows.map((r) => r.join(";")).join("\n")], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "segnali-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  const n1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const sg = (x) => (x > 0 ? "+" : "") + n1(x), cl = (x) => (x > 0 ? "g" : x < 0 ? "r" : "");
  const p0 = (x) => Math.round(x * 100) + "%";

  window.autoBreakdown = function (base) {
    const closed = base.filter((x) => ["target", "stop", "none"].includes(x.status) && x.r != null);
    const dimSeg = Object.entries(DIMS).map(([k, d]) => `<button type="button" data-d="${k}" class="${k === DIM ? "on" : ""}" aria-pressed="${k === DIM}">${d.label}</button>`).join("");
    const D = DIMS[DIM], skip = FKEY[DIM];
    const use = closed.filter((x) => passes(x, skip)), g = new Map();
    use.forEach((x) => { const k = D.get(x); const o = g.get(k) || { n: 0, w: 0, l: 0, r: 0 }; o.n++; if (x.status === "target") o.w++; if (x.status === "stop") o.l++; o.r += x.r; g.set(k, o); });
    let keys = [...g.keys()];
    keys = keys.sort((a, b) => g.get(a).r / g.get(a).n - g.get(b).r / g.get(b).n); // dai peggiori ai migliori
    const shown = D.limit && keys.length > D.limit ? keys.slice(0, D.limit) : keys;
    const rows = shown.map((k) => { const o = g.get(k), avg = o.r / o.n, few = o.n < 8; return `<div class="sigrow"><div class="sr1"><b>${k}</b><span>${o.n} chiusi</span><span class="when ${cl(avg)}" style="font-weight:700">R medio ${sg(avg)}</span></div><div class="sr2"><span>Target <b class="g">${p0(o.w / o.n)}</b></span><span>Stop <b class="r">${p0(o.l / o.n)}</b></span><span>R totale <b class="${cl(o.r)}">${sg(o.r)}</b></span>${few ? '<span class="pill">pochi casi</span>' : ""}</div></div>`; }).join("");
    const solid = keys.filter((k) => g.get(k).n >= 8);
    let read = "";
    if (solid.length >= 2) { const w = solid[0], b = solid[solid.length - 1], ow = g.get(w), ob = g.get(b); read = `<p class="small"><b>Lettura:</b> la categoria più debole è <b>${w}</b> (R medio <b class="${cl(ow.r / ow.n)}">${sg(ow.r / ow.n)}</b> su ${ow.n} segnali chiusi), la migliore <b>${b}</b> (<b class="${cl(ob.r / ob.n)}">${sg(ob.r / ob.n)}</b> su ${ob.n}).</p>`; }
    else if (use.length) read = '<p class="muted small">Troppo pochi segnali chiusi per confrontare le categorie con un senso: servono almeno 8 per categoria.</p>';
    where.innerHTML = `<div class="ctl-label" style="margin-top:10px">Dove sbagli</div>
      <p class="muted small">Confronto tra categorie, dalla peggiore alla migliore. Usa anche i filtri qui sopra (tranne quello della categoria che stai guardando). R medio sotto zero = in media si perde.</p>
      <div class="seg small" id="afDim" style="margin:4px 0 8px">${dimSeg}</div>
      ${rows || '<p class="muted small">Nessun segnale chiuso con questi filtri.</p>'}${shown.length < keys.length ? `<p class="muted small">Mostro i ${shown.length} peggiori su ${keys.length}.</p>` : ""}${read}
      <p class="muted small">Con pochi segnali il caso pesa molto: una categoria "peggiore" con 5-6 segnali può essere solo sfortuna. Cerca i punti deboli che restano tali quando i segnali aumentano.</p>`;
    where.querySelectorAll("#afDim button").forEach((b) => (b.onclick = () => { DIM = b.dataset.d; window.autoBreakdown(base); }));
  };
  sync();
})();
