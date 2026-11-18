/* Quadro di mercato: semaforo del giorno, dollaro/rendimenti, sessioni dell'oro, reazione alla Fed.
   Solo analisi: misure sul passato e avvisi che scegli tu. Nessun ordine, nessuna previsione. */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n2 = (x, d = 2) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (x, d = 2) => (x > 0 ? "+" : "") + n2(x, d);
  const cl = (x) => (x > 0 ? "g" : x < 0 ? "r" : "");
  const pc = (x, d = 0) => (x == null ? "–" : (x * 100).toFixed(d).replace(".", ",") + "%");
  const box = (a, b, k) => `<div class="stat"><span>${a}</span><b class="${k || ""}">${b}</b></div>`;
  const get = async (u) => { const r = await fetch(u, { cache: "no-store" }), j = await r.json(); if (!r.ok) throw new Error(j.error || "errore"); return j; };
  let CTX = null, CAL = null;

  /* ---------- semaforo del giorno (sotto il prezzo) + quadro di mercato ---------- */
  const left = (ts) => { const m = Math.round((ts - Date.now() / 1000) / 60); return m < 90 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min"; };
  function mood() {
    const el = $("#mood"); if (!el) return;
    if (!CTX || !(typeof S === "undefined" || S.gold)) { el.hidden = true; return; }
    const m = CTX.mood, parts = [];
    if (m.weekend) parts.push("mercato chiuso nel fine settimana");
    else {
      const col = m.label === "agitata" ? "r" : m.label === "tranquilla" ? "g" : "";
      parts.push(`giornata <b class="${col}">${m.label}</b>${m.ratio != null ? " (movimento di oggi " + n2(m.ratio, 1) + "× il normale)" : ""}`, "sessione " + m.session);
    }
    const nx = (CAL || []).filter((e) => e.ts > Date.now() / 1000 && ["USD", "EUR", "GBP"].includes((e.country || "").toUpperCase())).sort((a, b) => a.ts - b.ts)[0];
    if (nx) parts.push(`notizia rossa tra <b>${left(nx.ts)}</b>`);
    el.innerHTML = parts.join(" · "); el.hidden = false;
  }
  function ctxCard() {
    const el = $("#ctxBody"); if (!el) return;
    if (!CTX) { el.innerHTML = '<p class="muted">Carico…</p>'; return; }
    const rows = CTX.rows.map((r) => {
      const chg = r.kind === "bp" ? sg(r.chg_abs * 100, 0) + " pb" : r.kind === "pt" ? sg(r.chg_abs, 2) : sg(r.chg_pct, 2) + "%";
      const unus = Math.abs(r.z) >= 2 ? '<span class="pill amber">insolito</span>' : Math.abs(r.z) >= 1 ? '<span class="pill">sopra il normale</span>' : '<span class="pill">nella norma</span>';
      const co = r.corr == null ? "–" : (r.corr > 0 ? "+" : "") + n2(r.corr, 2);
      return `<div class="sigrow"><div class="sr1"><b>${esc(r.name)}</b><span class="when ${cl(r.chg_pct)}" style="font-weight:700">${chg}</span></div><div class="sr2"><span>Ora <b>${n2(r.last, r.last > 1000 ? 0 : 2)}</b></span><span>Con l'oro (30 giorni) <b>${co}</b></span>${unus}</div></div>`;
    }).join("");
    el.innerHTML = `<p class="muted small">Cosa fanno oggi i mercati che di solito muovono l'oro. La correlazione va da -1 (si muovono al contrario) a +1 (insieme): è un'abitudine recente, non una regola. Oro oggi: <b class="${cl(CTX.gold.chg_pct)}">${sg(CTX.gold.chg_pct)}%</b>.</p>${rows}${CTX.notes.map((t) => `<p class="small"><b>⚠</b> ${esc(t)}</p>`).join("")}<p class="muted small">Dati Yahoo (possono avere qualche minuto di ritardo). Misura il passato: non prevede cosa farà l'oro.</p>`;
  }
  async function loadCtx() {
    try { CTX = await get("/api/context"); } catch (e) { const el = $("#ctxBody"); if (el && !CTX) el.innerHTML = `<p class="muted">Non riesco a leggere il quadro adesso (${esc(e.message)}).</p>`; }
    try { const c = await get("/api/calendar"); CAL = c.events || []; } catch (e) { /* senza calendario il semaforo funziona lo stesso */ }
    mood(); ctxCard();
  }

  /* ---------- sessioni ---------- */
  let SES = null;
  function sesCard() {
    const el = $("#sesBody"); if (!el) return;
    if (!SES) { el.innerHTML = '<p class="muted">Carico…</p>'; return; }
    if (!el.dataset.built) { el.dataset.built = "1"; el.innerHTML = '<p class="muted small">Quanto si muove in media l\'oro in ogni ora del giorno (ora italiana), calcolato su circa due anni di barre da 1 ora (giorni feriali). Barre più alte = più movimento, quindi più rischio e più occasioni. Tocca una barra.</p><canvas id="cvSes" class="cv short"></canvas><div id="sesTbl"></div><p class="muted small" id="sesNote"></p>'; }
    const hs = SES.hours.filter((x) => x.n > 0), mx = Math.max(...hs.map((x) => x.range)) || 1, nowH = SES.now.hour;
    const cv = $("#cvSes"), k = typeof setupCanvas === "function" && setupCanvas(cv);
    if (k) {
      const { c, w, h } = k, ml = 6, mr = 8, mt = 10, mb = 18, bw = (w - ml - mr) / 24, Y = (v) => mt + (1 - v / (mx * 1.1)) * (h - mt - mb);
      c.fillStyle = css("--muted"); c.textAlign = "center"; c.font = "10px sans-serif";
      SES.hours.forEach((x, i) => { const bx = ml + i * bw; c.fillStyle = i === nowH ? css("--accent") : x.range > mx * 0.75 ? css("--red") : css("--blue"); c.globalAlpha = x.n ? 1 : 0.2; c.fillRect(bx + 1.5, Y(x.range), bw - 3, h - mb - Y(x.range)); c.globalAlpha = 1; if (i % 3 === 0) { c.fillStyle = css("--muted"); c.fillText(String(i), bx + bw / 2, h - 4); } });
      cv._hit = (x) => { const i = Math.floor((x - ml) / bw), s = SES.hours[i]; if (!s || !s.n) return null; return `<b>Ore ${i}:00 – ${i + 1}:00</b>${i === nowH ? " (adesso)" : ""}<br>Movimento medio: <b>${n2(s.range, 1)} $</b> in un'ora<br>Chiude in rialzo nel <b>${pc(s.up)}</b> delle ore (${s.n} osservazioni)`; };
    }
    $("#sesTbl").innerHTML = SES.sessions.map((s) => `<div class="sigrow"><div class="sr1"><b>${esc(s.name)}</b><span>${s.when}</span>${s.name === SES.now.session ? '<span class="pill green">adesso</span>' : ""}</div><div class="sr2"><span>Movimento medio nella sessione <b>${n2(s.range, 1)} $</b></span><span>Chiude in rialzo <b>${pc(s.up)}</b></span><span>Giorni <b>${s.days}</b></span></div></div>`).join("");
    $("#sesNote").textContent = "Misura quello che è successo: dove l'oro si muove di più. Non dice in che direzione andrà. \"Chiude in rialzo\" vicino al 50% significa nessuna tendenza stabile.";
  }
  async function loadSes() { try { SES = await get("/api/sessions"); } catch (e) { const el = $("#sesBody"); if (el && !SES) el.innerHTML = `<p class="muted">Non riesco a leggere le sessioni adesso (${esc(e.message)}).</p>`; return; } sesCard(); }

  /* ---------- reazione alla Fed ---------- */
  let FED = null;
  function fedCard() {
    const el = $("#fedBody"); if (!el) return;
    if (!FED) { el.innerHTML = '<p class="muted">Carico…</p>'; return; }
    const s = FED.summary;
    const last = FED.events.slice(-6).reverse().map((e) => { const [y, m, d] = e.date.split("-"); return `<div class="sigrow"><div class="sr1"><b>${d}/${m}/${y}</b><span class="when ${cl(e.move1)}" style="font-weight:700">${sg(e.move1, 1)} $ nella 1ª ora</span></div><div class="sr2"><span>Movimento massimo <b>${n2(e.range1, 1)} $</b></span><span>Dopo 2 ore <b class="${cl(e.move2)}">${sg(e.move2, 1)} $</b></span><span>${n2(e.ratio, 1)}× il normale</span></div></div>`; }).join("");
    el.innerHTML = s ? `<p class="muted small">Cosa ha fatto l'oro nell'ora e nelle due ore dopo ogni decisione della Fed (alle 14:00 di New York), dati orari reali.</p>
      <div class="statrow">${box("Decisioni misurate", s.n)}${box("Movimento medio nella 1ª ora", n2(s.range1, 1) + " $")}${box("Rispetto a un'ora normale", n2(s.ratio, 1) + "×", "r")}${box("Spostamento medio (assoluto)", n2(s.abs1, 1) + " $")}${box("1ª ora in rialzo", pc(s.up1))}${box("Inversione nella 2ª ora", pc(s.flip))}</div>
      <div class="ctl-label" style="margin-top:8px">Ultime decisioni</div>${last}
      <p class="small">Lettura: nell'ora della decisione l'oro si muove in media <b>${n2(s.ratio, 1)} volte</b> il normale (fino a ${n2(s.max_abs, 0)} $ in una direzione sola). La direzione non è prevedibile: è salito solo nel ${pc(s.up1)} dei casi e si è invertito nella seconda ora nel ${pc(s.flip)}.</p>
      <p class="muted small">Campione piccolo (${s.n} decisioni): descrive cos'è successo, non cosa succederà. Il messaggio utile è la dimensione del movimento, non la direzione.</p>` : '<p class="muted">Dati insufficienti.</p>';
  }
  async function loadFed() { try { FED = await get("/api/fomc"); } catch (e) { const el = $("#fedBody"); if (el && !FED) el.innerHTML = `<p class="muted">Non riesco a leggere i dati adesso (${esc(e.message)}).</p>`; return; } fedCard(); }

  const onTab = () => { const t = document.body.dataset.tab; if (t === "avvisi") { loadCtx(); loadSes(); loadFed(); } };
  new MutationObserver(onTab).observe(document.body, { attributes: true, attributeFilter: ["data-tab"] });
  window.addEventListener("resize", () => { sesCard(); });
  loadCtx(); setInterval(() => { if (!document.hidden) loadCtx(); }, 180000);
  setTimeout(() => { loadSes(); loadFed(); }, 1500);
})();
