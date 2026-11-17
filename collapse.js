/* Ogni riquadro (card) si può chiudere toccando il suo titolo e RESTA chiuso anche dopo aver chiuso e riaperto l'app.
   Lo stato è salvato sul telefono; l'identificativo è schermata + posizione del riquadro (non dipende dal testo del titolo). */
(function () {
  const KEY = "xau_collapsed_v2";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { saved = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* senza: funziona uguale */ } };
  function setup(card, id) {
    const h = card.querySelector(":scope > h3, :scope > .row > h3, :scope > .dc-head > h3");
    if (!h) return;
    const head = h.parentElement === card ? h : h.parentElement;
    if (head.dataset.coll) return;
    head.dataset.coll = "1"; head.classList.add("collhead");
    h.classList.add("colltitle"); h.setAttribute("role", "button"); h.tabIndex = 0;
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
  document.querySelectorAll(".tab").forEach((tab) => tab.querySelectorAll(".card").forEach((card, i) => setup(card, tab.id + "#" + i)));
  // alla riapertura i grafici dei riquadri chiusi non hanno larghezza: li ridisegno appena possibile
  setTimeout(() => window.dispatchEvent(new Event("resize")), 400);
})();
