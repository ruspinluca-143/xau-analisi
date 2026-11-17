/* Dettagli al tocco: toccando un punto di un grafico compare una nota con le informazioni di quel punto.
   Ogni grafico registra una funzione cv._hit(x, y) quando si disegna; qui c'è solo la parte comune (la nota e il tocco). */
(function () {
  let pop = null, down = null;
  const hide = () => { if (pop) { pop.remove(); pop = null; } };
  function show(cv, html, ev) {
    hide();
    const card = cv.closest(".card") || cv.parentElement, cr = card.getBoundingClientRect();
    pop = document.createElement("div"); pop.className = "chartinfo"; pop.innerHTML = html + '<button class="chartinfo-x" aria-label="Chiudi">✕</button>';
    card.appendChild(pop);
    pop.querySelector(".chartinfo-x").onclick = (e) => { e.stopPropagation(); hide(); };
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = ev.clientX - cr.left - pw / 2, top = ev.clientY - cr.top - ph - 14;
    left = Math.max(6, Math.min(cr.width - pw - 6, left));
    if (top < 6) top = ev.clientY - cr.top + 18;
    pop.style.left = left + "px"; pop.style.top = top + "px";
  }
  document.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener("click", (e) => {
    const cv = e.target.closest && e.target.closest("canvas.cv");
    if (!cv) { if (!(e.target.closest && e.target.closest(".chartinfo"))) hide(); return; }
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // era un trascinamento (spostare/ingrandire il grafico)
    if (typeof cv._hit !== "function") return;
    const r = cv.getBoundingClientRect(), html = cv._hit(e.clientX - r.left, e.clientY - r.top);
    if (html) show(cv, html, e); else hide();
  }, true);
  window.addEventListener("resize", hide);
  window.addEventListener("scroll", hide, true);
})();
