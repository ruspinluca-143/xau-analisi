/* Manuale d'uso dentro l'app: il pulsante ? apre il contenuto di manuale.md (un solo testo, aggiornato a ogni modifica).
   Il testo viene costruito con nodi DOM (mai innerHTML): nessun rischio di codice inserito dal file. */
(function () {
  const btn = document.getElementById("manualBtn"), sheet = document.getElementById("manSheet"), body = document.getElementById("manBody");
  const close = document.getElementById("manClose"), search = document.getElementById("manSearch");
  if (!btn || !sheet || !body) return;
  let loaded = false, sections = [];
  const el = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; };
  function inline(parent, text) { // **grassetto** e `codice`
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach((part) => {
      if (!part) return;
      if (part.startsWith("**")) parent.appendChild(el("b", part.slice(2, -2)));
      else if (part.startsWith("`")) parent.appendChild(el("code", part.slice(1, -1)));
      else parent.appendChild(document.createTextNode(part));
    });
  }
  function build(md) {
    body.textContent = ""; sections = [];
    let det = null, ul = null, sub = null, intro = true;
    const target = () => det || body;
    md.split(/\r?\n/).forEach((line) => {
      if (/^# /.test(line)) return; // il titolo è già nella finestra
      const h2 = line.match(/^## (.+)/), h3 = line.match(/^### (.+)/), li = line.match(/^(\s*)- (.+)/);
      if (h2) { det = el("details"); const s = el("summary", h2[1]); det.appendChild(s); body.appendChild(det); sections.push(det); ul = null; intro = false; return; }
      if (h3) { ul = null; target().appendChild(el("h4", h3[1])); return; }
      if (li) {
        const nested = li[1].length > 0;
        if (!ul) { ul = el("ul"); target().appendChild(ul); sub = null; }
        const item = el("li"); inline(item, li[2]);
        if (nested) { if (!sub) { sub = el("ul"); ul.lastElementChild.appendChild(sub); } sub.appendChild(item); } else { ul.appendChild(item); sub = null; }
        return;
      }
      if (!line.trim()) { ul = null; sub = null; return; }
      ul = null; const p = el("p"); inline(p, line); (intro ? body : target()).appendChild(p);
    });
    if (sections[0]) sections[0].open = true; // "Novità" aperta
  }
  function filter() {
    const q = search.value.trim().toLowerCase();
    sections.forEach((d) => { const hit = !q || d.textContent.toLowerCase().includes(q); d.hidden = !hit; d.open = q ? hit : d === sections[0]; });
  }
  async function open() {
    sheet.hidden = false; document.body.style.overflow = "hidden"; close.focus();
    if (loaded) return;
    body.textContent = "Carico il manuale…";
    try {
      const r = await fetch("/manuale.md", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      build(await r.text()); loaded = true;
    } catch (e) { body.textContent = "Non riesco a leggere il manuale adesso (" + e.message + "). Riprova tra poco."; }
  }
  const shut = () => { sheet.hidden = true; document.body.style.overflow = ""; btn.focus(); };
  btn.onclick = open; close.onclick = shut;
  sheet.addEventListener("click", (e) => { if (e.target === sheet) shut(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) shut(); });
  search.addEventListener("input", filter);
})();
