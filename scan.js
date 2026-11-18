/* Scanner titoli e cripto: mostra i segnali con vantaggio trovati dal controllo automatico del server (/api/scan).
   Solo analisi: nessun ordine. Il pulsante "Analizza" apre il titolo nell'analisi completa (grafico, Time Machine). */
(function () {
  const box = document.querySelector("#scanList");
  if (!box) return;
  let D = null, err = "", last = 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const px = (x) => Number(x).toLocaleString("it-IT", { minimumFractionDigits: x < 100 ? 2 : 0, maximumFractionDigits: x < 100 ? 2 : 0 });
  const pc = (x, d = 0) => (x * 100).toFixed(d).replace(".", ",") + "%";
  const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  const when = (ts) => { const m = Math.round((Date.now() / 1000 - ts) / 60); if (m < 2) return "adesso"; if (m < 90) return m + " min fa"; const h = Math.round(m / 60); return h < 48 ? h + " ore fa" : Math.round(h / 24) + " giorni fa"; };
  const TFN = { "1d": "giornaliero", "1h": "1 ora" };

  function render() {
    if (D === null) { box.innerHTML = `<p class="muted">${err || "Carico lo scanner…"}</p>`; return; }
    const runs = D.runs || {}, any = runs["1d"] || runs["1h"], sigs = D.signals || [];
    let h = "";
    if (!any) h += `<p class="muted">Il primo controllo è in corso${D.running ? " (ci vogliono un paio di minuti)" : ", parte da solo a breve"}.</p>`;
    else if (!sigs.length) h += `<p class="muted">Nessun titolo con vantaggio adesso. È normale: il criterio è severo e passano anche giorni senza segnali.</p>`;
    sigs.forEach((s) => {
      const up = s.dir === "buy";
      h += `<div class="sigrow"><div class="sr1"><b style="font-size:15px">${esc(s.sym)}</b> <b class="dir ${up ? "buy" : "sell"}">${up ? "BUY" : "SHORT"}</b> <span>${TFN[s.tf] || s.tf}</span><span class="when">${when(s.entry_ts)}</span></div>
        <div class="sr2"><span>Ingresso <b>${px(s.entry)}</b></span><span>Stop <b>${px(s.stop)}</b></span><span>Target ${s.rr}R <b>${px(s.target)}</b></span></div>
        <div class="sr3"><span class="pill ${s.tier === "netto" ? "green" : "amber"}">${s.tier === "netto" ? "Vantaggio netto" : "Vantaggio possibile"}</span>
          <span class="pill">Simulazione: target ${pc(s.sim_target)} · stop ${pc(s.sim_stop)}</span><span class="pill">Storico: ${s.hist_n} casi, R medio ${(s.hist_r >= 0 ? "+" : "") + String(s.hist_r.toFixed(2)).replace(".", ",")}</span>
          <button class="btn" data-an="${esc(s.sym)}|${s.tf}|${s.rr}|${s.dir}">Analizza</button></div></div>`;
    });
    box.innerHTML = h;
    box.querySelectorAll("[data-an]").forEach((b) => (b.onclick = () => {
      const [sym, tf, rr, dir] = b.dataset.an.split("|");
      S.symbol = sym; $("#symbol").value = sym; S.ov = null; S.spot = ""; $("#spot").value = ""; S.setup = "breakout"; S.tf = tf; S.rr = +rr; S.dir = dir; S.selCase = null;
      buildTf(); buildSetupSeg(); buildRr(); buildDirSegs(); $("#tabs [data-tab=oggi]").click(); window.load();
    }));
    const u = document.querySelector("#scanUpd");
    if (u && any) {
      const parts = ["1d", "1h"].filter((k) => runs[k]).map((k) => `${TFN[k]}: ${hhmm(runs[k].t)}, ${runs[k].checked} controllati${runs[k].errors ? " (" + runs[k].errors + " senza dati)" : ""}`);
      u.textContent = `Ultimi controlli — ${parts.join(" · ")}. ${D.running ? "Controllo in corso…" : ""}`;
    }
  }
  async function load(force) {
    if (!force && D && Date.now() - last < 3 * 60000) return render();
    try {
      const r = await fetch("/api/scan", { cache: "no-store" }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "errore");
      D = j; last = Date.now(); err = "";
    } catch (e) { err = "Non riesco a leggere lo scanner adesso (" + e.message + ")."; }
    render();
  }
  load();
  new MutationObserver(() => { if (document.body.dataset.tab === "avvisi") load(); }).observe(document.body, { attributes: true, attributeFilter: ["data-tab"] });
  setInterval(() => { if (document.body.dataset.tab === "avvisi") load(true); }, 5 * 60000);
})();
