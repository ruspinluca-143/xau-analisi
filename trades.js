/* Le mie operazioni (MetaTrader 5): importo il rapporto, statistiche e grafici per periodo (dal 9 al 8 del mese dopo).
   I dati restano SOLO nel browser di questo telefono (localStorage): non vanno mai sul server. */
(function () {
  const KEY = "xau_trades_v1", START_DAY = 9;
  const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const GIORNI = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  let T = [], view = { period: "all", sym: "all" };
  try { T = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { T = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) { msg("Memoria piena: non riesco a salvare.", true); } };
  const num = (x, d = 2) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (x) => (x > 0 ? "+" : "") + num(x);
  const cls = (x) => (x > 0 ? "g" : x < 0 ? "r" : "");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- lettura del file ---------- */
  function decode(buf) {
    const u = new Uint8Array(buf);
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
    if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
    return new TextDecoder("utf-8").decode(buf);
  }
  function splitLine(line, d) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === d && !q) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out.map((x) => x.trim());
  }
  function toRows(text) {
    if (/<tr[\s>]/i.test(text)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      return [...doc.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent.replace(/ /g, " ").trim()));
    }
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    const cnt = (ch) => lines.slice(0, 30).reduce((a, l) => a + (l.split(ch).length - 1), 0);
    const d = [["\t", cnt("\t")], [";", cnt(";")], [",", cnt(",")]].sort((a, b) => b[1] - a[1])[0][0];
    return lines.map((l) => splitLine(l, d));
  }
  const norm = (s) => String(s).toLowerCase().replace(/[^a-zàèéìòù]/g, "");
  const H = {
    time: ["time", "orario", "ora", "data", "opentime", "closetime"], pos: ["position", "posizione", "ticket", "deal", "order", "ordine"],
    sym: ["symbol", "simbolo", "item"], type: ["type", "tipo"], dir: ["direction", "direzione", "entry"], vol: ["volume", "size", "lots"],
    price: ["price", "prezzo"], comm: ["commission", "commissione", "commissioni", "fee"], swap: ["swap"], profit: ["profit", "profitto", "utile"],
    bal: ["balance", "saldo"], src: ["origine", "source", "origin"],
  };
  const idxs = (hdr, names) => hdr.map((h, i) => (names.includes(h) ? i : -1)).filter((i) => i >= 0);
  function parseNum(s) {
    if (s == null) return NaN;
    let t = String(s).replace(/[\s ']/g, "").replace(/[^\d.,\-+]/g, "");
    if (!t) return NaN;
    const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (lc >= 0) t = t.replace(",", ".");
    return parseFloat(t);
  }
  function parseTime(s) {
    if (!s) return NaN;
    let m = String(s).trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = String(s).trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
    return NaN;
  }
  function parseReport(text) {
    const rows = toRows(text), out = [];
    let hi = -1, hdr = null;
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i].map(norm);
      if (idxs(n, H.profit).length && idxs(n, H.sym).length && idxs(n, H.type).length) { hi = i; hdr = n; break; }
    }
    if (hi < 0) return { trades: [], error: "Non riconosco il formato: servono almeno le colonne Simbolo, Tipo e Profitto (rapporto MT5 → Posizioni)." };
    const T_ = idxs(hdr, H.time), P_ = idxs(hdr, H.price), pos = idxs(hdr, H.pos)[0], sym = idxs(hdr, H.sym)[0], typ = idxs(hdr, H.type)[0];
    const dirc = idxs(hdr, H.dir)[0], vol = idxs(hdr, H.vol)[0], comm = idxs(hdr, H.comm)[0], swp = idxs(hdr, H.swap)[0], pr = idxs(hdr, H.profit).slice(-1)[0];
    const srcc = idxs(hdr, H.src)[0];
    const deals = dirc != null; // elenco "Operazioni" (deal) invece di "Posizioni"
    const openQ = {}; // deal di apertura non ancora abbinati: simbolo|direzione|volume -> [{t, p}]
    for (let r = hi + 1; r < rows.length; r++) {
      const c = rows[r];
      if (/^(positions|posizioni|working orders|ordini|a\/c summary|orders)/i.test((c[0] || "").trim())) break; // fine della tabella
      if (c.length < hdr.length - 2) continue;
      const ty = norm(c[typ] || "");
      const prov = srcc != null && norm(c[srcc] || "") === "video"; // riga provvisoria (trascritta da video): la sostituisce l'estratto vero
      if (ty === "swap" && !deals) { // rettifica dello swap di un periodo, ricavata dai totali del conto
        const tt = parseTime(c[T_[T_.length - 1]]), sw0 = swp != null ? parseNum(c[swp]) : NaN;
        if (!isNaN(tt) && !isNaN(sw0)) out.push({ id: String(c[sym] || "").toUpperCase() + "#" + (pos != null ? c[pos] : tt), sym: String(c[sym] || "").toUpperCase(), kind: "adj", dir: null, vol: null, ot: tt, ct: tt, op: 0, cp: 0, comm: 0, swap: sw0, profit: 0, net: sw0, src: "video" });
        continue;
      }
      if (ty !== "buy" && ty !== "sell") continue;
      const profit = parseNum(c[pr]); if (isNaN(profit)) continue;
      let ot, ct, op, cp, dir = ty;
      if (deals) {
        const d = norm(c[dirc] || ""), qk = String(c[sym] || "").toUpperCase() + "|" + ty + "|" + (vol != null ? parseNum(c[vol]) : "");
        if (d === "in") { (openQ[qk] = openQ[qk] || []).push({ t: parseTime(c[T_[0]]), p: parseNum(c[P_[0]]) }); continue; } // apertura: la ricordo
        if (!d.includes("out")) continue; // conta solo la chiusura
        ct = parseTime(c[T_[0]]); cp = parseNum(c[P_[0]]); dir = ty === "buy" ? "sell" : "buy"; // chiusura di un buy = sell
        const q = openQ[String(c[sym] || "").toUpperCase() + "|" + dir + "|" + (vol != null ? parseNum(c[vol]) : "")], o = q && q.length ? q.shift() : null;
        ot = o ? o.t : ct; op = o ? o.p : cp;
      } else {
        if (T_.length < 2 || P_.length < 2) continue;
        ot = parseTime(c[T_[0]]); ct = parseTime(c[T_[1]]); op = parseNum(c[P_[0]]); cp = parseNum(c[P_[1]]);
      }
      if (isNaN(ct)) continue;
      const cm = comm != null ? parseNum(c[comm]) || 0 : 0, sw = swp != null ? parseNum(c[swp]) || 0 : 0;
      const sy = String(c[sym] || "").toUpperCase();
      const id = (pos != null && c[pos] ? sy + "#" + c[pos] : sy + "|" + ot + "|" + ct + "|" + dir + "|" + (vol != null ? c[vol] : ""));
      out.push({ id, sym: sy, dir, vol: vol != null ? parseNum(c[vol]) : null, ot: isNaN(ot) ? ct : ot, ct, op, cp, comm: cm, swap: sw, profit, net: profit + cm + sw, src: prov ? "video" : undefined });
    }
    return { trades: out, error: out.length ? "" : "Ho trovato le colonne ma nessuna operazione chiusa." };
  }
  function importText(text) {
    const r = parseReport(text);
    if (r.error) return msg(r.error, true);
    const day = (ms) => Math.floor(ms / 86400000), real = r.trades.filter((t) => t.src !== "video");
    let tolte = 0;
    if (real.length) { // dati veri (estratto): tolgo le righe provvisorie dei giorni coperti
      const lo = Math.min(...real.map((t) => day(t.ct))), hi = Math.max(...real.map((t) => day(t.ct)));
      const keep = T.filter((t) => !(t.src === "video" && day(t.ct) >= lo && day(t.ct) <= hi));
      tolte = T.length - keep.length; T = keep;
    }
    const have = new Map(T.map((t) => [t.id, t])); let nuove = 0;
    r.trades.forEach((t) => { if (!have.has(t.id)) { nuove++; have.set(t.id, t); } }); // le operazioni già salvate non si toccano
    T = [...have.values()].sort((a, b) => a.ct - b.ct); save();
    msg(`Letto: ${r.trades.length} operazioni, di cui ${nuove} nuove (le altre c'erano già).` + (tolte ? ` Sostituite ${tolte} righe provvisorie con i dati veri.` : ""));
    render();
  }
  function msg(t, bad) { const el = document.querySelector("#opMsg"); if (el) { el.textContent = t; el.style.color = bad ? "var(--red)" : "var(--green)"; } }

  /* ---------- periodi dal 9 al 8 ---------- */
  function periodStart(ms) {
    const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth();
    return d.getUTCDate() >= START_DAY ? Date.UTC(y, m, START_DAY) : Date.UTC(y, m - 1, START_DAY);
  }
  function periodLabel(st) {
    const a = new Date(st), b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, START_DAY - 1));
    return `${a.getUTCDate()} ${MESI[a.getUTCMonth()]} – ${b.getUTCDate()} ${MESI[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  function stats(L0) {
    const L = L0.filter((t) => !t.kind), adj = L0.filter((t) => t.kind === "adj").reduce((a, t) => a + t.net, 0);
    const n = L.length, w = L.filter((t) => t.net > 0), l = L.filter((t) => t.net < 0);
    const gw = w.reduce((a, t) => a + t.net, 0), gl = -l.reduce((a, t) => a + t.net, 0);
    const dur = L.filter((t) => t.ot < t.ct).map((t) => (t.ct - t.ot) / 60000);
    return {
      n, net: L.reduce((a, t) => a + t.net, 0) + adj, win: n ? w.length / n : null, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null,
      avgW: w.length ? gw / w.length : null, avgL: l.length ? -gl / l.length : null, best: n ? Math.max(...L.map((t) => t.net)) : null,
      worst: n ? Math.min(...L.map((t) => t.net)) : null, dur: dur.length ? dur.reduce((a, b) => a + b, 0) / dur.length : null,
      cost: L.reduce((a, t) => a + t.comm + t.swap, 0) + adj, exp: n ? L.reduce((a, t) => a + t.net, 0) / n : null,
    };
  }
  const fdur = (m) => (m == null ? "–" : m >= 180 ? num(m / 60, 1) + " ore" : Math.round(m) + " min");

  /* ---------- grafici ---------- */
  function lineChart(id, pts) {
    const cv = document.querySelector(id); if (!cv) return; const k = setupCanvas(cv); if (!k) return; const { c, w, h } = k;
    if (pts.length < 2) { c.fillStyle = css("--muted"); c.font = "13px sans-serif"; c.fillText("Servono almeno due operazioni.", 8, 24); return; }
    const ml = 8, mr = 50, mt = 10, mb = 18, ys = pts.map((p) => p.v).concat([0]), span = Math.max(...ys) - Math.min(...ys) || 1;
    const lo = Math.min(...ys) - span * 0.08, hi = Math.max(...ys) + span * 0.08;
    const X = (i) => ml + (i / (pts.length - 1)) * (w - ml - mr), Y = (v) => mt + ((hi - v) / (hi - lo)) * (h - mt - mb);
    c.strokeStyle = css("--line"); c.fillStyle = css("--muted"); c.textAlign = "left"; c.lineWidth = 1;
    niceTicks(lo, hi, 4).forEach((t) => { c.beginPath(); c.moveTo(ml, Y(t)); c.lineTo(w - mr, Y(t)); c.stroke(); c.fillText(num(t, 0), w - mr + 5, Y(t) + 4); });
    const last = pts[pts.length - 1].v; c.strokeStyle = last >= 0 ? css("--green") : css("--red"); c.lineWidth = 2.4; c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(X(i), Y(p.v)) : c.moveTo(X(i), Y(p.v)))); c.stroke();
    c.fillStyle = css("--muted"); c.textAlign = "left"; c.fillText(pts[0].t, ml, h - 4); c.textAlign = "right"; c.fillText(pts[pts.length - 1].t, w - mr, h - 4);
  }
  function barChart(id, items) {
    const cv = document.querySelector(id); if (!cv) return; const k = setupCanvas(cv); if (!k) return; const { c, w, h } = k;
    if (!items.length) { c.fillStyle = css("--muted"); c.font = "13px sans-serif"; c.fillText("Nessun dato.", 8, 24); return; }
    const ml = 6, mr = 50, mt = 10, mb = 18, vs = items.map((i) => i.v).concat([0]), span = Math.max(...vs) - Math.min(...vs) || 1;
    const lo = Math.min(...vs) - span * 0.06, hi = Math.max(...vs) + span * 0.06;
    const Y = (v) => mt + ((hi - v) / (hi - lo)) * (h - mt - mb), bw = (w - ml - mr) / items.length;
    c.strokeStyle = css("--line"); c.fillStyle = css("--muted"); c.textAlign = "left"; c.lineWidth = 1;
    niceTicks(lo, hi, 4).forEach((t) => { c.beginPath(); c.moveTo(ml, Y(t)); c.lineTo(w - mr, Y(t)); c.stroke(); c.fillText(num(t, 0), w - mr + 5, Y(t) + 4); });
    items.forEach((it, i) => {
      c.fillStyle = it.v >= 0 ? css("--green") : css("--red"); const x = ml + i * bw + bw * 0.15, y0 = Y(0), y1 = Y(it.v);
      c.fillRect(x, Math.min(y0, y1), bw * 0.7, Math.max(1, Math.abs(y1 - y0)));
    });
    c.fillStyle = css("--muted"); c.textAlign = "center"; const every = Math.ceil(items.length / Math.max(1, Math.floor((w - ml - mr) / 34)));
    items.forEach((it, i) => { if (i % every === 0) c.fillText(it.t, ml + i * bw + bw / 2, h - 4); });
  }

  /* ---------- schermata ---------- */
  function render() {
    if (!document.querySelector("#opData")) return;
    const syms = [...new Set(T.map((t) => t.sym))];
    if (view.sym !== "all" && !syms.includes(view.sym)) view.sym = "all";
    const pool = view.sym === "all" ? T : T.filter((t) => t.sym === view.sym);
    const starts = [...new Set(pool.map((t) => periodStart(t.ct)))].sort((a, b) => b - a);
    if (view.period !== "all" && !starts.includes(+view.period)) view.period = starts.length ? String(starts[0]) : "all";
    if (view.period === "all" && !view.touched && starts.length) view.period = String(starts[0]); // all'inizio: periodo più recente
    const L = view.period === "all" ? pool : pool.filter((t) => periodStart(t.ct) === +view.period);
    document.querySelector("#opEmpty").hidden = T.length > 0;
    document.querySelector("#opData").hidden = T.length === 0;
    if (!T.length) return;
    document.querySelector("#opPeriod").innerHTML = `<option value="all">Tutto lo storico</option>` + starts.map((s) => `<option value="${s}" ${String(s) === view.period ? "selected" : ""}>${periodLabel(s)}</option>`).join("");
    document.querySelector("#opPeriod").value = view.period;
    document.querySelector("#opSym").innerHTML = `<option value="all">Tutti i simboli</option>` + syms.map((s) => `<option ${s === view.sym ? "selected" : ""}>${esc(s)}</option>`).join("");
    document.querySelector("#opSym").hidden = syms.length < 2;
    const s = stats(L);
    const box = (a, b, k) => `<div class="stat"><span>${a}</span><b class="${k || ""}">${b}</b></div>`;
    document.querySelector("#opStats").innerHTML = s.n
      ? box("Risultato netto", sg(s.net), cls(s.net)) + box("Operazioni", s.n) + box("Vinte", pct(s.win)) +
        box("Profit factor", s.pf == null ? "–" : s.pf === Infinity ? "∞" : num(s.pf)) + box("Media vincita", sg(s.avgW || 0), "g") + box("Media perdita", num(s.avgL || 0), "r") +
        box("Migliore", sg(s.best), cls(s.best)) + box("Peggiore", num(s.worst), cls(s.worst)) + box("Media a operazione", sg(s.exp), cls(s.exp)) +
        box("Durata media", fdur(s.dur)) + box("Commissioni + swap", num(s.cost), cls(s.cost))
      : '<p class="muted">Nessuna operazione in questo periodo.</p>';
    // curva
    let run = 0; const curve = L.map((t) => ({ v: (run += t.net), t: dd(t.ct) }));
    lineChart("#cvOpEq", curve);
    // per giorno
    const byDay = new Map(); L.forEach((t) => { const k = Math.floor(t.ct / 86400000); byDay.set(k, (byDay.get(k) || 0) + t.net); });
    barChart("#cvOpDay", [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ v, t: dd(k * 86400000) })));
    // giorno della settimana e ora
    const wd = [1, 2, 3, 4, 5].map((d) => ({ t: GIORNI[d], v: L.filter((t) => !t.kind && new Date(t.ct).getUTCDay() === d).reduce((a, t) => a + t.net, 0) }));
    barChart("#cvOpWd", wd);
    const hrs = Array.from({ length: 24 }, (_, hh) => ({ t: String(hh), v: L.filter((t) => !t.kind && new Date(t.ot).getUTCHours() === hh).reduce((a, t) => a + t.net, 0) }));
    barChart("#cvOpHr", hrs);
    // buy vs short
    document.querySelector("#opDir").innerHTML = ["buy", "sell"].map((d) => {
      const x = stats(L.filter((t) => t.dir === d));
      return `<div class="sigrow"><div class="sr1"><b class="dir ${d}">${d === "buy" ? "BUY" : "SHORT"}</b><span>${x.n} operazioni</span><span class="when ${cls(x.net)}">${x.n ? sg(x.net) : "–"}</span></div>${x.n ? `<div class="sr2"><span>Vinte <b>${pct(x.win)}</b></span><span>Media <b>${sg(x.exp)}</b></span><span>Durata <b>${fdur(x.dur)}</b></span></div>` : ""}</div>`;
    }).join("");
    // confronto periodi
    document.querySelector("#opPeriods").innerHTML = starts.map((st) => {
      const x = stats(pool.filter((t) => periodStart(t.ct) === st));
      return `<div class="sigrow"><div class="sr1"><b>${periodLabel(st)}</b><span class="when ${cls(x.net)}" style="font-weight:700">${sg(x.net)}</span></div><div class="sr2"><span>Operazioni <b>${x.n}</b></span><span>Vinte <b>${pct(x.win)}</b></span><span>Profit factor <b>${x.pf == null ? "–" : x.pf === Infinity ? "∞" : num(x.pf)}</b></span></div></div>`;
    }).join("");
    barChart("#cvOpPer", [...starts].reverse().map((st) => ({ t: MESI[new Date(st).getUTCMonth()], v: stats(pool.filter((t) => periodStart(t.ct) === st)).net })));
    // elenco
    document.querySelector("#opList").innerHTML = [...L].reverse().slice(0, 60).map((t) => t.kind === "adj"
      ? `<div class="sigrow"><div class="sr1"><b>Swap del periodo</b><span class="when">${dd(t.ct)}</span></div><div class="sr2"><span>Da totale del conto: finché non arriva l'estratto mensile</span></div><div class="sr3"><span class="pill ${t.net < 0 ? "red" : "green"}">${sg(t.net)}</span></div></div>`
      : `<div class="sigrow"><div class="sr1"><b class="dir ${t.dir}">${t.dir === "buy" ? "BUY" : "SHORT"}</b><span>${esc(t.sym)}${t.vol != null ? " · " + num(t.vol) + " lotti" : ""}</span><span class="when">${dd(t.ct)} ${hm(t.ct)}</span></div>
       <div class="sr2"><span>Apertura <b>${num(t.op)}</b></span><span>Chiusura <b>${num(t.cp)}</b></span><span>Durata <b>${fdur((t.ct - t.ot) / 60000)}</b></span></div>
       <div class="sr3"><span class="pill ${t.net > 0 ? "green" : t.net < 0 ? "red" : ""}">${sg(t.net)}</span></div></div>`).join("");
  }
  const dd = (ms) => { const d = new Date(ms); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
  const hm = (ms) => { const d = new Date(ms); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };

  /* ---------- comandi ---------- */
  function init() {
    const f = document.querySelector("#opFile"); if (!f) return;
    f.onchange = async () => {
      for (const file of f.files) { try { importText(decode(await file.arrayBuffer())); } catch (e) { msg("Non riesco a leggere il file: " + e.message, true); } }
      f.value = "";
    };
    document.querySelector("#opPasteBtn").onclick = () => { const b = document.querySelector("#opPasteBox"); b.hidden = !b.hidden; };
    document.querySelector("#opImport").onclick = () => { const t = document.querySelector("#opText").value; if (t.trim()) { importText(t); document.querySelector("#opText").value = ""; document.querySelector("#opPasteBox").hidden = true; } };
    document.querySelector("#opPeriod").onchange = (e) => { view.period = e.target.value; view.touched = true; render(); };
    document.querySelector("#opSym").onchange = (e) => { view.sym = e.target.value; render(); };
    document.querySelector("#opClear").onclick = () => { if (confirm("Cancello tutte le operazioni salvate su questo telefono?")) { T = []; save(); view = { period: "all", sym: "all" }; msg("Dati cancellati."); render(); } };
    document.querySelector("#opExport").onclick = () => {
      const f2 = (ms) => { const d = new Date(ms), z = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}.${z(d.getUTCMonth() + 1)}.${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`; };
      // stesso formato che l'importazione sa leggere: serve per portare i dati su un altro telefono senza duplicati
      const csv = "Orario;Posizione;Simbolo;Tipo;Volume;Prezzo;S / L;T / P;Orario;Prezzo;Commissione;Swap;Profitto;Origine\n" + T.map((t) => [f2(t.ot), String(t.id).split("#").pop(), t.sym, t.kind === "adj" ? "swap" : t.dir, t.vol, t.op, 0, 0, f2(t.ct), t.cp, t.comm, t.swap, t.profit, t.src || ""].join(";")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "mie-operazioni.csv"; a.click();
    };
    new MutationObserver(() => { if (document.body.dataset.tab === "op") setTimeout(render, 160); }).observe(document.body, { attributes: true, attributeFilter: ["data-tab"] });
    window.addEventListener("resize", () => setTimeout(render, 50));
    render();
  }
  window.OP = { parseReport, periodStart, periodLabel, stats, importText, all: () => T };
  init();
})();
