"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const TFS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
const RRS = [1, 1.5, 2, 3, 4, 5];
const S = { symbol: "XAUUSD", spot: "", tf: "1h", setup: "breakout", rr: 2, dir: "buy", ov: null, data: null, gold: true, seq: 0, selCase: null, tab: "oggi" };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- utilita' ---------- */
const dec = () => (S.gold ? 1 : 2);
const fmt = (x, d) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("it-IT", { minimumFractionDigits: d ?? dec(), maximumFractionDigits: d ?? dec() }));
const off = () => (S.data && S.data.info ? S.data.info.offset || 0 : S.ov ? S.ov.info.offset || 0 : 0);
const P = (x) => (x == null ? null : x + off());
const fp = (x) => fmt(P(x));
const pct = (x, d = 0) => (x == null ? "–" : (x * 100).toFixed(d) + "%");
const sgn = (x, d = 2) => (x == null ? "–" : (x >= 0 ? "+" : "") + Number(x).toFixed(d).replace(".", ","));
const tIT = (ts, withDate) => new Date(ts * 1000).toLocaleString("it-IT", withDate ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" } : { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const dIT = (ts) => new Date(ts * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" });
const key = (rr) => String(rr);
async function api(url, opt) {
  const r = await fetch(url, opt);
  const j = await r.json();
  if (j && j.error && !j.signals && !j.items) throw new Error(j.error);
  return j;
}
function showMsg(t) { const m = $("#msg"); m.hidden = !t; m.textContent = t || ""; }
const STANCE = {
  favorevole: ["Favorevole", "green"], sfavorevole: ["Sfavorevole", "red"], "nessun vantaggio": ["Nessun vantaggio", ""],
  positivo: ["Storico positivo", "green"], negativo: ["Storico negativo", "red"], poco_storico: ["Pochi casi", ""],
};
const stancePill = (s) => { const [t, c] = STANCE[s] || [s, ""]; return `<span class="pill ${c}">${t}</span>`; };

/* ---------- query ---------- */
function baseQuery(extra) {
  const p = new URLSearchParams({ symbol: S.symbol, tf: S.tf, setup: S.setup, rr: S.rr });
  if (S.spot) p.set("spot", S.spot);
  const add = (id, k) => { const v = $(id).value; if (v !== "") p.set(k, v); };
  add("#pN", "N"); add("#pAm", "am"); add("#pHold", "hold"); add("#pOr", "or"); add("#pRep", "replays");
  Object.entries(extra || {}).forEach(([k, v]) => p.set(k, v));
  return p.toString();
}

/* ---------- caricamento ---------- */
async function load(silent) {
  const my = ++S.seq;
  if (!silent) { showMsg(""); $("#hRead").textContent = "Carico i dati…"; }
  try {
    const [ov, st] = await Promise.all([api("/api/overview?" + baseQuery()), api("/api/setup?" + baseQuery())]);
    if (my !== S.seq) return;
    S.ov = ov; S.data = st; S.gold = ov.gold;
    buildSetupSeg(); render();
  } catch (e) {
    if (my === S.seq) showMsg("Non riesco a leggere i dati: " + e.message);
  }
}

/* ---------- controlli ---------- */
function seg(el, items, current, onPick) {
  el.innerHTML = "";
  items.forEach((it) => {
    const b = document.createElement("button");
    b.textContent = it.label; b.className = it.value === current ? "on" : ""; b.disabled = !!it.disabled;
    b.onclick = () => onPick(it.value);
    el.appendChild(b);
  });
}
function buildTf() { seg($("#tfSeg"), TFS.map((t) => ({ label: t, value: t })), S.tf, (v) => { S.tf = v; if (S.setup !== "breakout" && !["5m", "15m"].includes(v)) S.setup = "breakout"; buildTf(); buildSetupSeg(); load(); }); }
function buildSetupSeg() {
  const items = [{ label: "Breakout", value: "breakout" }];
  const ses = (S.ov && S.ov.sessions) || { london: "Londra", ny: "New York" };
  Object.entries(ses).forEach(([k, l]) => items.push({ label: l.replace(" (Borsa)", ""), value: k }));
  seg($("#setupSeg"), items, S.setup, (v) => { S.setup = v; if (v !== "breakout" && !["5m", "15m"].includes(S.tf)) { S.tf = "5m"; buildTf(); } buildSetupSeg(); load(); });
}
function buildRr() { seg($("#rrSeg"), RRS.map((r) => ({ label: r + "R", value: r })), S.rr, (v) => { S.rr = v; buildRr(); load(true); }); }
function buildDirSegs() {
  ["#dirSeg1", "#dirSeg2"].forEach((id) => seg($(id), [{ label: "BUY", value: "buy" }, { label: "SHORT", value: "sell" }], S.dir, (v) => { S.dir = v; buildDirSegs(); renderChart(); renderTm(); }));
}
$("#tabs").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.tab = b.dataset.tab; document.body.dataset.tab = S.tab; window.scrollTo({ top: 0, behavior: "smooth" });
  $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".tab").forEach((x) => x.classList.toggle("on", x.id === "tab-" + S.tab));
  renderChart(); renderTm(); if (S.tab === "avvisi") loadJournal();
};
$("#refresh").onclick = () => load();
$$("[data-open]").forEach((b) => (b.onclick = () => $(`#tabs [data-tab=${b.dataset.open}]`).click()));
$("#moreBtn").onclick = () => { const d = $("#moreBox"); d.open = !d.open; d.scrollIntoView({ behavior: "smooth", block: "center" }); };
$("#symbol").onchange = () => { S.symbol = $("#symbol").value.trim().toUpperCase() || "XAUUSD"; S.ov = null; S.setup = "breakout"; load(); };
$("#spot").onchange = () => { S.spot = $("#spot").value.replace(",", ".").trim(); load(); };
["#pN", "#pAm", "#pHold", "#pOr", "#pRep"].forEach((id) => ($(id).onchange = () => load()));
window.addEventListener("resize", () => { renderChart(); renderTm(); loadJournalChart(); });

/* ---------- render principale ---------- */
function render() {
  const ov = S.ov, d = S.data;
  if (!ov || !d) return;
  $("#hName").textContent = ov.name + (S.spot ? " · prezzo sul tuo grafico" : " · dati " + ov.ysym);
  $("#hPrice").textContent = fmt(P(ov.info.last));
  const ch = ov.info.change_pct, c = $("#hChange");
  c.textContent = (ch >= 0 ? "▲ " : "▼ ") + Math.abs(ch).toFixed(2).replace(".", ",") + "% oggi"; c.className = "delta " + (ch >= 0 ? "up" : "down");
  $("#hUpd").textContent = "ultima barra " + (ov.info.last_bar_ts ? tIT(ov.info.last_bar_ts) : "–") + " (ora italiana)";
  $("#hRead").textContent = ov.reading || "";
  if (ov.info.gap_warning) showMsg("Scarto insolito tra il prezzo che hai scritto e i dati di Yahoo: i livelli spostati sul tuo grafico potrebbero non essere affidabili. Controlla prezzo e simbolo.");
  renderDirCards(); renderExplain(); renderMtf(); renderChart(); renderTm();
}

function stateLabel(r) {
  if (r.state === "waiting") return ["In attesa", "amber"];
  if (r.state === "triggered") { const m = r.age_min || 0; return [m < 1 ? "Scattato ora" : "Scattato " + (m < 180 ? m + " min fa" : (m / 60).toFixed(1).replace(".", ",") + " h fa"), m > 30 ? "amber" : "green"]; }
  if (r.state === "expired") return ["Scaduto", ""];
  return ["Nessun segnale", ""];
}
function renderDirCards() {
  const res = S.data.result;
  const names = { buy: "BUY", sell: "SHORT" };
  ["buy", "sell"].forEach((d) => {
    const el = $(d === "buy" ? "#dirBuy" : "#dirSell");
    if (!res || res.error || !res.dirs) { el.innerHTML = `<div class="dir ${d}">${names[d]}</div><p class="muted">${(res && res.error) || "–"}</p>`; return; }
    const r = res.dirs[d], b = r.blocks[key(S.rr)];
    const [sl, sc] = stateLabel(r);
    let h = `<div class="dc-head"><span class="dir ${d}">${names[d]}</span><span class="pill ${sc}">${sl}</span>${b ? stancePill(b.stance) : ""}</div>`;
    if (res.state_text && r.state === "none") h += `<p class="muted small">${res.state_text}</p>`;
    if (r.entry != null) {
      h += `<div class="levels"><div class="lv"><span>${r.state === "waiting" ? "Scatta a" : "Ingresso"}</span><b>${fp(r.entry)}</b></div><div class="lv"><span>Stop</span><b>${fp(r.stop)}</b></div><div class="lv"><span>Target ${S.rr}R</span><b>${b && b.target != null ? fp(b.target) : "–"}</b></div></div>`;
      h += `<div class="muted small">Rischio ${fmt(r.risk)} per unità${r.state === "waiting" ? " · prezzo a " + fmt(r.dist) + " dal livello" : ""}${r.age_min > 30 && r.state === "triggered" ? " · ingresso in ritardo: è un altro trade" : ""}</div>`;
    }
    if (b && b.closed) h += `<p class="pill ${b.closed === "target" ? "green" : "red"}" style="margin-top:12px">Piano teorico già chiuso: ${b.closed === "target" ? "target" : "stop"} toccato</p>`;
    if (b && b.mc) {
      const m = b.mc;
      h += `<div class="bar"><i class="t" style="width:${m.target * 100}%"></i><i class="s" style="width:${m.stop * 100}%"></i><i class="n" style="width:${m.none * 100}%"></i></div>`;
      h += `<div class="legend"><span><span class="dot-t"></span>Target prima <b>${pct(m.target)}</b></span><span><span class="dot-s"></span>Stop prima <b>${pct(m.stop)}</b></span><span><span class="dot-n"></span>Nessuno <b>${pct(m.none)}</b></span></div>`;
      if (b.verdict) h += `<p class="small" style="margin:10px 0 0">${b.verdict}</p>`;
    }
    if (b && b.hist && b.hist.fired) {
      const x = b.hist;
      h += `<p class="muted small" style="margin:10px 0 0">Storico: ${x.fired} casi, ${x.target} target, ${x.stop} stop · R medio ${sgn(x.avg_r)}${x.se != null ? " ±" + x.se.toFixed(2).replace(".", ",") : ""}</p>`;
    }
    h += `<div class="row gap" style="margin-top:12px"><button class="btn" data-go="grafico" data-d="${d}">Grafico</button><button class="btn" data-go="tm" data-d="${d}">Time Machine</button></div>`;
    el.innerHTML = h;
  });
  $$("[data-go]").forEach((b) => (b.onclick = () => { S.dir = b.dataset.d; buildDirSegs(); $(`#tabs [data-tab=${b.dataset.go}]`).click(); }));
}
function renderExplain() {
  const lines = S.data.explanation || [];
  $("#explain").className = "explain";
  $("#explain").innerHTML = lines.map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
}
function renderMtf() {
  const m = S.ov.mtf, names = { "1m": "1 minuto", "5m": "5 minuti", "15m": "15 minuti", "1h": "1 ora", "4h": "4 ore", "1d": "Giornaliero", "1w": "Settimanale" };
  let h = "";
  TFS.forEach((t) => {
    const x = m[t];
    if (!x || x.error) { h += `<div class="item"><div class="ico">${t}</div><div class="mid"><b>${names[t]}</b><span>dati non disponibili</span></div></div>`; return; }
    const c = x.bias === "rialzista" ? "green" : x.bias === "ribassista" ? "red" : "neutral", up = x.bias === "rialzista", dn = x.bias === "ribassista";
    h += `<div class="item"><div class="ico ${c}">${t}</div><div class="mid"><b>${names[t]}</b><span>${x.bias}${x.flag ? " · " + x.flag : ""} · ATR ${fmt(x.atr)} · posizione ${Math.round(x.pos * 100)}%</span></div><div class="rt"><b>${fp(x.last)}</b><span class="${up ? "up" : dn ? "down" : ""}">${up ? "▲" : dn ? "▼" : "●"} RSI ${x.rsi == null ? "–" : Math.round(x.rsi)}</span></div></div>`;
  });
  $("#mtfBox").innerHTML = h;
  $("#mtfRead").textContent = (S.ov.reading || "") + " Il trend dice dove è andato il prezzo, non dove andrà.";
}

/* ---------- canvas ---------- */
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  c.font = "11px -apple-system,Segoe UI,Roboto,sans-serif";
  return { c, w, h };
}
function niceTicks(lo, hi, n) {
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v); return out;
}
function renderChart() {
  if (S.tab !== "grafico" || !S.data) return;
  const cv = $("#cvCandles"), k = setupCanvas(cv); if (!k) return;
  const { c, w, h } = k, ch = S.data.chart, bars = ch.bars;
  $("#chartTitle").textContent = S.ov.name + " · " + S.tf;
  const r = S.data.result && S.data.result.dirs ? S.data.result.dirs[S.dir] : null, b = r && r.blocks ? r.blocks[key(S.rr)] : null;
  const levels = [];
  if (r && r.entry != null) {
    levels.push({ y: r.entry, label: r.state === "waiting" ? "Scatta" : "Ingresso", col: css("--accent") });
    levels.push({ y: r.stop, label: "Stop", col: css("--red") });
    if (b && b.target != null) levels.push({ y: b.target, label: "Target " + S.rr + "R", col: css("--green") });
  }
  const ml = 8, mr = 70, mt = 10, mb = 22, o = off();
  let lo = Infinity, hi = -Infinity;
  bars.forEach((x) => { lo = Math.min(lo, x[3]); hi = Math.max(hi, x[2]); });
  levels.forEach((l) => { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); });
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const X = (i) => ml + (i + 0.5) * ((w - ml - mr) / bars.length), Y = (v) => mt + (hi - v) / (hi - lo) * (h - mt - mb);
  c.strokeStyle = css("--line"); c.fillStyle = css("--muted"); c.lineWidth = 1; c.textAlign = "left";
  niceTicks(lo + o, hi + o, 5).forEach((t) => { const y = Y(t - o); c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke(); c.fillText(fmt(t), w - mr + 6, y + 4); });
  const step = (w - ml - mr) / bars.length, bw = Math.max(1, step * 0.62);
  bars.forEach((x, i) => {
    const up = x[4] >= x[1], col = up ? css("--green") : css("--red");
    c.strokeStyle = col; c.fillStyle = col; c.beginPath(); c.moveTo(X(i), Y(x[2])); c.lineTo(X(i), Y(x[3])); c.stroke();
    const y1 = Y(x[1]), y2 = Y(x[4]); c.fillRect(X(i) - bw / 2, Math.min(y1, y2), bw, Math.max(1, Math.abs(y2 - y1)));
  });
  [[ch.sma20, css("--blue")], [ch.sma50, css("--violet")]].forEach(([arr, col]) => {
    c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); let on = false;
    arr.forEach((v, i) => { if (v == null) return; const px = X(i), py = Y(v); on ? c.lineTo(px, py) : c.moveTo(px, py); on = true; }); c.stroke();
  });
  c.lineWidth = 1; c.textAlign = "left";
  levels.forEach((l) => {
    c.strokeStyle = l.col; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(ml, Y(l.y)); c.lineTo(w - mr, Y(l.y)); c.stroke(); c.setLineDash([]);
    c.fillStyle = l.col; c.fillRect(w - mr, Y(l.y) - 9, mr - 2, 18); c.fillStyle = "#fff"; c.font = "bold 10.5px sans-serif"; c.fillText(l.label, w - mr + 4, Y(l.y) + 3.5);
  });
  c.font = "11px sans-serif"; c.fillStyle = css("--muted"); c.textAlign = "center";
  const every = Math.ceil(bars.length / 6);
  bars.forEach((x, i) => { if (i % every === 0) c.fillText(ch.sec >= 86400 ? dIT(x[0]) : tIT(x[0], ch.sec >= 3600 && ch.sec < 86400 ? false : false) + (ch.sec >= 3600 ? " " + dIT(x[0]) : ""), X(i), h - 6); });
}

function drawAxesR(c, w, h, x1, ymin, ymax, ml, mr, mt, mb, rr, steps) {
  const Y = (v) => mt + (ymax - v) / (ymax - ymin) * (h - mt - mb), Xs = (i) => ml + i / Math.max(1, steps) * (w - ml - mr);
  c.strokeStyle = css("--line"); c.fillStyle = css("--muted"); c.lineWidth = 1; c.textAlign = "left"; c.font = "11px sans-serif";
  niceTicks(ymin, ymax, 5).forEach((t) => { c.beginPath(); c.moveTo(ml, Y(t)); c.lineTo(w - mr, Y(t)); c.stroke(); c.fillText(t.toFixed(t % 1 ? 1 : 0) + "R", w - mr + 6, Y(t) + 4); });
  [[rr, css("--green"), "Target"], [-1, css("--red"), "Stop"], [0, css("--muted"), "Ingresso"]].forEach(([v, col, lab]) => {
    c.strokeStyle = col; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(w - mr, Y(v)); c.stroke(); c.setLineDash([]);
  });
  return { Y, Xs };
}
function renderTm() {
  if (S.tab !== "tm" || !S.data) return;
  const res = S.data.result; if (!res || !res.dirs) return;
  const r = res.dirs[S.dir], b = r.blocks[key(S.rr)];
  let st = "";
  if (b && b.mc) st += `<div class="stat"><span>Target prima</span><b class="g">${pct(b.mc.target, 1)}</b></div><div class="stat"><span>Stop prima</span><b class="r">${pct(b.mc.stop, 1)}</b></div><div class="stat"><span>Nessuno dei due</span><b>${pct(b.mc.none, 1)}</b></div><div class="stat"><span>R medio</span><b>${sgn(b.mc.avg_r)}</b></div>`;
  else st += `<p class="muted">${b && b.closed ? "Il piano teorico si è già chiuso (" + b.closed + "): niente da simulare." : "Nessun setup attivo o in attesa: la simulazione parte quando c'è un livello da valutare."}</p>`;
  if (b) st += `<div class="stat"><span>Giudizio</span><b style="font-size:15px">${(STANCE[b.stance] || [b.stance])[0]}</b></div>`;
  $("#tmStats").innerHTML = st;
  /* ventaglio */
  const cvF = $("#cvFan"), kf = setupCanvas(cvF);
  if (kf) {
    const { c, w, h } = kf, f = r.fan;
    if (!f) { c.fillStyle = css("--muted"); c.font = "14px sans-serif"; c.fillText("Nessuna simulazione per questa direzione.", 12, 30); $("#tmFanNote").textContent = ""; }
    else {
      const ml = 8, mr = 44, mt = 10, mb = 24, n = f.steps, bd = f.bands;
      const ymin = Math.min(-1.4, ...bd.p5) - 0.1, ymax = Math.max(S.rr + 0.5, ...bd.p95) + 0.1;
      const { Y, Xs } = drawAxesR(c, w, h, 0, ymin, ymax, ml, mr, mt, mb, S.rr, n);
      c.lineWidth = 1; c.strokeStyle = css("--muted"); c.globalAlpha = 0.18;
      f.paths.forEach((p) => { c.beginPath(); p.forEach((v, i) => (i ? c.lineTo(Xs(i), Y(v)) : c.moveTo(Xs(i), Y(v)))); c.stroke(); });
      c.globalAlpha = 1;
      const band = (lo, hi, col, a) => { c.fillStyle = col; c.globalAlpha = a; c.beginPath(); lo.forEach((v, i) => (i ? c.lineTo(Xs(i), Y(v)) : c.moveTo(Xs(i), Y(v)))); for (let i = hi.length - 1; i >= 0; i--) c.lineTo(Xs(i), Y(hi[i])); c.closePath(); c.fill(); c.globalAlpha = 1; };
      band(bd.p5, bd.p95, css("--accent"), 0.10); band(bd.p25, bd.p75, css("--accent"), 0.18);
      c.strokeStyle = css("--accent"); c.lineWidth = 2.2; c.beginPath(); bd.p50.forEach((v, i) => (i ? c.lineTo(Xs(i), Y(v)) : c.moveTo(Xs(i), Y(v)))); c.stroke();
      c.fillStyle = css("--muted"); c.textAlign = "center"; c.font = "11px sans-serif";
      const sec = res.sec || (S.data.chart && S.data.chart.sec) || 300;
      [0, Math.round(n / 2), n].forEach((i) => { const m = Math.round(i * sec / 60); c.fillText(i === 0 ? "ora" : "+" + (m >= 180 ? (m / 60).toFixed(m % 60 ? 1 : 0).replace(".", ",") + " h" : m + " min"), Xs(i) + (i === n ? -14 : 0), h - 6); });
      $("#tmFanNote").textContent = "Linea blu = esito mediano, fascia scura = dal 25% al 75% dei casi, fascia chiara = dal 5% al 95%, linee grigie = 40 ripetizioni di esempio. Dopo lo stop il percorso resta fermo a -1R. Il target è la linea verde a +" + S.rr + "R.";
    }
  }
  /* casistiche */
  const cases = r.cases || [], k2 = key(S.rr);
  const stats = cases.map((x) => x.out[k2]).filter((o) => o && o[0] !== "open");
  const tgt = stats.filter((o) => o[0] === "target").length, stp = stats.filter((o) => o[0] === "stop").length, non = stats.length - tgt - stp;
  const avg = stats.length ? stats.reduce((a, o) => a + o[1], 0) / stats.length : null;
  $("#casesStats").innerHTML = `<div class="stat"><span>Casi (ultimi ${cases.length} di ${r.n_cases})</span><b>${stats.length}</b></div><div class="stat"><span>Target</span><b class="g">${tgt}</b></div><div class="stat"><span>Stop</span><b class="r">${stp}</b></div><div class="stat"><span>Nessuno</span><b>${non}</b></div><div class="stat"><span>R medio</span><b>${sgn(avg)}</b></div>`;
  const cvC = $("#cvCases"), kc = setupCanvas(cvC);
  if (kc) {
    const { c, w, h } = kc, ml = 8, mr = 44, mt = 10, mb = 22;
    const maxLen = Math.max(2, ...cases.map((x) => (x.out[k2] ? x.out[k2][2] : x.path.length) + 1));
    const ymin = -1.4, ymax = S.rr + 0.6;
    const { Y, Xs } = drawAxesR(c, w, h, 0, ymin, ymax, ml, mr, mt, mb, S.rr, maxLen - 1);
    const pts = (x) => { const o = x.out[k2]; if (!o) return []; let p = x.path.slice(0, o[2] + 1); if (o[0] === "target") p[p.length - 1] = S.rr; if (o[0] === "stop") p[p.length - 1] = -1; return p; };
    const colOf = (o) => (o[0] === "target" ? css("--green") : o[0] === "stop" ? css("--red") : "#9aa3b2");
    c.lineWidth = 1;
    cases.forEach((x, idx) => { const o = x.out[k2]; if (!o || o[0] === "open" || idx === S.selCase) return; const p = pts(x); c.strokeStyle = colOf(o); c.globalAlpha = 0.22; c.beginPath(); p.forEach((v, i) => (i ? c.lineTo(Xs(i), Y(v)) : c.moveTo(Xs(i), Y(v)))); c.stroke(); });
    c.globalAlpha = 1;
    if (S.selCase != null && cases[S.selCase]) { const x = cases[S.selCase], o = x.out[k2]; if (o) { const p = pts(x); c.strokeStyle = css("--ink"); c.lineWidth = 3; c.beginPath(); p.forEach((v, i) => (i ? c.lineTo(Xs(i), Y(v)) : c.moveTo(Xs(i), Y(v)))); c.stroke(); } }
    c.fillStyle = css("--muted"); c.textAlign = "center"; c.fillText("barre dall'ingresso", (w - mr) / 2, h - 6);
  }
  $("#caseGrid").innerHTML = cases.map((x, i) => { const o = x.out[k2]; if (!o || o[0] === "open") return ""; return `<i class="${o[0] === "target" ? "t" : o[0] === "stop" ? "s" : "n"}${i === S.selCase ? " sel" : ""}" data-i="${i}" title="${x.label} · ${o[0]} · ${sgn(o[1])}R"></i>`; }).join("");
  $$("#caseGrid i").forEach((e) => (e.onclick = () => { S.selCase = +e.dataset.i; const x = cases[S.selCase]; $("#caseNote").textContent = `Selezionata: ${x.label}, ${x.out[k2][0]}, ${sgn(x.out[k2][1])}R.`; renderTm(); }));
}

/* ---------- avvisi ---------- */
const AL = Object.assign({ on: false, tfs: ["5m", "15m", "1h"], setups: ["breakout"], stance: "fav" }, JSON.parse(localStorage.getItem("xau_alerts") || "{}"));
const seen = new Set(JSON.parse(localStorage.getItem("xau_seen") || "[]"));
let alTimer = null, audioCtx = null;
function saveAl() { localStorage.setItem("xau_alerts", JSON.stringify(AL)); localStorage.setItem("xau_seen", JSON.stringify([...seen].slice(-300))); }
function buildAlertUi() {
  const mk = (id, vals, sel, cb) => { $(id).innerHTML = vals.map(([v, l]) => `<label class="chip"><input type="checkbox" value="${v}" ${sel.includes(v) ? "checked" : ""}><span>${l}</span></label>`).join(""); $$(id + " input").forEach((i) => (i.onchange = () => { cb($$(id + " input:checked").map((x) => x.value)); saveAl(); })); };
  mk("#alTf", [["5m", "5 min"], ["15m", "15 min"], ["1h", "1 ora"], ["4h", "4 ore"]], AL.tfs, (v) => (AL.tfs = v));
  const ses = (S.ov && S.ov.sessions) || { london: "Londra", ny: "New York" };
  mk("#alSetup", [["breakout", "Breakout"], ...Object.entries(ses).map(([k, l]) => [k, "Apertura " + l.replace(" (Borsa)", "")])], AL.setups, (v) => (AL.setups = v));
  $$("input[name=alStance]").forEach((i) => { i.checked = i.value === AL.stance; i.onchange = () => { AL.stance = i.value; saveAl(); }; });
  $("#alToggle").textContent = AL.on ? "Disattiva avvisi" : "Attiva avvisi";
  $("#alStatus").textContent = AL.on ? "Avvisi attivi: controllo ogni minuto finché questa pagina è aperta." : "";
}
function beep() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); [660, 880, 1100].forEach((f, i) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination); const t = audioCtx.currentTime + i * 0.16; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14); o.start(t); o.stop(t + 0.15); }); } catch (e) { /* niente audio */ }
}
$("#alTest").onclick = () => { beep(); if ("Notification" in window && Notification.permission === "granted") new Notification("Prova avviso XAU", { body: "Così ti avviso quando c'è un segnale." }); };
$("#alToggle").onclick = async () => {
  if (!AL.on) {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    AL.on = true; beep();
  } else AL.on = false;
  saveAl(); buildAlertUi(); schedulePoll(true);
};
function schedulePoll(now) { clearInterval(alTimer); if (AL.on) { if (now) pollSignals(); alTimer = setInterval(pollSignals, 60000); } }
async function pollSignals() {
  try {
    const q = new URLSearchParams({ symbol: S.symbol, tfs: AL.tfs.join(","), setups: AL.setups.join(","), rr: S.rr });
    if (S.spot) q.set("spot", S.spot);
    const r = await api("/api/signals?" + q.toString());
    const list = (r.signals || []).filter((s) => AL.stance === "all" ? s.stance !== "sfavorevole" : s.stance === "favorevole");
    renderSignals(r.signals || []);
    const jr = loadLocalJournal(); let added = false;
    (r.signals || []).forEach((s) => { if (!jr.some((x) => x.id === s.id)) { jr.push(Object.assign({}, s, { status: "open", r: null })); added = true; } });
    if (added) saveLocalJournal(jr);
    list.forEach((s) => {
      if (seen.has(s.id)) return; seen.add(s.id);
      const t = `${s.dir === "buy" ? "BUY" : "SHORT"} ${s.symbol} · ${s.label}`;
      const body = `Ingresso ${fmt(s.entry + off())}, stop ${fmt(s.stop + off())}, target ${s.rr}R ${fmt(s.target + off())}. Giudizio: ${(STANCE[s.stance] || [s.stance])[0]}.`;
      beep(); if ("Notification" in window && Notification.permission === "granted") new Notification(t, { body });
    });
    saveAl();
  } catch (e) { /* riprova al prossimo giro */ }
}
function renderSignals(sigs) {
  $("#alList").innerHTML = sigs.length ? `<div class="ctl-label">Segnali freschi adesso</div>` + sigs.map((s) => `<div class="sig"><div><b class="${s.dir === "buy" ? "dir buy" : "dir sell"}" style="font-size:15px">${s.dir === "buy" ? "BUY" : "SHORT"}</b> ${s.label} · ${s.age_min} min fa</div><div class="muted small">ingresso ${fmt(s.entry + off())} · stop ${fmt(s.stop + off())} · target ${s.rr}R ${fmt(s.target + off())}</div>${stancePill(s.stance)}</div>`).join("") : `<p class="muted small">Nessun segnale fresco in questo momento${AL.on ? "" : " (attiva gli avvisi per controllare ogni minuto)"}.</p>`;
}

/* ---------- report ---------- */
let JD = null;
const loadLocalJournal = () => { try { return JSON.parse(localStorage.getItem("xau_journal") || "[]"); } catch (e) { return []; } };
const saveLocalJournal = (items) => localStorage.setItem("xau_journal", JSON.stringify(items.slice(-500)));
async function loadJournal() {
  try {
    JD = await api("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: loadLocalJournal() }) });
    saveLocalJournal(JD.items);
  } catch (e) { return; }
  const s = JD.stats || { n: 0 };
  $("#jStats").innerHTML = s.n ? `<div class="stat"><span>Segnali chiusi</span><b>${s.n}</b></div><div class="stat"><span>Target</span><b class="g">${s.target}</b></div><div class="stat"><span>Stop</span><b class="r">${s.stop}</b></div><div class="stat"><span>Win rate</span><b>${pct(s.win_rate)}</b></div><div class="stat"><span>R totale</span><b class="${s.total_r >= 0 ? "g" : "r"}">${sgn(s.total_r)}</b></div><div class="stat"><span>Ancora aperti</span><b>${JD.open}</b></div>` : `<p class="muted">Ancora nessun segnale chiuso. Attiva gli avvisi: ogni segnale che l'app vede viene salvato qui e seguito fino all'esito.</p>`;
  $("#jStance").innerHTML = Object.entries(JD.by_stance || {}).map(([k, v]) => `<div class="stat"><span>Giudizio: ${(STANCE[k] || [k])[0]}</span><b style="font-size:15px">${v.n} segnali · R medio ${sgn(v.avg_r)}</b></div>`).join("");
  $("#jTable").innerHTML = JD.items.length ? `<table><tr><th>Quando</th><th>Segnale</th><th>Ingresso</th><th>Stop</th><th>Target</th><th>Giudizio</th><th>Esito</th></tr>${JD.items.slice(0, 60).map((x) => `<tr><td class="l">${tIT(x.entry_ts, true)}</td><td class="l"><b class="${x.dir === "buy" ? "dir buy" : "dir sell"}" style="font-size:13px">${x.dir === "buy" ? "BUY" : "SHORT"}</b> ${x.tf} ${x.setup === "breakout" ? "breakout" : x.setup}</td><td>${fmt(x.entry)}</td><td>${fmt(x.stop)}</td><td>${x.rr}R ${fmt(x.target)}</td><td>${stancePill(x.stance)}</td><td>${x.status === "open" ? '<span class="pill amber">aperto</span>' : `<span class="pill ${x.status === "target" ? "green" : x.status === "stop" ? "red" : ""}">${x.status === "target" ? "target" : x.status === "stop" ? "stop" : "chiuso"} ${sgn(x.r)}R</span>`}</td></tr>`).join("")}</table>` : "";
  loadJournalChart();
}
function loadJournalChart() {
  if (S.tab !== "avvisi" || !JD) return;
  const k = setupCanvas($("#cvEq")); if (!k) return; const { c, w, h } = k, eq = JD.equity || [];
  if (eq.length < 2) { c.fillStyle = css("--muted"); c.font = "13px sans-serif"; c.fillText("La curva appare dopo i primi due segnali chiusi.", 8, 24); return; }
  const ml = 8, mr = 44, mt = 10, mb = 18, ys = eq.map((e) => e[1]).concat([0]), lo = Math.min(...ys) - 0.3, hi = Math.max(...ys) + 0.3;
  const X = (i) => ml + i / (eq.length - 1) * (w - ml - mr), Y = (v) => mt + (hi - v) / (hi - lo) * (h - mt - mb);
  c.strokeStyle = css("--line"); c.fillStyle = css("--muted"); c.textAlign = "left"; niceTicks(lo, hi, 4).forEach((t) => { c.beginPath(); c.moveTo(ml, Y(t)); c.lineTo(w - mr, Y(t)); c.stroke(); c.fillText(t.toFixed(1) + "R", w - mr + 6, Y(t) + 4); });
  const last = eq[eq.length - 1][1]; c.strokeStyle = last >= 0 ? css("--green") : css("--red"); c.lineWidth = 2.4; c.beginPath(); eq.forEach((e, i) => (i ? c.lineTo(X(i), Y(e[1])) : c.moveTo(X(i), Y(e[1])))); c.stroke();
}

/* ---------- Claude (opzionale) ---------- */
async function initClaude() {
  try { const h = await api("/api/health"); $("#claudeOn").hidden = !h.claude; $("#claudeOff").hidden = !!h.claude; } catch (e) { /* niente */ }
  $("#askBtn").onclick = async () => {
    const q = $("#askQ").value.trim(); if (!q) return;
    $("#askA").innerHTML = "<p class='muted'>Sto chiedendo a Claude…</p>";
    const ctx = { strumento: S.ov && S.ov.name, time_frame: S.tf, setup: S.setup, target_R: S.rr, spiegazione: S.data && S.data.explanation, lettura_time_frame: S.ov && S.ov.reading };
    try { const r = await api("/api/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, context: ctx }) }); $("#askA").innerHTML = "<p>" + (r.answer || r.error || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>") + "</p>"; } catch (e) { $("#askA").innerHTML = "<p>" + e.message + "</p>"; }
  };
}

/* ---------- avvio ---------- */
buildTf(); buildRr(); buildDirSegs(); buildAlertUi(); initClaude();
load().then(() => { buildAlertUi(); schedulePoll(false); });
setInterval(() => { if (!document.hidden) load(true); }, 90000);

/* ---------- app installabile ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* senza service worker funziona uguale */ });
