/* Le mie operazioni (MetaTrader 5): importo il rapporto, statistiche e grafici per periodo (dal 9 al 8 del mese dopo).
   I dati restano SOLO nel browser di questo telefono (localStorage): non vanno mai sul server. */
(function () {
  const KEY = "xau_trades_v1", START_DAY = 9;
  const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const GIORNI = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  let T = [], view = { period: "all", sym: "all", horizon: "1" };
  try { T = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { T = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(T)); } catch (e) { msg("Memoria piena: non riesco a salvare.", true); } };
  const TAX = 0.26, afterTax = (v) => (v > 0 ? v * (1 - TAX) : v); // stima: 26% sul guadagno netto positivo
  const num = (x, d = 2) => (x == null || isNaN(x) ? "–" : (Number(x) + 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }));
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
  /* contatore: quante operazioni sono davvero salvate in questo browser (riletto dalla memoria, non da quello che è in pagina) */
  let persisted = null;
  function updateCount() {
    const el = document.querySelector("#opCount"); if (!el) return;
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { el.textContent = "Memoria del browser non leggibile."; el.style.color = "var(--red)"; return; }
    const real = stored.filter((t) => !t.kind), prov = stored.filter((t) => t.src === "video" && !t.kind).length;
    const range = real.length ? ` dal ${dd(real[0].ct)} al ${dd(real[real.length - 1].ct)}` : "";
    el.textContent = `Salvate su questo telefono: ${real.length} operazioni${range}` + (prov ? ` (di cui ${prov} provvisorie da video)` : "") + (persisted === false ? " · memoria non protetta: il browser potrebbe cancellarla" : persisted === true ? " · memoria protetta" : "");
    el.style.color = real.length ? "var(--green)" : "var(--muted)";
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then((ok) => { persisted = !!ok; updateCount(); }).catch(() => {}); } catch (e) { /* senza: funziona uguale */ }
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
    cv._hit = (x) => { if (x > w - mr + 4) return null; const i = Math.max(0, Math.min(pts.length - 1, Math.round(((x - ml) / (w - ml - mr)) * (pts.length - 1)))), p = pts[i]; return `<b>${p.t}</b><br>Totale: <b class="${cls(p.v)}">${sg(p.v)}</b>` + (p.d ? "<br>" + p.d : ""); };
  }

  /* ---------- prospettive: stime dai risultati passati (non sono previsioni) ---------- */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pctile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  function weekdaysBetween(a, b) { // giorni lavorativi da a (escluso) a b (incluso), in UTC
    let n = 0; for (let d = Math.floor(a / 86400000) + 1; d <= Math.floor(b / 86400000); d++) { const w = new Date(d * 86400000).getUTCDay(); if (w >= 1 && w <= 5) n++; } return n;
  }
  /* risultato di ogni giorno di mercato (lun-ven) dal primo all'ultimo giorno con operazioni; i giorni senza operazioni valgono 0 */
  function dailySeries(list, val, useAdj) {
    const real = list.filter((t) => !t.kind), adj = list.filter((t) => t.kind === "adj");
    if (!real.length) return [];
    const D = 86400000, d0 = Math.floor(Math.min(...real.map((t) => t.ct)) / D), d1 = Math.floor(Math.max(...real.map((t) => t.ct)) / D), days = [];
    for (let d = d0; d <= d1; d++) { const w = new Date(d * D).getUTCDay(); if (w >= 1 && w <= 5) days.push(d); }
    const idx = new Map(days.map((d, i) => [d, i])), out = new Array(days.length).fill(0);
    real.forEach((t) => { let d = Math.floor(t.ct / D); while (!idx.has(d) && d <= d1) d++; while (!idx.has(d) && d >= d0) d--; if (idx.has(d)) out[idx.get(d)] += val(t); });
    if (useAdj) adj.forEach((a) => { const from = Math.floor(periodStart(a.ct) / D), ds = days.filter((d) => d >= from && d <= Math.floor(a.ct / D)); ds.forEach((d) => { out[idx.get(d)] += a.net / ds.length; }); });
    return out;
  }
  function projection(pool) {
    const txt = document.querySelector("#opProjTxt"), note = document.querySelector("#opProjNote"); if (!txt) return;
    const trades = pool.filter((t) => !t.kind);
    const clr = (id) => { const cv = document.querySelector(id); if (cv) { const k = setupCanvas(cv); if (k) { k.c.fillStyle = css("--muted"); k.c.font = "13px sans-serif"; k.c.fillText("Servono più operazioni.", 8, 24); } } };
    if (trades.length < 30) { txt.textContent = "Servono almeno 30 operazioni per fare una stima."; clr("#cvOpProj"); clr("#cvOpProjH"); note.textContent = ""; return; }
    const nets = dailySeries(pool, (t) => t.net, true); // un valore per ogni giorno di mercato: la base della stima
    if (nets.length < 10) { txt.textContent = "Servono almeno 10 giorni di mercato con operazioni per fare una stima."; clr("#cvOpProj"); clr("#cvOpProjH"); note.textContent = ""; return; }
    const last = Math.max(...pool.map((t) => t.ct)), now = Math.max(Date.now(), last);
    let st = periodStart(last); const endOf = (s0) => { const a = new Date(s0); return Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, START_DAY - 1, 23, 59, 59); };
    const M = horizonMonths(), endH = (s0) => { const a = new Date(s0); return Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + M, START_DAY - 1, 23, 59, 59); };
    const dl = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${MESI[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
    const endWord = M === 1 ? "periodo" : M === 3 ? "trimestre" : M === 12 ? "anno" : M / 12 + " anni", endPhrase = M <= 12 ? "di fine " + endWord : "fra " + endWord;
    let ended = now > endOf(st), base, label;
    if (ended) { st = periodStart(endOf(st) + 86400000); base = 0; label = "prossimo periodo (" + periodLabel(st) + ")"; }
    else { base = pool.filter((t) => periodStart(t.ct) === st).reduce((a, t) => a + t.net, 0); label = "periodo in corso (" + periodLabel(st) + ")"; }
    const days = new Set(trades.map((t) => Math.floor(t.ct / 86400000))).size, tpd = trades.length / Math.max(1, days);
    if (M > 1) label = (ended || M > 12 ? "prossimi " : "") + (M === 3 ? "tre periodi" : M === 12 ? "dodici periodi" : M / 12 + " anni") + " (" + dl(st) + " – " + dl(endH(st)) + ")";
    const from = ended ? st - 86400000 : now, rem = weekdaysBetween(from, endH(st)), N = rem; // giorni di mercato rimasti
    const R = 1500, rand = rng(12345), ends = [], dds = [], long = N > 3000;
    const mu = nets.reduce((a, b) => a + b, 0) / nets.length, sd = Math.sqrt(nets.reduce((a, b) => a + (b - mu) * (b - mu), 0) / Math.max(1, nets.length - 1));
    const gauss = () => { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
    const steps = Math.max(2, Math.min(N, 120)), per = N / steps; // punti sul grafico
    const grid = Array.from({ length: steps + 1 }, () => []);
    if (!long) { // fino a ~6000 operazioni: si rimescolano davvero le tue operazioni
      for (let r = 0; r < R; r++) {
        let cum = base, peak = base, dd = 0, k = 0;
        grid[0].push(base);
        for (let i = 1; i <= N; i++) {
          cum += nets[Math.floor(rand() * nets.length)]; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum;
          if (i >= (k + 1) * per - 1e-9 && k < steps) { k++; grid[k].push(cum); }
        }
        while (k < steps) { k++; grid[k].push(cum); }
        ends.push(cum); dds.push(dd);
      }
    } else { // orizzonti lunghi (anni): somma di moltissime operazioni = media e variabilità dei tuoi risultati, a passi
      const Sx = Math.min(N, 480), m = N / Sx, every = Sx / steps;
      for (let r = 0; r < R; r++) {
        let cum = base, peak = base, dd = 0, k = 0; grid[0].push(base);
        for (let i = 1; i <= Sx; i++) {
          cum += mu * m + sd * Math.sqrt(m) * gauss(); if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum;
          if (i >= (k + 1) * every - 1e-9 && k < steps) { k++; grid[k].push(cum); }
        }
        while (k < steps) { k++; grid[k].push(cum); }
        ends.push(cum); dds.push(dd);
      }
    }
    ends.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    const band = grid.map((g) => { g.sort((a, b) => a - b); return [pctile(g, 0.1), pctile(g, 0.5), pctile(g, 0.9)]; });
    const shown = (q) => (q > 0.99 ? "oltre il 99%" : q < 0.01 ? "meno dell'1%" : pct(q));
    const pos = ends.filter((v) => v > 0).length / R, med = pctile(ends, 0.5), lo = pctile(ends, 0.1), hi = pctile(ends, 0.9);
    // scenario prudente: stessa variabilità ma nessun vantaggio medio (media per operazione = 0)
    const mean = nets.reduce((a, b) => a + b, 0) / nets.length, flat = nets.map((v) => v - mean), r2 = rng(777), e0 = [];
    for (let r = 0; r < 800; r++) { let cum = base; if (long) { cum += sd * Math.sqrt(N) * gauss(); } else { for (let i = 0; i < N; i++) cum += flat[Math.floor(r2() * flat.length)]; } e0.push(cum); }
    e0.sort((a, b) => a - b); const med0 = pctile(e0, 0.5), pos0 = e0.filter((v) => v > 0).length / e0.length, lo0 = pctile(e0, 0.1);
    txt.innerHTML = `Stima per ${M === 1 ? "il" : "i"} <b>${label}</b>. ${M > 1 ? "Finora nel periodo in corso" : "Finora"}: <b class="${cls(base)}">${sg(base)}</b>. Restano circa <b>${rem}</b> giorni di mercato. Finora hai fatto in media <b class="${cls(mu)}">${sg(mu)}</b> per giorno di mercato (circa <b>${sg(mu * 21)}</b> per ogni periodo di un mese), calcolato su ${nets.length} giorni di mercato.<br>`
      + `Risultato ${endPhrase}: mediano <b class="${cls(med)}">${sg(med)}</b> (dopo il 26% di tasse circa <b>${sg(afterTax(med))}</b>); nel 10% dei casi peggiori <b class="${cls(lo)}">${sg(lo)}</b> o meno; nel 10% dei migliori <b class="${cls(hi)}">${sg(hi)}</b> o più.<br>`
      + `Probabilità di chiudere il periodo in positivo: <b>${shown(pos)}</b>. Calo massimo che potresti incontrare nel periodo (95% dei casi): <b>${num(pctile(dds, 0.95), 0)}</b> dal punto più alto.<br>`
      + `<b>Scenario prudente</b> (se in media ogni operazione non guadagnasse nulla, cioè senza vantaggio): mediano <b class="${cls(med0)}">${sg(med0)}</b>, nel 10% dei casi peggiori <b class="${cls(lo0)}">${sg(lo0)}</b> o meno, probabilità di chiudere in positivo <b>${shown(pos0)}</b>. Più i due scenari sono distanti, più la stima dipende da un periodo andato bene.` + (M > 12 ? `<br><b>Attenzione:</b> su ${M / 12} anni questi importi sono solo un calcolo aritmetico (stesso ritmo e stessi lotti per sempre), non una previsione di quanto guadagnerai.` : "");
    note.textContent = `Stima fatta rimescolando 1.500 volte i tuoi ${nets.length} giorni di mercato (anche quelli senza operazioni), cioè sulla media di quello che hai fatto finora diviso per i giorni. Non è una previsione: assume che le operazioni future somiglino a quelle passate e non tiene conto delle serie di vincite o perdite. Con pochi mesi di storico è molto indicativa, non sicura.` + (M > 1 ? " Su un orizzonte lungo conta ancora di più: la stima presuppone che per tutto questo tempo tu faccia lo stesso numero di operazioni con gli stessi risultati di questi pochi mesi. Prendila come un esercizio, non come un obiettivo." : "") + (M > 12 ? " Per più anni il calcolo usa la media e la variabilità dei tuoi risultati (non rimescola ogni singolo giorno), con lotti costanti: non considera reinvestimento, inflazione, cambi di strategia né periodi in cui non operi." : "");
    fan("#cvOpProj", band, base, per, M <= 12 ? "fine " + endWord : endWord);
    hist("#cvOpProjH", ends);
  }
  function fan(id, band, base, per, endLabel) {
    const cv = document.querySelector(id); if (!cv) return; const k = setupCanvas(cv); if (!k) return; const { c, w, h } = k;
    const ml = 8, mr = 50, mt = 10, mb = 18, ys = band.flatMap((b) => b).concat([0, base]), span = Math.max(...ys) - Math.min(...ys) || 1;
    const lo = Math.min(...ys) - span * 0.06, hi = Math.max(...ys) + span * 0.06, n = band.length - 1 || 1;
    const X = (i) => ml + (i / n) * (w - ml - mr), Y = (v) => mt + ((hi - v) / (hi - lo)) * (h - mt - mb);
    c.strokeStyle = css("--line"); c.fillStyle = css("--muted"); c.textAlign = "left"; c.lineWidth = 1;
    niceTicks(lo, hi, 4).forEach((t) => { c.beginPath(); c.moveTo(ml, Y(t)); c.lineTo(w - mr, Y(t)); c.stroke(); c.fillText(num(t, 0), w - mr + 5, Y(t) + 4); });
    c.beginPath(); band.forEach((b, i) => (i ? c.lineTo(X(i), Y(b[2])) : c.moveTo(X(i), Y(b[2])))); for (let i = band.length - 1; i >= 0; i--) c.lineTo(X(i), Y(band[i][0])); c.closePath();
    c.fillStyle = "rgba(120,200,160,.22)"; c.fill();
    c.strokeStyle = css("--green"); c.lineWidth = 2.2; c.beginPath(); band.forEach((b, i) => (i ? c.lineTo(X(i), Y(b[1])) : c.moveTo(X(i), Y(b[1])))); c.stroke();
    c.strokeStyle = css("--muted"); c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(ml, Y(0)); c.lineTo(w - mr, Y(0)); c.stroke(); c.setLineDash([]);
    c.fillStyle = css("--muted"); c.textAlign = "left"; c.fillText("oggi", ml, h - 4); c.textAlign = "right"; c.fillText(endLabel || "fine periodo", w - mr, h - 4);
    cv._hit = (x) => { if (x > w - mr) return null; const i = Math.max(0, Math.min(band.length - 1, Math.round(((x - ml) / (w - ml - mr)) * n))), b = band[i], ops = Math.round(i * per); return `<b>${i === 0 ? "Oggi" : "Dopo circa " + ops + " giorni di mercato"}</b><br>Caso mediano: <b class="${cls(b[1])}">${sg(b[1])}</b> (dopo tasse ${sg(afterTax(b[1]))})<br>Nel 10% dei casi peggiori: ${sg(b[0])} o meno<br>Nel 10% dei migliori: ${sg(b[2])} o più`; };
  }
  function hist(id, ends) {
    const cv = document.querySelector(id); if (!cv) return; const k = setupCanvas(cv); if (!k) return; const { c, w, h } = k;
    const B = 24, lo = ends[0], hi = ends[ends.length - 1], bw0 = (hi - lo) / B || 1, cnt = new Array(B).fill(0);
    ends.forEach((v) => { cnt[Math.min(B - 1, Math.floor((v - lo) / bw0))]++; });
    const mx = Math.max(...cnt), ml = 8, mr = 8, mt = 10, mb = 18, bw = (w - ml - mr) / B;
    cnt.forEach((n, i) => { const mid = lo + (i + 0.5) * bw0; c.fillStyle = mid >= 0 ? css("--green") : css("--red"); const bh = (n / mx) * (h - mt - mb); c.fillRect(ml + i * bw + 1, h - mb - bh, bw - 2, bh); });
    c.fillStyle = css("--muted"); c.font = "11px sans-serif"; c.textAlign = "left"; c.fillText(num(lo, 0), ml, h - 4); c.textAlign = "right"; c.fillText(num(hi, 0), w - mr, h - 4);
    if (lo < 0 && hi > 0) { const x = ml + ((0 - lo) / (hi - lo)) * (w - ml - mr); c.strokeStyle = css("--muted"); c.setLineDash([4, 4]); c.beginPath(); c.moveTo(x, mt); c.lineTo(x, h - mb); c.stroke(); c.setLineDash([]); c.textAlign = "center"; c.fillText("0", x, h - 4); }
    cv._hit = (x) => { const i = Math.floor((x - ml) / bw); if (i < 0 || i >= B || x > w - mr) return null; const a = lo + i * bw0, b2 = a + bw0, above = cnt.slice(i).reduce((q, v) => q + v, 0) / ends.length; return `<b>Da ${sg(a)} a ${sg(b2)}</b><br>${pct(cnt[i] / ends.length, 1)} degli scenari chiude qui<br>${pct(above)} degli scenari chiude a ${sg(a)} o più`; };
  }

  /* ---------- dati veri: calo massimo, serie, giorni migliori e peggiori, dimensione delle operazioni ---------- */
  function extra(L0) {
    const el = document.querySelector("#opExtra"); if (!el) return;
    const L = L0.filter((t) => !t.kind).sort((a, b) => a.ct - b.ct);
    if (!L.length) { el.innerHTML = '<p class="muted">Nessuna operazione.</p>'; return; }
    let run = 0, peak = 0, dd = 0, ddFrom = null, ddTo = null, pkT = L[0].ct;
    L.forEach((t) => { run += t.net; if (run > peak) { peak = run; pkT = t.ct; } if (peak - run > dd) { dd = peak - run; ddFrom = pkT; ddTo = t.ct; } });
    let w = 0, l = 0, bw = 0, bl = 0; L.forEach((t) => { if (t.net > 0) { w++; l = 0; } else if (t.net < 0) { l++; w = 0; } else { w = 0; l = 0; } bw = Math.max(bw, w); bl = Math.max(bl, l); });
    const byDay = new Map(); L.forEach((t) => { const k = Math.floor(t.ct / 86400000); const o = byDay.get(k) || { net: 0, n: 0 }; o.net += t.net; o.n++; byDay.set(k, o); });
    const days = [...byDay.entries()].sort((a, b) => b[1].net - a[1].net), best = days[0], worst = days[days.length - 1];
    const pos = days.filter((d) => d[1].net > 0).length;
    const box = (a, b, k) => `<div class="stat"><span>${a}</span><b class="${k || ""}">${b}</b></div>`;
    const sizes = [["fino a 0,02 lotti", (v) => v != null && v <= 0.02], ["0,03 – 0,04 lotti", (v) => v != null && v > 0.02 && v < 0.05], ["0,05 lotti o più", (v) => v != null && v >= 0.05]];
    el.innerHTML = '<div class="statrow">'
      + box("Calo massimo", num(-dd, 2), dd ? "r" : "") + box("Serie vinte (max)", bw) + box("Serie perse (max)", bl)
      + box("Giorni operativi", byDay.size) + box("Giorni in positivo", pct(pos / byDay.size)) + box("Operazioni al giorno", num(L.length / byDay.size, 1))
      + box("Media al giorno", sg(run / byDay.size), cls(run)) + box("Giorno migliore", `${dd2(best[0])} ${sg(best[1].net)}`, "g") + box("Giorno peggiore", `${dd2(worst[0])} ${num(worst[1].net)}`, worst[1].net < 0 ? "r" : "")
      + "</div>" + (dd ? `<p class="muted small">Il calo massimo è la discesa più grande dal punto più alto del conto, dal ${dd2(Math.floor(ddFrom / 86400000))} al ${dd2(Math.floor(ddTo / 86400000))}.</p>` : "")
      + "<div class=\"ctl-label\" style=\"margin-top:8px\">Per dimensione dell'operazione</div>"
      + sizes.map(([name, f]) => { const x = stats(L.filter((t) => f(t.vol))); return x.n ? `<div class="sigrow"><div class="sr1"><b>${name}</b><span class="when ${cls(x.net)}" style="font-weight:700">${sg(x.net)}</span></div><div class="sr2"><span>Operazioni <b>${x.n}</b></span><span>Vinte <b>${pct(x.win)}</b></span><span>Media <b>${sg(x.exp)}</b></span></div></div>` : ""; }).join("");
  }
  const dd2 = (day) => { const d = new Date(day * 86400000); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };

  /* ---------- che lotto usare: in base ai soldi sul conto e a come operi davvero ---------- */
  const LKEY = "xau_lotto";
  let LOT = { cap: "", dd: "20" };
  try { LOT = Object.assign(LOT, JSON.parse(localStorage.getItem(LKEY) || "{}")); } catch (e) { /* senza: valori di partenza */ }
  const saveLot = () => { try { localStorage.setItem(LKEY, JSON.stringify(LOT)); } catch (e) { /* senza: funziona uguale */ } };
  function lotAdvice(pool) {
    const el = document.querySelector("#opLot"); if (!el) return;
    const capEl = document.querySelector("#opCap"), ddEl = document.querySelector("#opDdLim");
    if (capEl && document.activeElement !== capEl) capEl.value = LOT.cap;
    if (ddEl) ddEl.value = LOT.dd;
    const trades = pool.filter((t) => !t.kind && t.vol > 0);
    if (trades.length < 30) { el.innerHTML = '<p class="muted">Servono almeno 30 operazioni con la dimensione (lotti) per dare un consiglio.</p>'; return; }
    const cap = parseFloat(String(LOT.cap).replace(",", ".")), ddPct = (+LOT.dd || 20) / 100;
    const u = trades.map((t) => t.net / (t.vol / 0.01)); // risultato di ogni operazione se fosse stata di 0,01 lotti
    const worstU = Math.min(...u), vols = trades.map((t) => t.vol).sort((a, b) => a - b);
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    const days = new Set(trades.map((t) => Math.floor(t.ct / 86400000))).size, du = dailySeries(trades, (t) => t.net / (t.vol / 0.01), false);
    const N = 21, rand = rng(4242), fin = [], dds = []; // un periodo = circa 21 giorni di mercato
    for (let r = 0; r < 1200; r++) { let cum = 0, peak = 0, dd = 0; for (let i = 0; i < N; i++) { cum += du[Math.floor(rand() * du.length)]; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; } fin.push(cum); dds.push(dd); }
    fin.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    const dd1 = Math.max(q(dds, 0.95), 0.01), med1 = q(fin, 0.5), p101 = q(fin, 0.1), w1 = Math.abs(worstU);
    const typ = q(vols, 0.5), high = q(vols, 0.9), lf = (x) => num(x, 2);
    const rows = (lots) => lots.map((L) => {
      const k = L / 0.01, dd = dd1 * k, wr = w1 * k, okDd = cap > 0 ? dd <= ddPct * cap : null, okTr = cap > 0 ? wr <= 0.05 * cap : null;
      const tone = cap > 0 ? (okDd && okTr ? "green" : okDd || okTr ? "amber" : "red") : "";
      return `<div class="sigrow"><div class="sr1"><b>${lf(L)} lotti</b><span class="pill ${tone}" style="margin-left:auto">${cap > 0 ? (okDd && okTr ? "dentro i limiti" : okDd || okTr ? "al limite" : "troppo grande") : ""}</span></div>
        <div class="sr2"><span>Calo massimo in un periodo (95%) <b>${num(dd, 0)}</b>${cap > 0 ? ` (${pct(dd / cap)})` : ""}</span><span>Perdita peggiore vista su una operazione <b>${num(wr, 0)}</b>${cap > 0 ? ` (${pct(wr / cap)})` : ""}</span><span>Risultato mediano del periodo <b class="${cls(med1 * k)}">${sg(med1 * k)}</b></span></div></div>`;
    }).join("");
    const base = [0.01, 0.02, 0.03, 0.05, 0.1];
    if (!(cap > 0)) {
      el.innerHTML = `<p class="small">Scrivi qui sopra quanti soldi <b>tuoi</b> hai sul conto (senza credito o bonus del broker) e ti dico quale lotto è coerente con come operi. Intanto, sui tuoi risultati passati:</p>`
        + `<p class="small">Il tuo lotto abituale è <b>${lf(typ)}</b> (metà delle operazioni fino a ${lf(typ)}, il 90% fino a ${lf(high)}). Ogni 0,01 lotti, in un periodo di ${N} giorni di mercato, hanno dato un calo massimo di <b>${num(dd1, 0)}</b> (95% dei casi) e la peggiore operazione ha perso <b>${num(w1, 0)}</b>.</p>` + rows(base);
      return;
    }
    const lotDD = Math.floor((ddPct * cap) / dd1), lotTr = Math.floor((0.05 * cap) / w1), recU = Math.max(1, Math.min(lotDD, lotTr)), rec = recU * 0.01;
    const bind = lotTr < lotDD ? "la perdita di una singola operazione (non più del 5% del capitale)" : "il calo massimo che accetti nel periodo";
    const set = [...new Set([...base, rec, Math.round(typ * 100) / 100].map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
    const tk = typ / 0.01, ddT = dd1 * tk, wT = w1 * tk;
    el.innerHTML = `<div class="stat" style="margin-bottom:10px"><span>Lotto consigliato</span><b class="g">${lf(rec)}</b></div>`
      + `<p class="small">Con <b>${num(cap, 0)}</b> di capitale, accettando un calo massimo del <b>${pct(ddPct)}</b> (${num(ddPct * cap, 0)}) e una perdita su singola operazione non oltre il <b>5%</b> (${num(0.05 * cap, 0)}), in base a come hai operato finora il lotto massimo coerente è <b>${lf(rec)}</b>. A pesare di più è ${bind}.</p>`
      + `<p class="small">Tu usi di solito <b>${lf(typ)}</b> (metà delle operazioni fino a ${lf(typ)}, il 90% fino a ${lf(high)}): con quel lotto il calo massimo atteso in un periodo (95% dei casi) è <b>${num(ddT, 0)}</b> (${pct(ddT / cap)}), e un'operazione andata male come la peggiore vista varrebbe <b>${num(wT, 0)}</b> (${pct(wT / cap)} del capitale).</p>`
      + rows(set)
      + `<p class="muted small">Calcolo sui tuoi ${trades.length} risultati passati (${days} giorni), rapportati a ogni 0,01 lotti: i numeri crescono in proporzione al lotto. Non è un consiglio finanziario. Se spesso tieni aperte posizioni senza stop, la perdita vera può essere più grande di quella vista. Controlla anche il margine richiesto dal broker: con lotti grandi e poco capitale il margine libero si consuma in fretta. Il credito o bonus non è tuo capitale: non contarlo.</p>`;
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
    cv._hit = (x) => { const i = Math.floor((x - ml) / bw), it = items[i]; if (!it || x > w - mr) return null; return `<b>${it.t}</b><br>Risultato: <b class="${cls(it.v)}">${sg(it.v)}</b>` + (it.d ? "<br>" + it.d : ""); };
  }

  /* ---------- schermata ---------- */
  function render() {
    updateCount();
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
      ? box("Risultato netto", sg(s.net), cls(s.net)) + box("Dopo tasse (26%)", sg(afterTax(s.net)), cls(afterTax(s.net))) + box("Operazioni", s.n) + box("Vinte", pct(s.win)) +
        box("Profit factor", s.pf == null ? "–" : s.pf === Infinity ? "∞" : num(s.pf)) + box("Media vincita", sg(s.avgW || 0), "g") + box("Media perdita", num(s.avgL || 0), "r") +
        box("Migliore", sg(s.best), cls(s.best)) + box("Peggiore", num(s.worst), cls(s.worst)) + box("Media a operazione", sg(s.exp), cls(s.exp)) +
        box("Durata media", fdur(s.dur)) + box("Commissioni + swap", num(s.cost), cls(s.cost))
      : '<p class="muted">Nessuna operazione in questo periodo.</p>';
    document.querySelector("#opTaxNote").textContent = s.n ? (s.net > 0 ? `Tasse stimate: ${num(s.net - afterTax(s.net))} (26% del guadagno netto del periodo). ` : "Periodo in perdita: nessuna tassa stimata. ") + "È una stima indicativa: la tassazione vera dipende dalla tua situazione (per esempio dalla compensazione delle perdite)." : "";
    extra(L);
    // curva
    let run = 0; const curve = L.map((t) => ({ v: (run += t.net), t: dd(t.ct) + " " + hm(t.ct), d: t.kind === "adj" ? "Swap del periodo (da totale del conto)" : `${t.dir === "buy" ? "BUY" : "SHORT"}${t.vol != null ? " " + num(t.vol) + " lotti" : ""} su ${esc(t.sym)}: <b class="${cls(t.net)}">${sg(t.net)}</b><br>Apertura ${num(t.op)} · chiusura ${num(t.cp)}${t.src === "video" ? "<br><span class=\"muted\">dato provvisorio da video</span>" : ""}` }));
    lineChart("#cvOpEq", curve);
    // per giorno
    const byDay = new Map(); L.forEach((t) => { const k = Math.floor(t.ct / 86400000), o = byDay.get(k) || { v: 0, n: 0, w: 0, b: -1e9, wo: 1e9 }; o.v += t.net; if (!t.kind) { o.n++; if (t.net > 0) o.w++; o.b = Math.max(o.b, t.net); o.wo = Math.min(o.wo, t.net); } byDay.set(k, o); });
    barChart("#cvOpDay", [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([k, o]) => ({ v: o.v, t: dd(k * 86400000), d: o.n ? `${o.n} operazioni · vinte ${pct(o.w / o.n)}<br>Migliore ${sg(o.b)} · peggiore ${num(o.wo)}` : "" })));
    // giorno della settimana e ora
    const dstr = (l) => (l.length ? `${l.length} operazioni · vinte ${pct(l.filter((t) => t.net > 0).length / l.length)} · media ${sg(l.reduce((a, t) => a + t.net, 0) / l.length)}` : "nessuna operazione");
    const wd = [1, 2, 3, 4, 5].map((d) => { const l = L.filter((t) => !t.kind && new Date(t.ct).getUTCDay() === d); return { t: GIORNI[d], v: l.reduce((a, t) => a + t.net, 0), d: dstr(l) }; });
    barChart("#cvOpWd", wd);
    const hrs = Array.from({ length: 24 }, (_, hh) => { const l = L.filter((t) => !t.kind && new Date(t.ot).getUTCHours() === hh); return { t: String(hh) + ":00", v: l.reduce((a, t) => a + t.net, 0), d: dstr(l) }; });
    barChart("#cvOpHr", hrs);
    // buy vs short
    document.querySelector("#opDir").innerHTML = ["buy", "sell"].map((d) => {
      const x = stats(L.filter((t) => t.dir === d));
      return `<div class="sigrow"><div class="sr1"><b class="dir ${d}">${d === "buy" ? "BUY" : "SHORT"}</b><span>${x.n} operazioni</span><span class="when ${cls(x.net)}">${x.n ? sg(x.net) : "–"}</span></div>${x.n ? `<div class="sr2"><span>Vinte <b>${pct(x.win)}</b></span><span>Media <b>${sg(x.exp)}</b></span><span>Durata <b>${fdur(x.dur)}</b></span></div>` : ""}</div>`;
    }).join("");
    // confronto periodi
    document.querySelector("#opPeriods").innerHTML = starts.map((st) => {
      const x = stats(pool.filter((t) => periodStart(t.ct) === st));
      return `<div class="sigrow"><div class="sr1"><b>${periodLabel(st)}</b><span class="when ${cls(x.net)}" style="font-weight:700">${sg(x.net)}</span></div><div class="sr2"><span>Dopo tasse <b>${sg(afterTax(x.net))}</b></span><span>Operazioni <b>${x.n}</b></span><span>Vinte <b>${pct(x.win)}</b></span><span>Profit factor <b>${x.pf == null ? "–" : x.pf === Infinity ? "∞" : num(x.pf)}</b></span></div></div>`;
    }).join("");
    projection(pool);
    lotAdvice(pool);
    barChart("#cvOpPer", [...starts].reverse().map((st) => { const x = stats(pool.filter((t) => periodStart(t.ct) === st)); return { t: periodLabel(st), v: x.net, d: `${x.n} operazioni · vinte ${pct(x.win)}<br>Dopo tasse ${sg(afterTax(x.net))}` }; }));
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
  function horizonMonths() {
    if (view.horizon === "custom") { const el = document.querySelector("#opProjYears"), y = Math.max(1, Math.min(40, Math.round(+(el && el.value) || 10))); return y * 12; }
    return +view.horizon || 1;
  }
  function buildProjSeg() {
    const el = document.querySelector("#opProjSeg"); if (!el || typeof seg !== "function") return;
    seg(el, [{ label: "Mensile", value: "1" }, { label: "Trimestrale", value: "3" }, { label: "Annuale", value: "12" }, { label: "3 anni", value: "36" }, { label: "5 anni", value: "60" }, { label: "Scegli…", value: "custom" }], view.horizon || "1", (v) => { view.horizon = v; buildProjSeg(); render(); });
    const box = document.querySelector("#opProjYearsBox"); if (box) box.hidden = view.horizon !== "custom";
  }
  function init() {
    const f = document.querySelector("#opFile"); if (!f) return;
    buildProjSeg();
    const yrs = document.querySelector("#opProjYears"); if (yrs) yrs.oninput = () => { if (yrs.value !== "" && (+yrs.value < 1 || +yrs.value > 40)) yrs.value = Math.max(1, Math.min(40, +yrs.value)); render(); };
    const capEl = document.querySelector("#opCap"), ddEl = document.querySelector("#opDdLim");
    if (capEl) capEl.oninput = () => { LOT.cap = capEl.value; saveLot(); render(); };
    if (ddEl) ddEl.onchange = () => { LOT.dd = ddEl.value; saveLot(); render(); };
    f.onchange = async () => {
      for (const file of f.files) { try { importText(decode(await file.arrayBuffer())); } catch (e) { msg("Non riesco a leggere il file: " + e.message, true); } }
      f.value = "";
    };
    document.querySelector("#opPasteBtn").onclick = () => { const b = document.querySelector("#opPasteBox"); b.hidden = !b.hidden; };
    document.querySelector("#opImport").onclick = () => { const t = document.querySelector("#opText").value; if (t.trim()) { importText(t); document.querySelector("#opText").value = ""; document.querySelector("#opPasteBox").hidden = true; } };
    document.querySelector("#opPeriod").onchange = (e) => { view.period = e.target.value; view.touched = true; render(); };
    document.querySelector("#opSym").onchange = (e) => { view.sym = e.target.value; render(); };
    document.querySelector("#opClear").onclick = () => { if (confirm("Cancello tutte le operazioni salvate su questo telefono?")) { T = []; save(); view = { period: "all", sym: "all", horizon: "1" }; msg("Dati cancellati."); render(); } };
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
