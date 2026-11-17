/* Notizie importanti in arrivo: solo gli eventi "rossi" (impatto alto) che muovono i mercati: tassi, inflazione, lavoro USA, discorsi delle banche centrali.
   I dati arrivano dal server (/api/calendar, calendario pubblico gratuito). Gli orari sono in ora italiana. */
(function () {
  const RULES = [
    [/Non-Farm Employment Change/i, "Occupati non agricoli USA (NFP)"], [/Average Hourly Earnings/i, "Salari orari medi"], [/Unemployment Rate/i, "Tasso di disoccupazione"],
    [/Federal Funds Rate/i, "Decisione sui tassi della Fed"], [/FOMC Statement/i, "Comunicato della Fed (FOMC)"], [/FOMC Press Conference/i, "Conferenza stampa della Fed"],
    [/FOMC Meeting Minutes/i, "Verbali della riunione Fed (FOMC)"], [/FOMC Member (.+) Speaks/i, "Discorso di un membro Fed ($1)"], [/Fed Chair(?:man|woman)? (.+) Speaks/i, "Discorso del presidente della Fed ($1)"],
    [/Fed Chair(?:man|woman)?.*Testifies/i, "Audizione del presidente della Fed"], [/Core CPI (?:m\/m|MoM)/i, "Inflazione core (CPI) mensile"], [/Core CPI (?:y\/y|YoY)/i, "Inflazione core (CPI) annua"],
    [/Median CPI (?:y\/y|YoY)/i, "Inflazione mediana (CPI) annua"], [/Trimmed CPI (?:y\/y|YoY)/i, "Inflazione depurata (CPI) annua"], [/CPI (?:m\/m|MoM)/i, "Inflazione (CPI) mensile"], [/CPI (?:y\/y|YoY)/i, "Inflazione (CPI) annua"],
    [/Core PCE Price Index/i, "Inflazione PCE core (la preferita dalla Fed)"], [/Core Retail Sales/i, "Vendite al dettaglio core"], [/Retail Sales/i, "Vendite al dettaglio"],
    [/Core PPI/i, "Prezzi alla produzione core (PPI)"], [/PPI (?:m\/m|MoM)/i, "Prezzi alla produzione (PPI)"], [/Advance GDP (?:q\/q|QoQ)|Prelim GDP (?:q\/q|QoQ)|GDP (?:q\/q|QoQ)/i, "PIL trimestrale"], [/ISM Manufacturing PMI/i, "Indice ISM manifatturiero"],
    [/ISM Services PMI/i, "Indice ISM servizi"], [/ADP Non-Farm Employment Change/i, "Occupati privati ADP"], [/JOLTS Job Openings/i, "Posti di lavoro vacanti (JOLTS)"],
    [/Official Bank Rate/i, "Decisione sui tassi della Banca d'Inghilterra"], [/Main Refinancing Rate/i, "Decisione sui tassi della BCE"], [/ECB President (.+) Speaks/i, "Discorso della presidente BCE ($1)"],
    [/ECB Press Conference/i, "Conferenza stampa della BCE"], [/BOE Gov (.+) Speaks/i, "Discorso del governatore BoE ($1)"], [/RBA Gov (.+) Speaks/i, "Discorso del governatore RBA ($1)"],
    [/Cash Rate/i, "Decisione sui tassi della RBA (Australia)"], [/BOJ Policy Rate|Monetary Policy Statement/i, "Decisione sui tassi (banca centrale)"], [/Employment Change/i, "Variazione occupati"],
    [/Non Farm Payrolls/i, "Occupati non agricoli USA (NFP)"], [/Interest Rate Decision/i, "Decisione sui tassi di interesse"], [/Inflation Rate/i, "Inflazione"], [/Core Inflation/i, "Inflazione core"],
    [/Fed Interest Rate/i, "Decisione sui tassi della Fed"], [/Fed Press Conference/i, "Conferenza stampa della Fed"], [/Initial Jobless Claims/i, "Richieste di sussidio di disoccupazione"],
    [/Consumer Confidence/i, "Fiducia dei consumatori"], [/Core PCE/i, "Inflazione PCE core (la preferita dalla Fed)"], [/Industrial Production/i, "Produzione industriale"],
    [/Inflation Expectations/i, "Aspettative di inflazione"], [/Trade Balance/i, "Bilancia commerciale"], [/Flash Manufacturing PMI/i, "PMI manifatturiero flash"], [/Flash Services PMI/i, "PMI servizi flash"],
  ];
  const itTitle = (t) => { for (const [re, out] of RULES) { const m = t.match(re); if (m) return out.replace(/\$(\d)/g, (_, i) => m[+i] || "") + " · " + t; } return t; };
  const TZ = "Europe/Rome", key = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
  const hhmm = (ms) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const dayName = (ms) => new Date(ms).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  const left = (ms) => { const m = Math.round((ms - Date.now()) / 60000); if (m < 1) return "adesso"; if (m < 60) return "tra " + m + " min"; const h = Math.floor(m / 60); return h < 48 ? "tra " + h + " h " + (m % 60 ? (m % 60) + " min" : "") : "tra " + Math.round(h / 24) + " giorni"; };
  let EV = null, last = 0, err = "";
  function render() {
    const box = document.querySelector("#calList"); if (!box) return;
    if (EV === null) { box.innerHTML = `<p class="muted">${err || "Carico gli eventi…"}</p>`; return; }
    const now = Date.now(), up = EV.filter((e) => e.ts * 1000 > now - 90 * 60000); // tengo anche quelli di poco fa
    if (!up.length) { box.innerHTML = '<p class="muted">Nessun evento ad alto impatto nei prossimi giorni.</p>'; return; }
    const nxt = up.find((e) => e.ts * 1000 > now);
    let h = nxt ? `<div class="calnext"><span>Prossimo evento</span><b>${esc(itTitle(nxt.title))}</b><span>${nxt.country} · ${dayName(nxt.ts * 1000)}, ore ${hhmm(nxt.ts * 1000)} (${left(nxt.ts * 1000)})</span></div>` : "";
    let cur = "";
    up.forEach((e) => {
      const ms = e.ts * 1000, k = key(ms), today = key(now) === k, tomorrow = key(now + 86400000) === k;
      if (k !== cur) { cur = k; h += `<div class="calday">${today ? "Oggi" : tomorrow ? "Domani" : ""}${today || tomorrow ? " · " : ""}${dayName(ms)}</div>`; }
      const past = ms < now, usd = e.country === "USD";
      h += `<div class="calrow${past ? " past" : ""}"><span class="ct">${hhmm(ms)}</span><span class="cc${usd ? " usd" : ""}">${esc(e.country)}</span><span class="cn">${esc(itTitle(e.title))}${past ? ' <i>(già uscito)</i>' : ""}</span>${e.forecast || e.previous ? `<span class="cf">${e.forecast ? "previsto " + esc(e.forecast) : ""}${e.forecast && e.previous ? " · " : ""}${e.previous ? "prima " + esc(e.previous) : ""}</span>` : ""}</div>`;
    });
    box.innerHTML = h;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function load(force) {
    if (!force && EV && Date.now() - last < 10 * 60000) return render();
    try {
      const r = await fetch("/api/calendar", { cache: "no-store" }), j = await r.json();
      if (!r.ok) throw new Error(j.error || "errore");
      EV = j.events || []; last = Date.now(); err = "";
      const u = document.querySelector("#calUpd"); if (u) u.textContent = "Aggiornato alle " + hhmm(j.updated ? j.updated * 1000 : Date.now()) + " · " + (j.source || "");
    } catch (e) { err = "Non riesco a leggere il calendario adesso (" + e.message + ")."; }
    render();
  }
  if (document.querySelector("#calList")) {
    load();
    new MutationObserver(() => { if (document.body.dataset.tab === "avvisi") load(); }).observe(document.body, { attributes: true, attributeFilter: ["data-tab"] });
    setInterval(render, 60000);
  }
})();
