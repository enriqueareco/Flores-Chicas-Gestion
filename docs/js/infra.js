"use strict";
/* ============ Infraestructura del campo: molinos, mangas, caminos… ============ */
const INFRA = {
  molino: { nombre: "Molino", geo: "punto", color: "#2B7BB9", letra: "M" },
  manga: { nombre: "Manga", geo: "punto", color: "#8B5A2B", letra: "Mg" },
  bebida: { nombre: "Bebida / aguada", geo: "punto", color: "#1FA2A8", letra: "B" },
  tranquera: { nombre: "Tranquera", geo: "punto", color: "#C9A227", letra: "T" },
  casa: { nombre: "Casa / galpón", geo: "punto", color: "#A23B2A", letra: "C" },
  camino_principal: { nombre: "Camino principal", geo: "linea", color: "#F6E7BF", peso: 5, dash: null },
  camino_alternativo: { nombre: "Camino alternativo", geo: "linea", color: "#F6E7BF", peso: 3, dash: [9, 7] },
};
const infraNombre = (x) => x.nombre || INFRA[x.tipo]?.nombre || "Marca";

const Infra = {
  grupo: null, capas: new Map(), visible: true, editando: null,
  iniciar() {
    this.grupo = L.layerGroup().addTo(map);
    try { this.visible = localStorage.getItem("fc-infra") !== "0"; } catch (e) {}
    document.getElementById("btnInfra").onclick = () => this.menu();
    this.dibujar();
  },
  icono(t) { const d = INFRA[t] || INFRA.molino; return L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="infra-pt" style="background:${d.color}">${d.letra}</div>` }); },
  dibujar() {
    if (!this.grupo) return;
    this.grupo.clearLayers(); this.capas.clear();
    if (!this.visible) return;
    const clic = (ev, x) => { L.DomEvent.stopPropagation(ev); if (S.drawing) { S.drawing._click(ev); return; } if (!this.editando) this.popup(x, ev.latlng); };
    for (const x of S.d.infra) {
      const d = INFRA[x.tipo]; if (!d || !x.geom) continue;
      if (x.geom.type === "Point") {
        const m = L.marker([x.geom.coordinates[1], x.geom.coordinates[0]], { icon: this.icono(x.tipo), keyboard: false, zIndexOffset: 500 }).bindTooltip(esc(infraNombre(x)), { direction: "top", offset: [0, -10] });
        m.on("click", (ev) => clic(ev, x)); m.addTo(this.grupo); this.capas.set(x.id, m);
      } else if (x.geom.type === "LineString") {
        const ll = x.geom.coordinates.map((c) => [c[1], c[0]]);
        L.polyline(ll, { color: "#3A2F1D", weight: d.peso + 3, opacity: 0.85, interactive: false }).addTo(this.grupo);
        const y = L.polyline(ll, { color: d.color, weight: d.peso, dashArray: d.dash ? d.dash.join(" ") : null, opacity: 1 }).bindTooltip(esc(infraNombre(x)), { sticky: true });
        y.on("click", (ev) => clic(ev, x)); y.addTo(this.grupo); this.capas.set(x.id, y);
      }
    }
  },
  menu() {
    if (S.drawing) { S.drawing.cancelar(); return; }
    if (!S.esquemaOk) { toast("Primero hay que actualizar la base de datos (migracion_04.sql).", 6000); return; }
    const n = (t) => S.d.infra.filter((x) => x.tipo === t).length;
    modal(`<h4>Marcar en el mapa</h4>
      <div class="small muted">Elegí qué querés marcar. Los puntos se ponen con un clic; los caminos se trazan punto por punto, igual que un lote.</div>
      <div class="acciones">${Object.entries(INFRA).map(([k, d]) => `<button class="accion" data-t="${k}" style="padding:10px"><span class="ic">${d.geo === "punto" ? `<span class="infra-pt" style="background:${d.color}">${d.letra}</span>` : `<svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true"><path d="M2 11 C10 2 18 12 28 3" stroke="#3A2F1D" stroke-width="${d.peso + 3}" fill="none" stroke-linecap="round"/><path d="M2 11 C10 2 18 12 28 3" stroke="${d.color}" stroke-width="${d.peso}" fill="none" stroke-dasharray="${d.dash ? d.dash.map((v) => v / 2).join(" ") : "none"}"/></svg>`}</span><span><b>${d.nombre}</b><span>${n(k) ? n(k) + " marcado" + (n(k) > 1 ? "s" : "") : "ninguno todavía"}</span></span></button>`).join("")}</div>
      <label class="row small"><input type="checkbox" id="inVis" ${this.visible ? "checked" : ""}> Mostrar molinos, mangas y caminos en el mapa</label>
      <div class="pie"><button id="mNo">Cerrar</button></div>`, (m, close) => {
      m.querySelector("#mNo").onclick = close;
      m.querySelector("#inVis").onchange = (e) => { this.visible = e.target.checked; try { localStorage.setItem("fc-infra", this.visible ? "1" : "0"); } catch (er) {} this.dibujar(); };
      m.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { close(); this.marcar(b.dataset.t); }));
    }, "medio");
  },
  marcar(tipo) {
    const d = INFRA[tipo];
    if (!this.visible) { this.visible = true; this.dibujar(); }
    if (S.vista !== "mapa") irA("mapa");
    if (d.geo === "linea") { Dib.iniciar({ modo: "linea", titulo: "Trazando " + d.nombre.toLowerCase(), onDone: (g) => this.form({ tipo, geom: g }) }); return; }
    Punto.iniciar(d.nombre, (ll) => this.form({ tipo, geom: { type: "Point", coordinates: [+ll.lng.toFixed(7), +ll.lat.toFixed(7)] } }));
  },
  form(x0) {
    const x = { ...x0 }; const d = INFRA[x.tipo];
    const sug = x.nombre ?? (d.geo === "punto" ? `${d.nombre} ${S.d.infra.filter((y) => y.tipo === x.tipo).length + 1}` : "");
    modal(`<h4>${x.id ? "Editar" : "Nuevo"}: ${esc(d.nombre.toLowerCase())}</h4>
      <div class="field"><label class="lbl" for="inNom">Nombre</label><input id="inNom" value="${esc(sug)}" placeholder="${d.geo === "linea" ? "Ej. Camino de la tranquera a la manga" : "Ej. Molino del Lote 31"}"></div>
      <div class="field"><label class="lbl" for="inTipo">Tipo</label><select id="inTipo">${opciones(Object.entries(INFRA).filter(([, v]) => v.geo === d.geo).map(([k, v]) => [k, v.nombre]), x.tipo)}</select></div>
      <div class="field"><label class="lbl" for="inNot">Notas</label><input id="inNot" value="${esc(x.notas || "")}" placeholder="${d.geo === "linea" ? "Ej. se corta con lluvia" : "Ej. bomba eléctrica, tanque australiano"}"></div>
      ${d.geo === "linea" ? `<div class="small muted">Largo: ${fmt(turf.length({ type: "Feature", geometry: x.geom }, { units: "kilometers" }), 2)} km</div>` : ""}
      <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      $("#mNo").onclick = close;
      $("#mOk").onclick = async () => {
        const n = { ...x, id: x.id || uid(), tipo: $("#inTipo").value, nombre: $("#inNom").value.trim() || null, notas: $("#inNot").value.trim() || null };
        try { await guardar("infra", n); close(); this.dibujar(); toast("Guardado en el mapa"); } catch (e) { toast(e.message, 7000); }
      };
    });
  },
  popup(x, ll) {
    const d = INFRA[x.tipo];
    const largo = x.geom.type === "LineString" ? ` · ${fmt(turf.length({ type: "Feature", geometry: x.geom }, { units: "kilometers" }), 2)} km` : "";
    const el = document.createElement("div");
    el.innerHTML = `<div style="font:14px var(--f-body);display:flex;flex-direction:column;gap:6px;min-width:190px"><b>${esc(infraNombre(x))}</b><span class="small muted">${esc(d.nombre)}${largo}</span>${x.notas ? `<span class="small">${esc(x.notas)}</span>` : ""}
      <div class="row"><button class="small" data-a="edit">Editar</button><button class="small" data-a="mover">${d.geo === "punto" ? "Mover" : "Cambiar trazado"}</button><button class="small ghost danger" data-a="del">Borrar</button></div></div>`;
    const pop = L.popup({ closeButton: true }).setLatLng(ll).setContent(el).openOn(map);
    el.querySelector("[data-a=edit]").onclick = () => { map.closePopup(pop); this.form(x); };
    el.querySelector("[data-a=del]").onclick = async () => { map.closePopup(pop); if (await confirmar(`¿Borrar <b>${esc(infraNombre(x))}</b> del mapa?`, "Borrar")) { await borrar("infra", x.id); this.dibujar(); } };
    el.querySelector("[data-a=mover]").onclick = () => { map.closePopup(pop); this.editar(x); };
  },
  /* Mover un punto o cambiar el trazado de un camino */
  editar(x) {
    const capa = this.capas.get(x.id); if (!capa) return;
    this.editando = x.id;
    if (x.geom.type === "Point") capa.dragging.enable(); else capa.editing.enable();
    let bar = document.getElementById("dibBarra"); if (bar) bar.remove();
    bar = document.createElement("div"); bar.id = "dibBarra";
    bar.style.cssText = "position:absolute;top:12px;left:56px;right:12px;z-index:650;background:var(--panel);color:var(--ink);border:2px solid var(--sel);border-radius:8px;padding:10px 12px;box-shadow:0 2px 12px rgba(0,0,0,.3);max-width:520px;display:flex;flex-direction:column;gap:8px";
    bar.innerHTML = `<b>${x.geom.type === "Point" ? "Arrastrá el punto a su lugar" : "Arrastrá los vértices del camino"}</b><div class="row"><button class="primary" id="ieOk">Guardar</button><button id="ieNo">Cancelar</button></div>`;
    document.querySelector(".mapwrap").appendChild(bar); L.DomEvent.disableClickPropagation(bar);
    const fin = () => { bar.remove(); this.editando = null; this.dibujar(); };
    bar.querySelector("#ieNo").onclick = fin;
    bar.querySelector("#ieOk").onclick = async () => {
      if (x.geom.type === "Point") { const ll = capa.getLatLng(); x.geom = { type: "Point", coordinates: [+ll.lng.toFixed(7), +ll.lat.toFixed(7)] }; }
      else x.geom = { type: "LineString", coordinates: capa.getLatLngs().map((p) => [+p.lng.toFixed(7), +p.lat.toFixed(7)]) };
      try { await guardar("infra", x); toast("Guardado"); } catch (e) { toast(e.message, 7000); }
      fin();
    };
  },
};

/* Poner un punto con un clic (sobre el mapa o sobre un lote) */
const Punto = {
  cb: null,
  iniciar(titulo, cb) {
    if (S.drawing) S.drawing.cancelar();
    this.cb = cb; S.drawing = this;
    map.getContainer().style.cursor = "crosshair";
    map.on("click", this._click, this);
    this._key = (e) => { if (e.key === "Escape") this.cancelar(); };
    document.addEventListener("keydown", this._key);
    let bar = document.getElementById("dibBarra"); if (bar) bar.remove();
    bar = document.createElement("div"); bar.id = "dibBarra";
    bar.style.cssText = "position:absolute;top:12px;left:56px;right:12px;z-index:650;background:var(--panel);color:var(--ink);border:2px solid var(--sel);border-radius:8px;padding:10px 12px;box-shadow:0 2px 12px rgba(0,0,0,.3);max-width:520px;display:flex;gap:10px;align-items:center;justify-content:space-between";
    bar.innerHTML = `<span><b>${esc(titulo)}</b><br><span class="small muted">Tocá el lugar exacto en el mapa. Después lo podés mover.</span></span><button id="ptNo">Cancelar</button>`;
    document.querySelector(".mapwrap").appendChild(bar); L.DomEvent.disableClickPropagation(bar);
    bar.querySelector("#ptNo").onclick = () => this.cancelar();
  },
  _click(e) { const cb = this.cb; this.salir(); cb && cb(e.latlng); },
  salir() { map.off("click", this._click, this); document.removeEventListener("keydown", this._key); map.getContainer().style.cursor = ""; document.getElementById("dibBarra")?.remove(); this.cb = null; setTimeout(() => { if (S.drawing === Punto) S.drawing = null; }, 50); },
  cancelar() { this.salir(); },
};
