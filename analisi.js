/* Analisi avanzata delle mie operazioni: "E se…", confronto con la regola dell'app, mappa giorno × ora, riepilogo fiscale.
   Solo analisi dei risultati passati: nessun consiglio operativo. Usa i dati già caricati in Operazioni (restano sul telefono). */
(function () {
  const $ = (s) => document.querySelector(s);
  const num = (x, d = 2) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (x) => (x > 0 ? "+" : "") + num(x);
  const cls = (x) => (x > 0 ? "g" : x < 0 ? "r" : "");
  const pc = (x, d = 0) => (x == null ? "–" : (x * 100).toFixed(d).replace(".", ",") + "%");
  const GIORNI = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"], TAX = 0.26;
  const D = 86400000;
  let POOL = [];
  const box = (a, b, k) => `<div class="stat"><span>${a}</span><b class="${k || ""}">${b}</b></div>`;
  const real = (pool) => pool.filter((t) => !t.kind).sort((a, b) => a.ct - b.ct);
  const adjSum = (pool) => pool.filter((t) => t.kind === "adj").reduce((a, t) => a + t.net, 0);
  function summary(list, adj) {
    const net = list.reduce((a, t) => a + t.net, 0) + adj, w = list.filter((t) => t.net > 0), l = list.filter((t) => t.net < 0);
    const gw = w.reduce((a, t) => a + t.net, 0), gl = -l.reduce((a, t) => a + t.net, 0);
    let run = adj, peak = Math.max(0, adj), dd = 0; list.forEach((t) => { run += t.net; if (run > peak) peak = run; if (peak - run > dd) dd = peak - run; });
    return { n: list.length, net, win: list.length ? w.length / list.length : null, pf: gl > 0 ? gw / gl : null, dd };
  }

  /* ---------- E se… ---------- */
  const WKEY = "xau_whatif";
  let WI = { wd: "", hr: "", maxn: "", loss: "", lot: "" };
  try { WI = Object.assign(WI, JSON.parse(localStorage.getItem(WKEY) || "{}")); } catch (e) { /* valori di partenza */ }
  const keepFilter = (L, f) => { // f = {wd, hr, maxn, loss, lot}: restituisce [operazioni tenute, con net eventualmente ricalcolato]
    let out = L.filter((t) => (f.wd === "" || new Date(t.ct).getUTCDay() !== +f.wd) && (f.hr === "" || new Date(t.ot).getUTCHours() !== +f.hr));
    const byDay = new Map(); out.forEach((t) => { const k = Math.floor(t.ct / D); (byDay.get(k) || byDay.set(k, []).get(k)).push(t); });
    const maxn = parseInt(f.maxn, 10), loss = parseFloat(String(f.loss).replace(",", "."));
    const res = [];
    byDay.forEach((day) => {
      let d = day.slice();
      if (maxn > 0) d = d.sort((a, b) => a.ot - b.ot || a.ct - b.ct).slice(0, maxn);
      if (loss > 0) { // dopo aver perso `loss` nella giornata non si apre altro: restano le operazioni aperte prima di quel momento
        let run = 0, cut = Infinity; d.slice().sort((a, b) => a.ct - b.ct).forEach((t) => { run += t.net; if (cut === Infinity && run <= -loss) cut = t.ct; });
        d = d.filter((t) => t.ot < cut || t.ct <= cut);
      }
      res.push(...d);
    });
    const lot = parseFloat(String(f.lot).replace(",", "."));
    return res.sort((a, b) => a.ct - b.ct).map((t) => (lot > 0 && t.vol > 0 ? Object.assign({}, t, { net: t.net * (lot / t.vol) }) : t));
  };
  function whatIfBuild() {
    const el = $("#opWhatIf"); if (!el || el.dataset.built) return; el.dataset.built = "1";
    const hrs = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${h}:00</option>`).join("");
    el.innerHTML = `<p class="muted small">Rifaccio la tua storia con una regola diversa e ti dico cosa sarebbe cambiato. Si cambia una regola alla volta o più insieme; i campi vuoti sono ignorati.</p>
      <div class="wi-grid"><label class="small">Escludi il giorno<select id="wiWd"><option value="">nessuno</option>${[1, 2, 3, 4, 5].map((d) => `<option value="${d}">${GIORNI[d]}</option>`).join("")}</select></label>
      <label class="small">Escludi l'ora di apertura<select id="wiHr"><option value="">nessuna</option>${hrs}</select></label>
      <label class="small">Massimo di operazioni al giorno<input id="wiMax" type="text" inputmode="numeric" placeholder="es. 10" autocomplete="off"></label>
      <label class="small">Fermati dopo aver perso (€) nel giorno<input id="wiLoss" type="text" inputmode="decimal" placeholder="es. 150" autocomplete="off"></label>
      <label class="small">Lotto fisso<input id="wiLot" type="text" inputmode="decimal" placeholder="es. 0,03" autocomplete="off"></label></div>
      <div id="wiOut" style="margin-top:10px"></div>`;
    const map = { wiWd: "wd", wiHr: "hr", wiMax: "maxn", wiLoss: "loss", wiLot: "lot" };
    Object.entries(map).forEach(([id, k]) => { const i = $("#" + id); i.value = WI[k]; i.oninput = i.onchange = () => { WI[k] = i.value; try { localStorage.setItem(WKEY, JSON.stringify(WI)); } catch (e) { /* senza */ } whatIf(); }; });
  }
  function whatIf() {
    whatIfBuild(); const out = $("#wiOut"); if (!out) return;
    const L = real(POOL), adj = adjSum(POOL);
    if (L.length < 30) { out.innerHTML = '<p class="muted">Servono almeno 30 operazioni.</p>'; return; }
    const base = summary(L, adj), any = Object.values(WI).some((v) => String(v).trim() !== "");
    let h = "";
    if (any) {
      const K = keepFilter(L, WI), s = summary(K, adj), d = s.net - base.net;
      h += `<div class="statrow">${box("Netto reale", sg(base.net), cls(base.net))}${box("Netto con la regola", sg(s.net), cls(s.net))}${box("Differenza", sg(d), cls(d))}${box("Operazioni", s.n + " su " + base.n)}${box("Vinte", pc(s.win) + " (prima " + pc(base.win) + ")")}${box("Calo massimo", num(s.dd) + " (prima " + num(base.dd) + ")")}${box("Profit factor", s.pf == null ? "–" : num(s.pf) + " (prima " + (base.pf == null ? "–" : num(base.pf)) + ")")}${box("Dopo tasse", sg(s.net > 0 ? s.net * (1 - TAX) : s.net))}</div>`;
    } else h += '<p class="muted small">Scegli una regola qui sopra per vedere la differenza.</p>';
    // prova rapida: quanto pesa ogni giorno e ogni ora sul totale
    const ex = [];
    [1, 2, 3, 4, 5].forEach((d) => { const l = L.filter((t) => new Date(t.ct).getUTCDay() === d); if (l.length >= 20) ex.push({ lab: "tutti i " + ["", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì"][d], n: l.length, v: l.reduce((a, t) => a + t.net, 0) }); });
    for (let hr = 0; hr < 24; hr++) { const l = L.filter((t) => new Date(t.ot).getUTCHours() === hr); if (l.length >= 30) ex.push({ lab: "le operazioni aperte alle " + hr + ":00", n: l.length, v: l.reduce((a, t) => a + t.net, 0) }); }
    ex.sort((a, b) => a.v - b.v);
    const worst = ex.filter((x) => x.v < 0).slice(0, 3), best = ex.slice(-2).filter((x) => x.v > 0).reverse();
    if (worst.length || best.length) h += '<div class="ctl-label" style="margin-top:6px">Quanto pesa ogni parte sul totale</div>' + worst.map((x) => `<p class="small">Senza ${x.lab} (${x.n} operazioni) il totale cambierebbe di <b class="g">${sg(-x.v)}</b>: hanno perso ${num(-x.v)}.</p>`).join("") + best.map((x) => `<p class="small">${x.lab[0].toUpperCase() + x.lab.slice(1)} (${x.n} operazioni) hanno guadagnato <b class="g">${sg(x.v)}</b>: togliendole perderesti quella parte.</p>`).join("");
    h += `<p class="muted small"><b>Attenzione:</b> guardando il passato, togliere le parti andate male dà sempre un numero migliore. Serve a capire <i>dove</i> si perde, non a prevedere il futuro: con pochi mesi di dati un giorno o un'ora "cattivi" possono essere solo caso. Le operazioni si sovrappongono nel tempo, quindi il calcolo è approssimato.</p>`;
    out.innerHTML = h;
  }

  /* ---------- tu contro la regola dell'app ---------- */
  const BS = { tf: "1h", rr: "2" }; let BC = {}, benchBusy = false;
  function benchBuild() {
    const el = $("#opBench"); if (!el || el.dataset.built) return; el.dataset.built = "1";
    el.innerHTML = `<p class="muted small">Cosa avrebbe fatto la regola base dell'app (breakout di 20 barre, stop = 1 ATR) sull'oro nello stesso periodo in cui hai operato tu. Non solo i segnali "netti": <b>tutti</b> i breakout, senza scegliere.</p>
      <div class="row gap"><div class="seg small" id="bnTf"></div><div class="seg small" id="bnRr"></div></div><div id="bnOut" style="margin-top:10px"></div>`;
    const mk = (id, items, key) => seg($(id), items, BS[key], (v) => { BS[key] = v; benchBuild2(); benchLoad(); });
    window.__bnMk = () => { mk("#bnTf", [{ label: "30m", value: "30m" }, { label: "1h", value: "1h" }, { label: "4h", value: "4h" }], "tf"); mk("#bnRr", [{ label: "2R", value: "2" }, { label: "3R", value: "3" }, { label: "4R", value: "4" }], "rr"); };
    window.__bnMk();
  }
  const benchBuild2 = () => window.__bnMk && window.__bnMk();
  async function benchLoad() {
    benchBuild(); const out = $("#bnOut"); if (!out) return;
    const L = real(POOL).filter((t) => !t.sym || /XAU|GOLD/i.test(t.sym));
    if (L.length < 30) { out.innerHTML = '<p class="muted">Servono almeno 30 operazioni sull\'oro.</p>'; return; }
    const t0 = Math.floor(L[0].ct / 1000) - 3600, t1 = Math.floor(L[L.length - 1].ct / 1000), key = [Math.floor(t0 / 3600), Math.floor(t1 / 3600), BS.tf, BS.rr].join("|");
    if (!BC[key]) {
      if (benchBusy) return; benchBusy = true; out.innerHTML = '<p class="muted">Calcolo…</p>';
      try { const r = await fetch(`/api/benchmark?t0=${t0}&t1=${t1}&tf=${BS.tf}&rr=${BS.rr}`, { cache: "no-store" }), j = await r.json(); if (!r.ok) throw new Error(j.error || "errore"); BC[key] = j; }
      catch (e) { out.innerHTML = `<p class="muted">Non riesco a calcolare adesso (${e.message}).</p>`; benchBusy = false; return; }
      benchBusy = false;
    }
    const b = BC[key], my = summary(L, 0), days = new Set(L.map((t) => Math.floor(t.ct / D))).size;
    const lots = L.filter((t) => t.vol > 0), lot = lots.length ? lots.reduce((a, t) => a + t.vol, 0) / lots.length : null;
    const usd = lot && b.avg_risk ? b.cases.reduce((a, c) => a + c.r * c.risk * 100 * lot, 0) : null; // 1 lotto = 100 once
    const partial = b.first && t0 < b.first;
    out.innerHTML = `<div class="statrow">${box("Segnali della regola", b.n)}${box("Target presi", b.n ? pc(b.win / b.n) : "–", "g")}${box("Stop presi", b.n ? pc(b.stop / b.n) : "–", "r")}${box("Totale in R", (b.total_r >= 0 ? "+" : "") + num(b.total_r, 1) + " R", cls(b.total_r))}${box("R medio per segnale", b.n ? (b.total_r / b.n >= 0 ? "+" : "") + num(b.total_r / b.n, 2) : "–")}${usd != null ? box("Al tuo lotto medio (" + num(lot, 3) + ")", "circa " + sg(usd) + " $", cls(usd)) : ""}</div>
      <div class="statrow" style="margin-top:6px">${box("Le tue operazioni", my.n)}${box("Vinte", pc(my.win))}${box("Tuo netto", sg(my.net), cls(my.net))}${box("Per giorno operativo", num(my.n / days, 1) + " op.")}</div>
      <p class="small">${b.n ? `Sullo stesso periodo la regola base ha dato <b>${b.n}</b> segnali (${num(b.n / days, 1)} per giorno operativo) contro le tue <b>${my.n}</b> operazioni${usd != null ? `: a parità di lotto circa <b class="${cls(usd)}">${sg(usd)} $</b> contro il tuo <b class="${cls(my.net)}">${sg(my.net)}</b>` : ""}.` : "Nel periodo non ci sono segnali con questa impostazione."}</p>
      <p class="muted small">Come leggerlo: la regola ha uno stop definito e un target (${b.rr}R); tu operi con un metodo diverso e senza stop registrato, quindi il confronto è indicativo. Dati del future dell'oro (differiscono dal tuo broker), costi e swap ignorati, importo in dollari ad ordine di grandezza. ${partial ? "I dati di questo time frame non coprono tutto il tuo periodo: il confronto è parziale. " : ""}Non dice cosa fare: dice quanto una regola semplice, senza scelte, avrebbe reso nello stesso tempo.</p>`;
  }

  /* ---------- mappa giorno × ora ---------- */
  function heat() {
    const el = $("#opHeat"); if (!el) return;
    if (!el.dataset.built) { el.dataset.built = "1"; el.innerHTML = '<p class="muted small">Quando guadagni e quando perdi: ogni casella è un giorno della settimana e un\'ora di apertura (orario del tuo broker). Verde = guadagno, rosso = perdita; il numero piccolo sono le operazioni. Tocca una casella per i dettagli.</p><canvas id="cvOpHeat" class="cv short" style="height:230px"></canvas>'; }
    const cv = $("#cvOpHeat"); if (!cv || typeof setupCanvas !== "function") return;
    const L = real(POOL), k = setupCanvas(cv); if (!k) return; const { c, w, h } = k;
    if (L.length < 30) { c.fillStyle = css("--muted"); c.font = "13px sans-serif"; c.fillText("Servono almeno 30 operazioni.", 8, 24); return; }
    const cell = new Map(); L.forEach((t) => { const d = new Date(t.ot), key = d.getUTCDay() * 100 + d.getUTCHours(); const o = cell.get(key) || { n: 0, v: 0, w: 0 }; o.n++; o.v += t.net; if (t.net > 0) o.w++; cell.set(key, o); });
    const hs = [...new Set([...cell.keys()].map((x) => x % 100))].sort((a, b) => a - b), hMin = hs[0], hMax = hs[hs.length - 1], cols = hMax - hMin + 1;
    const ml = 34, mt = 16, mb = 4, cw = (w - ml - 4) / cols, rh = (h - mt - mb) / 5, mx = Math.max(...[...cell.values()].map((o) => Math.abs(o.v))) || 1;
    c.font = "10px sans-serif"; c.textAlign = "center"; c.fillStyle = css("--muted");
    for (let j = 0; j < cols; j++) if (cols <= 14 || j % 2 === 0) c.fillText(String(hMin + j), ml + j * cw + cw / 2, 11);
    [1, 2, 3, 4, 5].forEach((d, i) => { c.textAlign = "left"; c.fillStyle = css("--muted"); c.fillText(GIORNI[d], 2, mt + i * rh + rh / 2 + 3);
      for (let j = 0; j < cols; j++) { const o = cell.get(d * 100 + hMin + j), x = ml + j * cw, y = mt + i * rh; if (!o) { c.fillStyle = "rgba(255,255,255,.04)"; c.fillRect(x + 1, y + 1, cw - 2, rh - 2); continue; }
        const a = 0.18 + 0.72 * Math.min(1, Math.abs(o.v) / mx); c.fillStyle = o.v >= 0 ? `rgba(60,190,120,${a})` : `rgba(235,80,90,${a})`; c.fillRect(x + 1, y + 1, cw - 2, rh - 2);
        if (cw > 15) { c.fillStyle = "rgba(255,255,255,.85)"; c.textAlign = "center"; c.fillText(String(o.n), x + cw / 2, y + rh / 2 + 3); } } });
    cv._hit = (x, y) => { const j = Math.floor((x - ml) / cw), i = Math.floor((y - mt) / rh); if (j < 0 || j >= cols || i < 0 || i > 4) return null; const o = cell.get((i + 1) * 100 + hMin + j); const lab = `<b>${GIORNI[i + 1]} ore ${hMin + j}:00</b>`; if (!o) return lab + "<br>Nessuna operazione."; return `${lab}<br>${o.n} operazioni · vinte ${pc(o.w / o.n)}<br>Totale <b class="${cls(o.v)}">${sg(o.v)}</b> · media ${sg(o.v / o.n)}${o.n < 10 ? '<br><span class="muted">Poche operazioni: può essere caso.</span>' : ""}`; };
  }

  /* ---------- riepilogo fiscale ---------- */
  function tax() {
    const el = $("#opTax"); if (!el || !window.OP) return;
    const L = real(POOL), adj = POOL.filter((t) => t.kind === "adj"); if (!L.length) { el.innerHTML = '<p class="muted">Nessuna operazione.</p>'; return; }
    const years = new Map(); L.concat(adj).forEach((t) => { const y = new Date(t.ct).getUTCFullYear(); years.set(y, (years.get(y) || 0) + t.net); });
    const per = new Map(); POOL.forEach((t) => { const s = OP.periodStart(t.ct); per.set(s, (per.get(s) || 0) + t.net); });
    const perList = [...per.entries()].sort((a, b) => b[0] - a[0]);
    const taxP = perList.reduce((a, [, v]) => a + (v > 0 ? v * TAX : 0), 0), totP = perList.reduce((a, [, v]) => a + v, 0);
    el.innerHTML = `<div class="statrow">${box("Risultato netto totale", sg(totP), cls(totP))}${box("Da accantonare (26% per periodo)", num(taxP), "r")}${box("Dopo tasse", sg(totP - taxP), cls(totP - taxP))}</div>
      <div class="ctl-label" style="margin-top:10px">Per anno (compensando le perdite tra i periodi)</div>
      ${[...years.entries()].sort((a, b) => b[0] - a[0]).map(([y, v]) => `<div class="sigrow"><div class="sr1"><b>${y}</b><span class="when ${cls(v)}" style="font-weight:700">${sg(v)}</span></div><div class="sr2"><span>Tasse stimate <b>${num(v > 0 ? v * TAX : 0)}</b></span><span>Dopo tasse <b>${sg(v > 0 ? v * (1 - TAX) : v)}</b></span></div></div>`).join("")}
      <div class="ctl-label" style="margin-top:10px">Per periodo (come nel resto dell'app)</div>
      ${perList.map(([s, v]) => `<div class="sigrow"><div class="sr1"><b>${OP.periodLabel(s)}</b><span class="when ${cls(v)}" style="font-weight:700">${sg(v)}</span></div><div class="sr2"><span>Da tenere da parte (26%) <b>${num(v > 0 ? v * TAX : 0)}</b></span><span>Dopo tasse <b>${sg(v > 0 ? v * (1 - TAX) : v)}</b></span></div></div>`).join("")}
      <div class="row gap" style="margin-top:10px"><button class="btn" id="taxCsv">Scarica il riepilogo (CSV)</button></div>
      <p class="muted small">Stima indicativa al 26% sul guadagno netto (profitti + swap + commissioni). Non è consulenza fiscale: la tassazione vera dipende dalla tua situazione (regime, broker estero, compensazione delle perdite negli anni, cambio euro/dollaro). Le righe provvisorie da video verranno corrette con l'estratto mensile. Fai verificare i numeri a chi ti segue prima di usarli.</p>`;
    const b = $("#taxCsv"); if (b) b.onclick = () => {
      const rows = [["tipo", "periodo", "netto", "tasse_stimate_26", "dopo_tasse"]];
      [...years.entries()].sort().forEach(([y, v]) => rows.push(["anno", y, v.toFixed(2), (v > 0 ? v * TAX : 0).toFixed(2), (v > 0 ? v * (1 - TAX) : v).toFixed(2)]));
      perList.slice().reverse().forEach(([s, v]) => rows.push(["periodo", OP.periodLabel(s), v.toFixed(2), (v > 0 ? v * TAX : 0).toFixed(2), (v > 0 ? v * (1 - TAX) : v).toFixed(2)]));
      const blob = new Blob(["﻿" + rows.map((r) => r.join(";")).join("\n")], { type: "text/csv" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "riepilogo-fiscale.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  window.addEventListener("resize", () => { try { heat(); } catch (e) { /* senza: resta com'è */ } });
  window.opExtras = function (pool) { POOL = pool; try { whatIf(); heat(); tax(); benchLoad(); } catch (e) { console.error("analisi.js", e); } };
  if (window.OP && OP.all().length) setTimeout(() => window.opExtras(OP.all()), 0); // trades.js ha già disegnato prima che questo file fosse pronto
})();
