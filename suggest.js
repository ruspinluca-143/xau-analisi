/* Ricerca con suggerimenti: scrivi "T" e ti propone Tesla, "N" Nvidia, e così via. Toccando un suggerimento si apre quello strumento.
   Anche i simboli non in elenco funzionano: basta scrivere il simbolo di Yahoo (per esempio SPY, ^GSPC, EURUSD=X). */
(function () {
  // in ordine di popolarità: a parità di lettera iniziale vince il primo (così "T" propone Tesla e non AT&T, "N" Nvidia)
  const LIST = [
    ["XAUUSD", "Oro"], ["TSLA", "Tesla"], ["NVDA", "Nvidia"], ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["AMZN", "Amazon"], ["GOOGL", "Alphabet (Google)"], ["META", "Meta (Facebook)"],
    ["BTC-USD", "Bitcoin"], ["ETH-USD", "Ethereum"], ["NFLX", "Netflix"], ["AMD", "AMD"], ["INTC", "Intel"], ["PLTR", "Palantir"], ["COIN", "Coinbase"], ["SOL-USD", "Solana"], ["XRP-USD", "XRP (Ripple)"],
    ["AVGO", "Broadcom"], ["DIS", "Disney"], ["NKE", "Nike"], ["KO", "Coca-Cola"], ["MCD", "McDonald's"], ["UBER", "Uber"], ["PYPL", "PayPal"], ["BA", "Boeing"], ["JPM", "JPMorgan Chase"], ["V", "Visa"], ["MA", "Mastercard"],
    ["WMT", "Walmart"], ["COST", "Costco"], ["HD", "Home Depot"], ["XOM", "Exxon Mobil"], ["CVX", "Chevron"], ["LLY", "Eli Lilly"], ["UNH", "UnitedHealth"], ["JNJ", "Johnson & Johnson"], ["PFE", "Pfizer"],
    ["ORCL", "Oracle"], ["CRM", "Salesforce"], ["ADBE", "Adobe"], ["CSCO", "Cisco"], ["IBM", "IBM"], ["QCOM", "Qualcomm"], ["MU", "Micron"], ["TXN", "Texas Instruments"], ["AMAT", "Applied Materials"],
    ["PEP", "PepsiCo"], ["SBUX", "Starbucks"], ["BAC", "Bank of America"], ["GS", "Goldman Sachs"], ["BRK-B", "Berkshire Hathaway"], ["T", "AT&T"], ["TMUS", "T-Mobile US"], ["CMCSA", "Comcast"],
    ["PG", "Procter & Gamble"], ["MRK", "Merck"], ["ABBV", "AbbVie"], ["CAT", "Caterpillar"], ["HON", "Honeywell"], ["ABNB", "Airbnb"], ["BKNG", "Booking Holdings"], ["MAR", "Marriott"],
    ["AMGN", "Amgen"], ["INTU", "Intuit"], ["ISRG", "Intuitive Surgical"], ["GILD", "Gilead Sciences"], ["ADI", "Analog Devices"], ["VRTX", "Vertex Pharmaceuticals"], ["MDLZ", "Mondelez"], ["REGN", "Regeneron"],
    ["LRCX", "Lam Research"], ["PANW", "Palo Alto Networks"], ["ADP", "ADP"], ["KLAC", "KLA"], ["SNPS", "Synopsys"], ["CDNS", "Cadence"], ["CRWD", "CrowdStrike"], ["MELI", "MercadoLibre"], ["CSX", "CSX"],
    ["ORLY", "O'Reilly Automotive"], ["CTAS", "Cintas"], ["MRVL", "Marvell"], ["NXPI", "NXP Semiconductors"], ["FTNT", "Fortinet"], ["PCAR", "Paccar"], ["WDAY", "Workday"], ["ROP", "Roper Technologies"],
    ["MNST", "Monster Beverage"], ["CHTR", "Charter Communications"], ["AEP", "American Electric Power"], ["MCHP", "Microchip"], ["PAYX", "Paychex"], ["ADSK", "Autodesk"], ["EXC", "Exelon"], ["ROST", "Ross Stores"],
    ["IDXX", "Idexx"], ["LULU", "Lululemon"], ["FAST", "Fastenal"], ["DDOG", "Datadog"], ["EA", "Electronic Arts"], ["TEAM", "Atlassian"], ["DXCM", "Dexcom"], ["TTD", "The Trade Desk"], ["ZS", "Zscaler"], ["MDB", "MongoDB"],
    ["BNB-USD", "BNB"], ["DOGE-USD", "Dogecoin"], ["ADA-USD", "Cardano"], ["AVAX-USD", "Avalanche"],
    ["SPY", "ETF S&P 500"], ["QQQ", "ETF Nasdaq 100"], ["GLD", "ETF oro"], ["SLV", "ETF argento"], ["TLT", "ETF titoli di Stato USA a lungo"], ["^GSPC", "Indice S&P 500"], ["^IXIC", "Indice Nasdaq"],
    ["EURUSD=X", "Euro / Dollaro"], ["CL=F", "Petrolio (WTI)"], ["SI=F", "Argento (future)"], ["GC=F", "Oro (future)"], ["DX-Y.NYB", "Indice del dollaro"],
  ];
  window.TICKER_NAMES = Object.fromEntries(LIST);
  const inp = document.querySelector("#symbol");
  if (!inp) return;
  const label = inp.closest("label");
  label.style.position = "relative";
  const box = document.createElement("div");
  box.className = "sugg"; box.hidden = true; label.appendChild(box);
  let cur = [], hi = -1;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function find(q) {
    q = norm(q.trim());
    if (!q) return LIST.slice(0, 8);
    const out = [];
    LIST.forEach(([sym, name], i) => {
      const s = norm(sym), n = norm(name), words = n.split(/[^a-z0-9]+/).filter(Boolean);
      let score = -1;
      if (s.startsWith(q)) score = 0; else if (words.some((w) => w.startsWith(q))) score = 1; else if (n.includes(q) || s.includes(q)) score = 2;
      if (score >= 0) out.push([score, i, sym, name]);
    });
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 8).map((x) => [x[2], x[3]]);
  }
  function show(list) {
    cur = list; hi = list.length ? 0 : -1;
    box.innerHTML = list.map(([s, n], i) => `<button type="button" class="sg${i === hi ? " on" : ""}" data-s="${s}"><b>${n}</b><span>${s}</span></button>`).join("");
    box.hidden = !list.length; inp.setAttribute("aria-expanded", list.length ? "true" : "false");
  }
  function pick(sym) {
    inp.value = sym; box.hidden = true; inp.blur();
    inp.dispatchEvent(new Event("change", { bubbles: true })); // il resto lo fa il gestore già presente: carica lo strumento
  }
  inp.addEventListener("focus", () => { setTimeout(() => { try { inp.select(); } catch (e) { /* senza: si scrive sopra a mano */ } }, 0); show(find("")); });
  inp.addEventListener("input", () => show(find(inp.value)));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!cur.length) return;
      hi = (hi + (e.key === "ArrowDown" ? 1 : cur.length - 1)) % cur.length;
      box.querySelectorAll(".sg").forEach((b, i) => b.classList.toggle("on", i === hi));
    } else if (e.key === "Enter") {
      if (!box.hidden && cur.length && inp.value.trim()) { e.preventDefault(); pick(cur[Math.max(0, hi)][0]); } // "T" + Invio = Tesla
    } else if (e.key === "Escape") { box.hidden = true; }
  });
  box.addEventListener("click", (e) => { const b = e.target.closest(".sg"); if (b && !box.hidden) { e.preventDefault(); pick(b.dataset.s); } }); // anche da tastiera (Invio su un suggerimento)
  inp.setAttribute("role", "combobox"); inp.setAttribute("aria-autocomplete", "list"); inp.setAttribute("aria-expanded", "false"); inp.setAttribute("aria-controls", "symSugg"); box.id = "symSugg"; box.setAttribute("role", "listbox");
  box.addEventListener("pointerdown", (e) => { // pointerdown: scatta prima che il campo perda il focus
    const b = e.target.closest(".sg"); if (!b) return; e.preventDefault(); pick(b.dataset.s);
  });
  inp.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
})();
