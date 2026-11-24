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
  const get = async (u) => { const r = await fetch(u, { cache: "no-store" }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "errore"); return j; };
  let CTX = null, CAL = null, CTXERR = "";

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
  /* riepilogo di oggi sotto il semaforo: segnali favorevoli delle ultime 24 ore (dall'archivio sul telefono) e le tue operazioni di oggi */
  function brief() {
    const el = $("#daybrief"); if (!el) return;
    const now = Date.now() / 1000; let ar = {};
    try { ar = JSON.parse(localStorage.getItem("xau_archive_v1") || "{}"); } catch (e) { ar = {}; }
    const fav = Object.values(ar).filter((x) => x.stance === "favorevole" && [2, 3, 4].includes(Number(x.rr)) && ["30m", "1h", "4h", "1d"].includes(x.tf) && x.entry_ts > now - 86400 && (typeof afterReset !== "function" || afterReset(x)));
    const open = fav.filter((x) => x.status === "open"), parts = [];
    if (fav.length) parts.push(`segnali favorevoli nelle ultime 24 ore: <b>${fav.length}</b>${open.length ? " (" + open.length + " ancora aperti)" : ""}: ` + fav.slice(0, 4).map((x) => esc((x.symbol && x.symbol !== "XAUUSD" ? x.symbol : "Oro") + " " + (x.dir === "buy" ? "BUY" : "SHORT") + " " + x.tf)).join(", ") + (fav.length > 4 ? "…" : ""));
    else parts.push("nessun segnale favorevole nelle ultime 24 ore");
    if (window.OP) { // l'orario delle operazioni è quello del broker (circa ora italiana +1): il giorno si confronta sulla stessa scala
      const day = new Date(Date.now() + 3600000).toISOString().slice(0, 10), td = OP.all().filter((t) => !t.kind && new Date(t.ct).toISOString().slice(0, 10) === day);
      if (td.length) { const net = td.reduce((a, t) => a + t.net, 0); parts.push(`tue operazioni di oggi: <b>${td.length}</b>, netto <b class="${cl(net)}">${sg(net)}</b>`); }
    }
    el.innerHTML = parts.join(" · "); el.hidden = false;
  }
  function ctxCard() {
    const el = $("#ctxBody"); if (!el) return;
    if (!CTX) { el.innerHTML = `<p class="muted">${CTXERR ? esc(CTXERR) : "Carico…"}</p>`; return; }
    const rows = CTX.rows.map((r) => {
      const chg = r.kind === "bp" ? sg(r.chg_abs * 100, 0) + " pb" : r.kind === "pt" ? sg(r.chg_abs, 2) : sg(r.chg_pct, 2) + "%";
      const unus = Math.abs(r.z) >= 2 ? '<span class="pill amber">insolito</span>' : Math.abs(r.z) >= 1 ? '<span class="pill">sopra il normale</span>' : '<span class="pill">nella norma</span>';
      const co = r.corr == null ? "–" : (r.corr > 0 ? "+" : "") + n2(r.corr, 2);
      return `<div class="sigrow"><div class="sr1"><b>${esc(r.name)}</b><span class="when ${cl(r.chg_pct)}" style="font-weight:700">${chg}</span></div><div class="sr2"><span>Ora <b>${n2(r.last, r.last > 1000 ? 0 : 2)}</b></span><span>Con l'oro (30 giorni) <b>${co}</b></span>${unus}</div></div>`;
    }).join("");
    el.innerHTML = `<p class="muted small">Cosa fanno oggi i mercati che di solito muovono l'oro. La correlazione va da -1 (si muovono al contrario) a +1 (insieme): è un'abitudine recente, non una regola. Oro oggi: <b class="${cl(CTX.gold.chg_pct)}">${sg(CTX.gold.chg_pct)}%</b>.</p>${rows}${CTX.notes.map((t) => `<p class="small"><b>⚠</b> ${esc(t)}</p>`).join("")}<p class="muted small">Dati Yahoo (possono avere qualche minuto di ritardo). Misura il passato: non prevede cosa farà l'oro.</p>`;
  }
  async function loadCtx() {
    try { CTX = await get("/api/context"); CTXERR = ""; } catch (e) { CTXERR = "Non riesco a leggere il quadro adesso (" + e.message + ")."; }
    try { const c = await get("/api/calendar"); CAL = c.events || []; } catch (e) { /* senza calendario il semaforo funziona lo stesso */ }
    mood(); brief(); ctxCard();
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

  /* stato delle notifiche sul telefono: collegate? ultimi invii dal server + notifica di prova */
  let NT = null, ntMsg = "", prefMsg = "", prefDirty = false;
  const hm = (ts) => new Date(ts * 1000).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  function ntfyBox() {
    const el = $("#ntfyBox"); if (!el) return;
    if (prefDirty && NT) return; // non si ridisegna mentre stai scegliendo
    if (!NT) { el.innerHTML = ntMsg ? `<p class="muted small">${esc(ntMsg)}</p>` : ""; return; }
    const ev = NT.events.map((e) => `<div class="sigrow"><div class="sr1"><b>${esc(e.title)}</b><span class="when">${hm(e.t)}</span><span class="pill ${e.ok ? "green" : "red"}">${e.ok ? "inviata" : "non inviata"}</span></div>${e.ok ? "" : `<div class="sr2"><span>${esc(e.err)}</span></div>`}</div>`).join("");
    el.innerHTML = `<div class="ctl-label" style="margin-top:10px">Notifiche sul telefono</div>
      <p class="small">${(NT.ntfy || NT.telegram) ? "Collegate sul server." : "<b class=\"r\">Non collegate sul server</b> (manca il canale): non partirà nessuna notifica."} ${NT.telegram ? "" : NT.token ? "Token ntfy: <b class=\"g\">attivo</b>." : "Token ntfy: <b class=\"r\">non impostato</b> (variabile NTFY_TOKEN su Render)."}${NT.pause ? " <b class=\"r\">Invio in pausa per " + Math.ceil(NT.pause / 60) + " min dopo un rifiuto del servizio.</b>" : ""} ${NT.telegram ? "Canale delle notifiche: <b class=\"g\">Telegram</b> (l'unico attivo)." : "Telegram: non impostato (consigliato: è il canale più affidabile)."} Server avviato il ${hm(NT.started)}${NT.tick_age != null ? ", ultimo controllo " + Math.round(NT.tick_age / 60) + " min fa" : ""}.</p>
      <p class="small">${(() => { const k = Object.keys(NT.reminders || {}).pop(), today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }); return k && k.endsWith(today) ? "Promemoria delle 7 di oggi: <b class=\"g\">inviato alle " + hm(NT.reminders[k]).slice(-5) + "</b>." : "Promemoria delle 7 di oggi: <b>non ancora inviato</b> (parte tra le 7:00 e le 10:00)."; })()}</p>
      ${ev || '<p class="muted small">Nessuna notifica registrata.</p>'}
      <div class="ctl-label" style="margin-top:10px">Avvisami sul telefono per questi time frame</div>
      <div class="row gap" id="prefTf" style="flex-wrap:wrap">${["30m", "1h", "4h", "1d"].map((t) => `<label class="chk"><input type="checkbox" data-tf="${t}" ${(NT.prefs ? NT.prefs.tfs : []).includes(t) ? "checked" : ""}> ${t}</label>`).join("")}</div>
      <label class="small" style="display:block;margin:8px 0">Avvisami solo se la probabilità di target nella simulazione supera <input id="prefMin" type="text" inputmode="decimal" autocomplete="off" value="${NT.prefs && NT.prefs.min_target != null ? NT.prefs.min_target : 30}" style="max-width:64px"> % (0 = tutti i segnali)</label>
      <label class="chk"><input type="checkbox" id="prefEve" ${NT.prefs && NT.prefs.evening ? "checked" : ""}> Riepilogo serale (dopo le 22, un solo messaggio)</label>
      ${NT.pin_required ? '<label class="small">PIN <input id="prefPin" type="password" autocomplete="off" style="max-width:120px"></label>' : ""}
      <div class="row gap" style="margin-top:6px"><button class="btn" id="prefSave" type="button">Salva scelte</button></div><p class="small" id="prefMsg">${esc(prefMsg)}</p>
      <p class="muted small">I segnali sugli altri time frame restano nell'elenco dei Segnali automatici: cambia solo se ti arriva la notifica. I promemoria (7:00 e notizie rosse) arrivano sempre.</p>
      <div class="row gap" style="margin-top:8px"><button class="btn" id="ntfyTest">Manda una notifica di prova</button></div><p class="small" id="ntfyMsg">${esc(ntMsg)}</p>
      <p class="muted small">"Inviata" vuol dire che il servizio l'ha accettata: se sul telefono non compare, controlla in Telegram che le notifiche del bot siano attive (Impostazioni del telefono → Notifiche → Telegram, nessun Focus attivo, nessun risparmio batteria). L'elenco è salvato anche su GitHub (se il token è attivo), quindi resta dopo i riavvii.</p>`;
    const sv = $("#prefSave"); if (sv) sv.onclick = async () => {
      const tfs = [...document.querySelectorAll("#prefTf input:checked")].map((i) => i.dataset.tf), pin = $("#prefPin") ? $("#prefPin").value : "";
      try { const r = await post("/api/prefs", { tfs, evening: $("#prefEve").checked, min_target: $("#prefMin").value, pin }); NT.prefs = r.prefs; prefMsg = "Salvato: avvisi per " + (r.prefs.tfs.join(", ") || "nessun time frame") + ", solo con probabilità di target oltre " + r.prefs.min_target + "%" + (r.prefs.evening ? ", con riepilogo serale." : ", senza riepilogo serale."); }
      catch (e) { prefMsg = e.message; }
      prefDirty = false; ntfyBox();
    };
    document.querySelectorAll("#prefTf input, #prefEve, #prefMin").forEach((i) => { i.onchange = i.oninput = () => { prefDirty = true; }; });
    const b = $("#ntfyTest"); if (b) b.onclick = async () => { b.disabled = true; try { await post("/api/notiftest", {}); ntMsg = "Prova inviata alle " + hm(Date.now() / 1000) + ": controlla il telefono."; } catch (e) { ntMsg = e.message; } await loadNtfy(); };
  }
  const post = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "errore"); return j; };
  async function loadNtfy() { try { NT = await get("/api/notifstatus"); } catch (e) { NT = null; ntMsg = "Non riesco a leggere lo stato delle notifiche adesso (" + e.message + ")."; } ntfyBox(); }

  const onTab = () => { const t = document.body.dataset.tab; if (t === "avvisi") { loadCtx(); loadSes(); loadFed(); loadNtfy(); } };
  new MutationObserver(onTab).observe(document.body, { attributes: true, attributeFilter: ["data-tab"] });
  window.addEventListener("resize", () => { sesCard(); });
  loadCtx(); setInterval(() => { if (!document.hidden) loadCtx(); }, 180000);
  brief(); setInterval(brief, 60000);
  setTimeout(() => { loadSes(); loadFed(); loadNtfy(); }, 1500);
  setInterval(() => { if (!document.hidden && document.body.dataset.tab === "avvisi") loadNtfy(); }, 60000);
})();
