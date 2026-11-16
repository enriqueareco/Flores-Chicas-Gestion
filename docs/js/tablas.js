"use strict";
/* ============ Teléfono: las tablas que no entran a lo ancho se muestran como tarjetas ============
   Cada celda toma como etiqueta el título de su columna. Se revisa cada vez que cambia una página,
   la ficha del mapa o una ventana, así no hace falta tocar cada pantalla. */
const Tablas = {
  movil: () => matchMedia("(max-width:820px)").matches,
  etiquetar(t) {
    const filas = [...t.rows];
    const cab = filas.find((r) => r.querySelector("th") && !r.querySelector("td"));
    const nombres = []; if (cab) { cab.classList.add("cab"); for (const c of cab.cells) for (let k = 0; k < (c.colSpan || 1); k++) nombres.push(c.textContent.trim()); }
    for (const r of filas) {
      if (r === cab) continue; let i = 0, conSel = false;
      for (const c of r.cells) {
        const span = c.colSpan || 1; const n = nombres[i] || ""; i += span;
        const txt = c.textContent.trim();
        const campos = c.querySelector("input:not([type=checkbox]),select,textarea");
        if (!txt && !campos && c.querySelector("input[type=checkbox],.tgl")) { c.classList.add("sel"); conSel = true; continue; }
        if (!txt && !campos && !c.querySelector("button,img,svg,.amb-sw")) { c.classList.add("vacio"); continue; }
        if (n && !c.hasAttribute("data-l")) c.setAttribute("data-l", n);
        if (span > 1 || txt.length > 24) c.classList.add("ancho");
      }
      r.classList.toggle("con-sel", conSel);
      if (r.cells.length === 1) r.classList.add("total");
    }
  },
  ajustar(raiz) {
    if (!raiz) return; const movil = this.movil();
    for (const t of raiz.querySelectorAll("table.t")) {
      if (!movil) { t.classList.remove("cards"); continue; }
      const cont = t.closest(".tablewrap") || t.parentElement; if (!cont || !cont.clientWidth) continue;
      const antes = t.classList.contains("cards"); t.classList.remove("cards");
      if (t.offsetWidth > cont.clientWidth + 2 || t.scrollWidth > cont.clientWidth + 2) { this.etiquetar(t); t.classList.add("cards"); }
      else if (antes) t.classList.remove("cards");
    }
  },
  pendientes: new Set(), cuadro: 0,
  pedir(raiz) { this.pendientes.add(raiz); if (!this.cuadro) this.cuadro = requestAnimationFrame(() => { this.cuadro = 0; const rs = [...this.pendientes]; this.pendientes.clear(); rs.forEach((x) => x.isConnected && this.ajustar(x)); }); },
  observar(raiz) {
    new MutationObserver((ms) => { if (ms.some((m) => !m.target.closest?.(".leaflet-container"))) this.pedir(raiz); }).observe(raiz, { childList: true, subtree: true });
    this.pedir(raiz);
  },
  iniciar() {
    document.querySelectorAll("main .view.page").forEach((v) => this.observar(v));
    const pn = document.getElementById("panel"); if (pn) this.observar(pn);
    /* Ventanas: se agregan al body */
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.classList.contains("modal-bg") || n.id === "chat")) this.observar(n); }).observe(document.body, { childList: true });
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => document.querySelectorAll("main .view:not([hidden]), .modal-bg, #chat").forEach((x) => this.ajustar(x)), 150); });
    /* Al cambiar de pantalla, la que aparece se mide de nuevo (oculta no se puede medir) */
    window.addEventListener("hashchange", () => setTimeout(() => document.querySelectorAll("main .view:not([hidden])").forEach((x) => this.ajustar(x)), 0));
  },
};
Tablas.iniciar();
