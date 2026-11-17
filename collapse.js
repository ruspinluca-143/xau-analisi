/* Ogni riquadro (card) si può chiudere toccando il suo titolo: così occupa meno spazio. Lo stato resta salvato sul telefono. */
(function () {
  const KEY = "xau_collapsed";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { saved = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* senza: funziona uguale */ } };
  function setup(card) {
    const h = card.querySelector(":scope > h3, :scope > .row > h3, :scope > .dc-head > h3");
    if (!h) return;
    const head = h.parentElement === card ? h : h.parentElement;
    if (head.dataset.coll) return;
    head.dataset.coll = "1"; head.classList.add("collhead");
    const id = ((card.closest(".tab") || {}).id || "") + "|" + h.textContent.trim().slice(0, 40);
    const chev = document.createElement("span"); chev.className = "chev"; chev.textContent = "▾"; chev.setAttribute("aria-hidden", "true");
    h.appendChild(chev); h.classList.add("colltitle"); h.setAttribute("role", "button"); h.tabIndex = 0;
    const apply = (on) => { card.classList.toggle("collapsed", on); h.setAttribute("aria-expanded", on ? "false" : "true"); };
    apply(!!saved[id]);
    const toggle = () => {
      const on = !card.classList.contains("collapsed"); apply(on);
      if (on) saved[id] = 1; else delete saved[id];
      persist();
      if (!on) setTimeout(() => window.dispatchEvent(new Event("resize")), 30); // i grafici si ridisegnano alla nuova larghezza
    };
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  }
  document.querySelectorAll(".card").forEach(setup);
  // alla riapertura i grafici dei riquadri chiusi non hanno larghezza: li ridisegno appena possibile
  setTimeout(() => window.dispatchEvent(new Event("resize")), 400);
})();
