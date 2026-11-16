"use strict";
/* ============ Teléfono: la ficha del mapa como hoja que se arrastra desde abajo ============
   Tres posiciones: cerrada (solo el título, mapa completo), media y abierta.
   Se arrastra desde la agarradera o desde el contenido (hacia arriba si no está abierta,
   hacia abajo si el contenido está arriba de todo). */
const Hoja = {
  el: null, panel: null, vista: null, estado: "cerrado", y: 0, previo: null, PEEK: 66,
  movil: () => matchMedia("(max-width:820px)").matches,
  alto() { return this.el.clientHeight; },
  posiciones() { const H = this.alto(); return { abierto: 0, medio: Math.round(H * 0.44), cerrado: Math.max(0, H - this.PEEK) }; },
  aplicar(y) {
    this.y = y; this.el.style.transform = `translateY(${y}px)`;
    const vis = Math.max(0, this.alto() - y); this.vista.style.setProperty("--hoja-vis", vis + "px");
    /* Con la hoja a media altura, el final del contenido igual se puede alcanzar */
    this.panel.style.paddingBottom = y + "px";
  },
  set(estado, animar = true) {
    if (!this.el) return; this.estado = estado;
    if (!this.movil()) { this.el.style.transform = ""; this.panel.style.paddingBottom = ""; return; }
    this.el.classList.toggle("anim", animar);
    this.el.classList.toggle("h-cerrado", estado === "cerrado"); this.el.classList.toggle("h-abierto", estado === "abierto");
    this.aplicar(this.posiciones()[estado]);
    this.el.querySelector(".agarre").setAttribute("aria-expanded", estado === "cerrado" ? "false" : "true");
  },
  guardarYCerrar() { if (!this.movil() || !this.el) return; this.previo = this.estado; this.set("cerrado"); },
  restaurar() { if (this.previo && this.movil()) this.set(this.previo); this.previo = null; },
  titulo() {
    const t = this.el?.querySelector(".agarre-tit"); if (!t) return;
    const l = S.sel && loteDe(S.sel);
    if (l) {
      const cs = cultivosDe(l, undefined, S.campana).map((s) => s.cultivo); const c = [...new Set(cs)].join(" + ");
      t.innerHTML = `<b>${esc(l.nombre)}</b><span>${fmt(haDe(l.geom), 1)} ha${c ? " · " + esc(c) : ""}${S.ambEd ? " · ambientación" : ""}</span>`;
    } else {
      const ha = S.d.lotes.reduce((s, x) => s + haDe(x.geom), 0);
      t.innerHTML = `<b>Resumen del campo</b><span>Campaña ${esc(S.campana)} · ${S.d.lotes.length} lotes · ${fmt(ha, 0)} ha</span>`;
    }
  },
  /* Encuadre del mapa dejando libre la parte que tapa la hoja */
  encuadre(extra = {}) {
    if (!this.movil() || !this.el) return { padding: [40, 40], ...extra };
    const tapa = Math.max(0, this.alto() - this.posiciones()[this.estado]);
    return { paddingTopLeft: [30, 60], paddingBottomRight: [30, tapa + 20], ...extra };
  },
  alSeleccionar() { if (this.movil() && this.estado === "cerrado") this.set("medio"); },

  iniciar() {
    this.vista = document.getElementById("v-mapa"); this.el = this.vista.querySelector("aside.ficha"); this.panel = document.getElementById("panel");
    const ag = document.createElement("div"); ag.className = "agarre"; ag.setAttribute("role", "button"); ag.setAttribute("tabindex", "0");
    ag.setAttribute("aria-label", "Mostrar u ocultar la información"); ag.innerHTML = `<span class="barrita"></span><div class="agarre-tit"></div>`;
    this.el.insertBefore(ag, this.el.firstChild);
    const pos = () => this.posiciones();
    const soltar = (y, v) => {
      const p = pos(); const orden = ["abierto", "medio", "cerrado"];
      let dest = orden.reduce((a, k) => (Math.abs(p[k] - y) < Math.abs(p[a] - y) ? k : a), "medio");
      if (Math.abs(v) > 0.45) { /* un tirón rápido pasa a la siguiente posición en esa dirección */
        const sig = orden.filter((k) => (v > 0 ? p[k] > y + 4 : p[k] < y - 4)); if (sig.length) dest = v > 0 ? sig[0] : sig[sig.length - 1];
      }
      this.set(dest);
    };
    const mover = (y0, dy) => { const p = pos(); this.aplicar(Math.max(p.abierto, Math.min(p.cerrado, y0 + dy))); };
    /* Agarradera: puntero (dedo o mouse) */
    let g = null;
    ag.addEventListener("pointerdown", (e) => { if (!this.movil()) return; g = { y: e.clientY, t: performance.now(), y0: this.y, mov: false, hist: [] }; ag.setPointerCapture(e.pointerId); this.el.classList.remove("anim"); });
    ag.addEventListener("pointermove", (e) => { if (!g) return; const dy = e.clientY - g.y; if (Math.abs(dy) > 4) g.mov = true; g.hist.push([performance.now(), e.clientY]); if (g.hist.length > 6) g.hist.shift(); mover(g.y0, dy); });
    const fin = (e) => {
      if (!g) return; const d = g; g = null;
      if (!d.mov) { this.set(this.estado === "cerrado" ? "medio" : this.estado === "medio" ? "abierto" : "cerrado"); return; }
      const h = d.hist; const v = h.length > 1 ? (h[h.length - 1][1] - h[0][1]) / Math.max(1, h[h.length - 1][0] - h[0][0]) : 0;
      soltar(this.y, v);
    };
    ag.addEventListener("pointerup", fin); ag.addEventListener("pointercancel", fin);
    ag.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.set(this.estado === "abierto" ? "cerrado" : this.estado === "cerrado" ? "medio" : "abierto"); } });
    /* Contenido: tacto. Hacia arriba expande; hacia abajo, con el contenido arriba de todo, achica */
    let t = null;
    this.panel.addEventListener("touchstart", (e) => {
      if (!this.movil() || e.touches.length !== 1 || e.target.closest("input,select,textarea,.dates,.tablewrap,.leaflet-container")) { t = null; return; }
      t = { y: e.touches[0].clientY, x: e.touches[0].clientX, y0: this.y, activo: false, hist: [] };
    }, { passive: true });
    this.panel.addEventListener("touchmove", (e) => {
      if (!t) return; const yy = e.touches[0].clientY; const dy = yy - t.y;
      /* Se decide con el primer movimiento, antes de que el navegador empiece a desplazar el contenido */
      if (!t.activo) {
        if (!dy) return;
        if (this.estado !== "abierto" || (this.panel.scrollTop <= 0 && dy > 0)) { t.activo = true; this.el.classList.remove("anim"); }
        else { t = null; return; }
      }
      e.preventDefault(); t.hist.push([performance.now(), yy]); if (t.hist.length > 6) t.hist.shift(); mover(t.y0, yy - t.y);
    }, { passive: false });
    this.panel.addEventListener("touchend", () => {
      if (!t) return; const d = t; t = null; if (!d.activo) return;
      const h = d.hist; const v = h.length > 1 ? (h[h.length - 1][1] - h[0][1]) / Math.max(1, h[h.length - 1][0] - h[0][0]) : 0;
      soltar(this.y, v);
    });
    window.addEventListener("resize", () => this.set(this.estado, false));
    /* La hoja recién tiene alto cuando se ve el mapa: ahí se ubica */
    new ResizeObserver(() => { if (this.alto()) this.set(this.estado, false); }).observe(this.el);
    this.titulo(); this.set("cerrado", false);
  },
};
/* El título de la hoja sigue a lo que muestra la ficha */
{
  const r0 = render; render = function () { r0(); Hoja.titulo(); };
  Hoja.iniciar();
}
