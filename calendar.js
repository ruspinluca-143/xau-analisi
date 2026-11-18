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
  const OPEN = new Set(); // eventi con gli scenari aperti (restano aperti al ricaricamento della lista)
  /* Cosa può succedere all'oro: regole generali sul rapporto tra dollaro, tassi e oro. NON sono percentuali né previsioni. */
  function scenario(e) {
    const t = e.title, usd = e.country === "USD", fc = e.forecast ? " (previsto " + esc(e.forecast) + ")" : "";
    let kind = "altro";
    if (/Federal Funds Rate|Interest Rate|Bank Rate|Refinancing|Cash Rate|Policy Rate/i.test(t)) kind = "tassi";
    else if (/Minutes/i.test(t)) kind = "verbali";
    else if (/Speaks|Testifies|Press Conference|Statement|Speech/i.test(t)) kind = "discorso";
    else if (/CPI|PCE|PPI|Inflation/i.test(t)) kind = "inflazione";
    else if (/Unemployment|Jobless/i.test(t)) kind = "disoccupazione";
    else if (/Employment|Payroll|JOLTS|Earnings/i.test(t)) kind = "lavoro";
    else if (/Retail Sales|GDP|PMI|ISM|Industrial|Trade Balance|Confidence|Sales/i.test(t)) kind = "attivita";
    const S3 = {
      inflazione: ["Inflazione più alta del previsto" + fc, "La Fed ha meno spazio per tagliare i tassi, o può alzarli: dollaro e rendimenti tendono a salire e l'oro, di solito, a scendere nei minuti dopo.", "In linea", "Poca sorpresa: il movimento è spesso piccolo, oppure breve e in entrambe le direzioni.", "Inflazione più bassa del previsto", "La Fed può essere più morbida: dollaro e rendimenti scendono e l'oro, di solito, sale."],
      lavoro: ["Più occupati del previsto" + fc, "Economia forte: i tassi restano alti più a lungo, il dollaro tende a salire e l'oro a scendere.", "In linea", "Poca sorpresa; contano anche le revisioni dei mesi precedenti e i salari.", "Meno occupati del previsto", "Economia più debole: si parla di tagli, dollaro giù e oro di solito su."],
      disoccupazione: ["Disoccupazione più alta del previsto" + fc + " (lavoro più debole)", "Si parla più di tagli dei tassi: dollaro giù e oro di solito su.", "In linea", "Poca sorpresa.", "Disoccupazione più bassa del previsto (lavoro più forte)", "Tassi alti più a lungo: dollaro su e oro di solito giù."],
      tassi: ["Più restrittiva del previsto (rialzo o nessun taglio atteso)" + fc, "Dollaro e rendimenti su, oro di solito giù.", "In linea con le attese", "Conta il tono di comunicato e conferenza stampa: duro = oro giù, morbido = oro su. Spesso movimenti a scatti.", "Più morbida del previsto (taglio più grande)", "Dollaro e rendimenti giù, oro di solito su."],
      verbali: ["Toni da falco (si parla di rialzi o tassi alti a lungo)", "Dollaro su, oro di solito giù. Sono verbali di una riunione già nota: muovono meno di una decisione.", "Toni neutri", "Poca reazione.", "Toni da colomba (si parla di tagli)", "Dollaro giù, oro di solito su."],
      discorso: ["Tono da falco (tassi alti, inflazione ancora preoccupante)", "Dollaro su, oro di solito giù.", "Tono neutro", "Poca reazione, ma le singole frasi possono dare scatti in entrambe le direzioni.", "Tono da colomba (aperto ai tagli)", "Dollaro giù, oro di solito su."],
      attivita: ["Dato più forte del previsto" + fc, "Economia più forte: dollaro su e oro di solito un po' giù.", "In linea", "Poca sorpresa.", "Dato più debole del previsto", "Dollaro giù e oro di solito su (a volte per paura di recessione l'oro sale ancora di più)."],
      altro: ["Sopra le attese" + fc, "Dipende da cosa misura: se rafforza il dollaro o i rendimenti l'oro tende a scendere.", "In linea", "Poca sorpresa.", "Sotto le attese", "Se indebolisce il dollaro o i rendimenti l'oro tende a salire."],
    }[kind];
    let h = usd ? "" : `<div class="sc"><b>Evento in altra valuta (${esc(e.country)})</b>L'effetto sull'oro è indiretto: passa dal dollaro e dai tassi mondiali, di solito più piccolo. Un dato forte su quella valuta può indebolire un po' il dollaro (oro su) e uno debole il contrario.</div>`;
    h += [0, 2, 4].map((i) => `<div class="sc"><b>${S3[i]}</b>${S3[i + 1]}</div>`).join("");
    h += `<div class="sc" style="color:var(--muted)">Sono regole generali sul rapporto tra dollaro, tassi e oro, non percentuali né previsioni: spesso il mercato ha già scontato il dato e può muoversi al contrario o a scatti nei primi minuti. Aspetta che la volatilità si calmi prima di valutare.${kind === "tassi" || kind === "inflazione" ? " Guarda anche cosa scommette il mercato sui tassi, nel riquadro qui sotto." : ""}</div>`;
    return h;
  }
  let EV = null, last = 0, err = "";
  function render() {
    const box = document.querySelector("#calList"); if (!box) return;
    if (EV === null) { box.innerHTML = `<p class="muted">${err || "Carico gli eventi…"}</p>`; return; }
    const now = Date.now(), up = EV.filter((e) => e.ts * 1000 > now - 90 * 60000); // tengo anche quelli di poco fa
    if (!up.length) { box.innerHTML = '<p class="muted">Nessun evento ad alto impatto nei prossimi giorni.</p>'; return; }
    const nxt = up.find((e) => e.ts * 1000 > now);
    let h = nxt ? `<div class="calnext"><span>Prossimo evento</span><b>${esc(itTitle(nxt.title))}</b><span>${nxt.country} · ${dayName(nxt.ts * 1000)}, ore ${hhmm(nxt.ts * 1000)} (${left(nxt.ts * 1000)})</span></div>` : "";
    let cur = "";
    up.forEach((e, ix) => {
      const ms = e.ts * 1000, k = key(ms), today = key(now) === k, tomorrow = key(now + 86400000) === k;
      if (k !== cur) { cur = k; h += `<div class="calday">${today ? "Oggi" : tomorrow ? "Domani" : ""}${today || tomorrow ? " · " : ""}${dayName(ms)}</div>`; }
      const past = ms < now, usd = e.country === "USD";
      h += `<div class="calrow${past ? " past" : ""}" data-i="${ix}"><span class="ct">${hhmm(ms)}</span><span class="cc${usd ? " usd" : ""}">${esc(e.country)}</span><span class="cn">${esc(itTitle(e.title))}${past ? ' <i>(già uscito)</i>' : ""}</span>${e.forecast || e.previous ? `<span class="cf">${e.forecast ? "previsto " + esc(e.forecast) : ""}${e.forecast && e.previous ? " · " : ""}${e.previous ? "prima " + esc(e.previous) : ""}</span>` : ""}</div>`;
    });
    box.innerHTML = h;
    box.querySelectorAll(".calrow").forEach((r) => {
      const e = up[+r.dataset.i], k = e.ts + "|" + e.title;
      const open = () => { const w = document.createElement("div"); w.className = "calwhy"; w.innerHTML = scenario(e); r.appendChild(w); OPEN.add(k); };
      if (OPEN.has(k)) open();
      r.onclick = () => { const w = r.querySelector(".calwhy"); if (w) { w.remove(); OPEN.delete(k); } else open(); };
    });
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

  /* ---------- aspettative del mercato sui tassi (Polymarket) ---------- */
  async function loadPm() {
    const box = document.querySelector("#pmList"); if (!box) return;
    try {
      const r = await fetch("/api/polymarket", { cache: "no-store" }), j = await r.json();
      if (!r.ok) throw new Error(j.error || "errore");
      let h = "";
      j.meetings.forEach((m) => {
        const top = Math.max(...m.options.map((o) => o.p));
        h += `<div class="pmhead">${esc(m.title)} · ${new Date(m.end * 1000).toLocaleDateString("it-IT", { day: "numeric", month: "long", timeZone: TZ })}</div>`;
        m.options.forEach((o) => { h += `<div class="pmrow"><div class="pl"><span>${esc(o.label)}</span><b${o.p === top ? ' style="color:var(--green)"' : ""}>${(o.p * 100).toFixed(o.p < 0.1 ? 1 : 0).replace(".", ",")}%</b></div><div class="bar"><i style="width:${Math.max(1, o.p * 100)}%"></i></div></div>`; });
      });
      box.innerHTML = h;
      const u = document.querySelector("#pmUpd"); if (u) u.textContent = "Aggiornato alle " + hhmm(j.updated * 1000) + " · fonte: Polymarket (mercato di previsione)";
    } catch (e) { box.innerHTML = `<p class="muted">Non riesco a leggere Polymarket adesso (${esc(e.message)}).</p>`; }
  }
  if (document.querySelector("#pmList")) {
    loadPm();
    new MutationObserver(() => { if (document.body.dataset.tab === "avvisi") loadPm(); }).observe(document.body, { attributes: true, attributeFilter: ["data-tab"] });
    setInterval(loadPm, 10 * 60000);
  }
})();
