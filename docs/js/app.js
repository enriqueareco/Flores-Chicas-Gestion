"use strict";
/* ============ Utilidades y estado común ============ */
const CULTIVOS = {
  "Maíz": "#E3B23C", "Soja": "#5E9E3F", "Soja 2da": "#9BC46A", "Trigo": "#D2B37A", "Cebada": "#B98B4E",
  "Girasol": "#F08A24", "Avena": "#A3B86C", "Sorgo": "#A85B3A", "Maíz de pastoreo": "#B8862B", "Pastura": "#2E8B7A", "Verdeo": "#6CC4A1",
  "Ryegrass": "#3FA7C9", "Promoción de ryegrass": "#8FCFE0", "Campo natural": "#7D8F4E", "Barbecho": "#9C8B7A", "Otro": "#8E7CC3",
};
const SIN = "#7C8794";
const TIPOS_LABOR = ["Siembra", "Pulverización", "Fertilización", "Cosecha", "Labranza", "Rolo", "Picado", "Enfardado", "Desmalezado", "Otra"];
const TIPOS_CON_INSUMOS = new Set(["Siembra", "Pulverización", "Fertilización"]);
const TIPOS_PRODUCTO = ["herbicida", "insecticida", "fungicida", "fertilizante", "semilla", "coadyuvante", "combustible", "servicio", "otro"];
const UNIDADES_DOSIS = ["L/ha", "cc/ha", "kg/ha", "g/ha", "u/ha"];

const S = {
  campana: campanaActual(),
  d: { lotes: [], siembras: [], rindes: [], proveedores: [], productos: [], comprobantes: [], ordenes: [], labores: [] },
  vista: null,
};

function campanaActual() { const d = new Date(); const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${String(y + 1).slice(2)}`; }
function campanas() { const y = +campanaActual().slice(0, 4); const out = []; for (let i = y + 1; i >= y - 6; i--) out.push(`${i}/${String(i + 1).slice(2)}`); return out; }
function campanaDeFecha(f) { if (!f) return S.campana; const d = new Date(f + "T12:00"); const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${String(y + 1).slice(2)}`; }
const uid = () => nuevoId();
const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmt = (n, d = 1) => n == null || n === "" || isNaN(n) ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtM = (n, mon = "USD", d = 0) => n == null || isNaN(n) ? "—" : (mon === "USD" ? "US$ " : "$ ") + fmt(n, d);
const fechaAR = (f) => f ? new Date(String(f).slice(0, 10) + "T12:00").toLocaleDateString("es-AR") : "—";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const soloDig = (s) => String(s || "").replace(/\D/g, "");
const num = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; };

function haDe(geom) { try { return turf.area({ type: "Feature", geometry: geom }) / 10000; } catch (e) { return 0; } }
const loteDe = (id) => S.d.lotes.find((l) => l.id === id);
const subDe = (l, id) => (l?.subs || []).find((s) => s.id === id);
function nombreUbic(loteId, subId) { const l = loteDe(loteId); if (!l) return "Sin lote"; const s = subDe(l, subId); return l.nombre + (s ? " · " + s.nombre : ""); }
function haUbic(loteId, subId) { const l = loteDe(loteId); if (!l) return null; const s = subDe(l, subId); return haDe(s ? s.geom : l.geom); }
const proveedorDe = (id) => S.d.proveedores.find((p) => p.id === id);
const productoDe = (id) => S.d.productos.find((p) => p.id === id);
const contratistas = () => S.d.proveedores.filter((p) => p.tipo === "contratista" || p.tipo === "ambos");

/* Cultivos */
function ordenSiembras(a, b) { return (a.fecha || "9999").localeCompare(b.fecha || "9999") || (a.creado || "").localeCompare(b.creado || ""); }
function cultivosDe(l, subId, c = S.campana) { return S.d.siembras.filter((s) => s.lote_id === l.id && s.campana === c && (subId === undefined || !s.sub_id || s.sub_id === subId)).sort(ordenSiembras); }
function siembraDe(l, c = S.campana) { return cultivosDe(l, undefined, c)[0]; }
const colorCult = (n) => CULTIVOS[n] || CULTIVOS.Otro;
function colorDe(l) { const s = siembraDe(l); return s ? colorCult(s.cultivo) : SIN; }
function colorSub(l, sub) { const s = cultivosDe(l, sub.id)[0]; return s ? colorCult(s.cultivo) : SIN; }
function textoCultivos(l, subId) { return [...new Set(cultivosDe(l, subId).map((s) => s.cultivo))].join(" / "); }

/* Unidades y costos */
function dosisABase(dosis, unidad) { const d = Number(dosis) || 0; switch (unidad) { case "cc/ha": return [d / 1000, "L"]; case "g/ha": return [d / 1000, "kg"]; case "kg/ha": return [d, "kg"]; case "u/ha": return [d, "u"]; default: return [d, "L"]; } }
function cantidadInsumo(ins, ha) { const [b, u] = dosisABase(ins.dosis, ins.unidad); return { cant: b * (Number(ha) || 0), unidad: u }; }
function aUSD(monto, moneda, tc) { if (monto == null) return null; if (moneda === "USD") return monto; return tc ? monto / tc : null; }
/* Precio promedio ponderado en USD por unidad base, a partir de comprobantes confirmados con precio */
function preciosProductos() {
  const acc = {};
  for (const c of S.d.comprobantes) {
    if (c.estado !== "confirmado" || c.tipo === "remito") continue;
    const sg = c.tipo === "nota_credito" ? -1 : 1;
    for (const it of c.items || []) {
      if (!it.producto_id || !it.precio_unitario || !it.cantidad) continue;
      const pu = aUSD(Number(it.precio_unitario), c.moneda, Number(c.tipo_cambio));
      if (pu == null) continue;
      const a = (acc[it.producto_id] ??= { m: 0, q: 0 });
      a.m += sg * pu * it.cantidad; a.q += sg * it.cantidad;
    }
  }
  const out = {}; for (const [k, a] of Object.entries(acc)) if (a.q > 0) out[k] = a.m / a.q;
  return out;
}
function stockProductos() {
  const st = {};
  for (const c of S.d.comprobantes) {
    if (c.estado !== "confirmado" || !c.mueve_stock) continue;
    const sg = c.tipo === "nota_credito" ? -1 : 1;
    for (const it of c.items || []) if (it.producto_id) { const a = (st[it.producto_id] ??= { entra: 0, sale: 0 }); a.entra += sg * (Number(it.cantidad) || 0); }
  }
  for (const l of S.d.labores) for (const ins of l.insumos || []) if (ins.producto_id) {
    const a = (st[ins.producto_id] ??= { entra: 0, sale: 0 });
    a.sale += ins.cantidad != null ? Number(ins.cantidad) : cantidadInsumo(ins, l.superficie_ha).cant;
  }
  return st;
}
function costoLabor(l, precios = preciosProductos()) {
  let ins = 0, insFalta = 0;
  for (const i of l.insumos || []) {
    const q = i.cantidad != null ? Number(i.cantidad) : cantidadInsumo(i, l.superficie_ha).cant;
    const p = precios[i.producto_id];
    if (p != null) ins += p * q; else if (q) insFalta++;
  }
  const lab = l.costo_ha != null && l.superficie_ha ? Number(l.costo_ha) * Number(l.superficie_ha) : null;
  return { insumosUSD: ins, insumosSinPrecio: insFalta, labor: lab, moneda: l.moneda || "USD" };
}

/* ============ Interfaz común ============ */
let toastT;
function toast(msg, ms = 3500) { document.querySelectorAll(".toast").forEach((t) => t.remove()); const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms); }
function modal(html, onMount, cls = "") {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener("keydown", onEsc); };
  const onEsc = (e) => { if (e.key === "Escape" && !S.drawing) close(); };
  document.addEventListener("keydown", onEsc);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  onMount && onMount(bg.firstChild, close);
  const f = bg.querySelector("[autofocus]") || bg.querySelector("input:not([type=checkbox]),select,textarea"); f && f.focus();
  return close;
}
function confirmar(txt, okTxt = "Eliminar") {
  return new Promise((res) => modal(`<h4>Confirmar</h4><p>${txt}</p><div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mSi">${okTxt}</button></div>`, (m, close) => {
    m.querySelector("#mNo").onclick = () => { close(); res(false); }; m.querySelector("#mSi").onclick = () => { close(); res(true); };
  }));
}
function cargando(msg) { const d = document.createElement("div"); d.className = "cargando"; d.innerHTML = `<div><span class="spin"></span>${esc(msg)}</div>`; document.body.appendChild(d); return () => d.remove(); }

/* Guardar y borrar manteniendo el estado en memoria */
async function guardar(t, fila) {
  await DB.guardar(t, fila);
  const arr = S.d[t]; const i = arr.findIndex((x) => x.id === fila.id);
  if (i >= 0) arr[i] = fila; else arr.push(fila);
  return fila;
}
async function borrar(t, id) { await DB.borrar(t, id); S.d[t] = S.d[t].filter((x) => x.id !== id); }
async function cargarDatos() {
  const r = await Promise.all(Object.keys(S.d).map((t) => DB.listar(t)));
  Object.keys(S.d).forEach((t, i) => (S.d[t] = r[i]));
  for (const l of S.d.lotes) l.subs = l.subs || [];
}

/* Selects */
function opcionesLotes(sel, conVacio = true) {
  const g = {}; for (const l of S.d.lotes) (g[l.campo || "Sin establecimiento"] ??= []).push(l);
  return (conVacio ? `<option value="">Elegir lote…</option>` : "") + Object.entries(g).sort().map(([c, ls]) => `<optgroup label="${esc(c)}">${ls.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })).map((l) => `<option value="${l.id}" ${l.id === sel ? "selected" : ""}>${esc(l.nombre)} · ${fmt(haDe(l.geom), 0)} ha</option>`).join("")}</optgroup>`).join("");
}
function opcionesSubs(l, sel) { return `<option value="">Lote completo</option>` + (l?.subs || []).map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.nombre)} · ${fmt(haDe(s.geom))} ha</option>`).join(""); }
const opciones = (arr, sel) => arr.map((v) => { const [val, txt] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}" ${String(val) === String(sel ?? "") ? "selected" : ""}>${esc(txt)}</option>`; }).join("");
function datalistProductos(id = "dlProd") { return `<datalist id="${id}">${S.d.productos.map((p) => `<option value="${esc(p.nombre)}">`).join("")}</datalist>`; }
function datalistContratistas(id = "dlCont") { return `<datalist id="${id}">${S.d.proveedores.filter((p) => p.tipo !== "proveedor").map((p) => `<option value="${esc(p.nombre)}">`).join("")}</datalist>`; }
function buscarProducto(nombre) { const n = norm(nombre); if (!n) return null; return S.d.productos.find((p) => norm(p.nombre) === n) || null; }
function buscarProveedor(nombre, cuit) {
  const c = soloDig(cuit); if (c.length >= 10) { const p = S.d.proveedores.find((x) => soloDig(x.cuit) === c); if (p) return p; }
  const n = norm(nombre); if (!n) return null;
  return S.d.proveedores.find((p) => norm(p.nombre) === n) || S.d.proveedores.find((p) => n.length > 4 && (norm(p.nombre).includes(n) || n.includes(norm(p.nombre)))) || null;
}
/* Busca o crea un contratista por nombre. Devuelve {id, nombre} */
async function asegurarContratista(nombre) {
  nombre = String(nombre || "").trim(); if (!nombre) return { id: null, nombre: null };
  let p = buscarProveedor(nombre);
  if (p) { if (p.tipo === "proveedor") { p.tipo = "ambos"; await guardar("proveedores", p); } return { id: p.id, nombre: p.nombre }; }
  p = await guardar("proveedores", { id: uid(), nombre, tipo: "contratista" });
  return { id: p.id, nombre: p.nombre };
}
async function asegurarProducto(nombre, extra = {}) {
  nombre = String(nombre || "").trim(); if (!nombre) return null;
  let p = buscarProducto(nombre); if (p) return p;
  return guardar("productos", { id: uid(), nombre, tipo: extra.tipo || "otro", principio_activo: extra.principio_activo || null, concentracion: extra.concentracion || null, unidad: extra.unidad || "L" });
}

/* Descargas (CSV, JSON) */
function descargar(nombre, contenido, tipo) { const a = document.createElement("a"); a.href = URL.createObjectURL(contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo })); a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function csv(filas) { return "﻿" + filas.map((r) => r.map((v) => { const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\r\n"); }

/* Imprimir un bloque HTML */
function imprimir(html) {
  const el = document.getElementById("imprimir"); el.innerHTML = html; el.hidden = false;
  document.body.classList.add("imprimiendo");
  const fin = () => { document.body.classList.remove("imprimiendo"); el.hidden = true; el.innerHTML = ""; window.removeEventListener("afterprint", fin); };
  window.addEventListener("afterprint", fin);
  setTimeout(() => window.print(), 50);
}

/* ============ Navegación ============ */
const Vistas = {};
function irA(v) { if (location.hash !== "#" + v) location.hash = v; else mostrarVista(v); }
function mostrarVista(v) {
  if (v === "mas") { menuMas(); v = S.vista || "mapa"; history.replaceState(null, "", "#" + v); }
  if (!Vistas[v]) v = "mapa";
  S.vista = v;
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "v-" + v));
  document.querySelectorAll("nav [data-v]").forEach((a) => a.classList.toggle("on", a.dataset.v === v));
  Vistas[v]();
}
window.addEventListener("hashchange", () => mostrarVista(location.hash.slice(1) || "mapa"));
function refrescar() { if (S.vista && Vistas[S.vista]) Vistas[S.vista](); }

function menuMas() {
  modal(`<h4>Más</h4><div class="col">
    <button class="big" data-ir="aplicaciones">Aplicaciones de agroquímicos</button>
    <button class="big" data-ir="comprobantes">Comprobantes</button>
    <button class="big" data-ir="insumos">Insumos y proveedores</button>
    <button class="big" id="mCuenta">Cuenta y datos</button></div>
    <div class="pie"><button id="mNo">Cerrar</button></div>`, (m, close) => {
    m.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => { close(); irA(b.dataset.ir); }));
    m.querySelector("#mCuenta").onclick = () => { close(); menuCuenta(); };
    m.querySelector("#mNo").onclick = close;
  });
}

/* ============ Cuenta, exportar e importar ============ */
function menuCuenta() {
  const nube = DB.modo === "nube";
  modal(`<h4>Cuenta y datos</h4>
    <div class="small muted">${nube ? "Conectado como <b>" + esc(DB.usuario?.email) + "</b>" : "Modo prueba: los datos se guardan solo en este navegador. Para usarlo desde el teléfono y compartirlo, completá la configuración de Supabase (ver la guía de instalación)."}</div>
    <div class="col">
      <button id="cExp">Exportar todos los datos (.json)</button>
      <button id="cImp">Importar datos o el proyecto del mapa anterior…</button>
      <button id="cGeo">Exportar contornos para QGIS (.geojson)</button>
      ${nube ? '<button id="cClave">Cambiar contraseña</button><button id="cSalir" class="danger">Cerrar sesión</button>' : ""}
    </div>
    <div class="pie"><button id="mNo">Cerrar</button></div>`, (m, close) => {
    const $ = (q) => m.querySelector(q);
    $("#mNo").onclick = close;
    $("#cExp").onclick = async () => {
      const fin = cargando("Preparando la exportación…");
      try {
        const puntos = {}; for (const r of S.d.rindes) { try { const b = await DB.bajar("rindes", r.path || r.id + ".json"); if (b) puntos[r.id] = JSON.parse(await b.text()); } catch (e) {} }
        descargar(`Campo_Flores_Chicas_${hoy()}.json`, JSON.stringify({ app: "campo-flores-chicas", version: 2, exportado: new Date().toISOString(), tablas: S.d, puntos }), "application/json");
      } finally { fin(); }
      close();
    };
    $("#cImp").onclick = () => { close(); document.getElementById("fProj").click(); };
    $("#cGeo").onclick = () => { exportarGeojson(); close(); };
    if (nube) {
      $("#cClave").onclick = () => { close(); pedirClaveNueva(); };
      $("#cSalir").onclick = async () => { await DB.salir(); location.reload(); };
    }
  });
}
function pedirClaveNueva() {
  modal(`<h4>Nueva contraseña</h4><div class="field"><label class="lbl" for="nc1">Contraseña nueva</label><input type="password" id="nc1" autocomplete="new-password"></div>
    <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
    m.querySelector("#mNo").onclick = close;
    m.querySelector("#mOk").onclick = async () => { const v = m.querySelector("#nc1").value; if (v.length < 8) { toast("Usá al menos 8 caracteres."); return; } try { await DB.cambiarClave(v); close(); toast("Contraseña actualizada"); } catch (e) { toast(e.message, 6000); } };
  });
}
document.getElementById("fProj").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  let j; try { j = JSON.parse(await f.text()); } catch (err) { toast("El archivo no es un JSON válido."); return; }
  if (j.app !== "campo-flores-chicas") { toast("No es un archivo de esta plataforma."); return; }
  let tablas, puntos = j.puntos || {};
  if (j.version === 2) tablas = j.tablas;
  else {
    tablas = { lotes: [], siembras: [], rindes: j.rindes || [] };
    for (const l of j.lotes || []) {
      for (const s of l.siembras || []) tablas.siembras.push({ id: s.id || uid(), lote_id: l.id, sub_id: s.sub || null, campana: s.campana, cultivo: s.cultivo, hibrido: s.hibrido || null, fecha: s.fecha || null, notas: s.notas || null, creado: s.creado || null });
      tablas.lotes.push({ id: l.id, nombre: l.nombre, campo: l.campo || null, geom: l.geom, subs: l.subs || [], notas: l.notas || "", creado: l.creado });
    }
    tablas.rindes = tablas.rindes.map((r) => ({ ...r, lote_id: r.loteId || r.lote_id, path: r.id + ".json" }));
  }
  const n = Object.fromEntries(Object.entries(tablas).map(([k, v]) => [k, (v || []).length]));
  modal(`<h4>Importar datos</h4><p class="small">${n.lotes || 0} lotes, ${n.siembras || 0} cultivos cargados, ${n.rindes || 0} mapas de rinde${n.labores ? `, ${n.labores} labores, ${n.comprobantes || 0} comprobantes` : ""}.</p>
    <p class="small muted">Se agregan a lo que ya hay. Si un registro ya existe (mismo identificador) se actualiza.</p>
    <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Importar</button></div>`, (m, close) => {
    m.querySelector("#mNo").onclick = close;
    m.querySelector("#mOk").onclick = async () => {
      close(); const fin = cargando("Importando…");
      try {
        for (const t of ["lotes", "proveedores", "productos", "siembras", "comprobantes", "ordenes", "labores", "rindes"]) {
          const filas = (tablas[t] || []).map((r) => { const o = { ...r }; delete o.loteId; return o; });
          if (!filas.length) continue;
          if (t === "rindes") for (const r of filas) { r.path = r.path || r.id + ".json"; if (puntos[r.id]) await DB.subir("rindes", r.path, new Blob([JSON.stringify(puntos[r.id])], { type: "application/json" })); }
          await DB.guardarVarios(t, filas);
        }
        await cargarDatos(); Mapa.redibujar(); Mapa.encuadrar(); refrescar(); toast("Datos importados");
      } catch (err) { console.error(err); toast("No se pudo importar: " + err.message, 7000); } finally { fin(); }
    };
  });
};
function exportarGeojson() {
  descargar("lotes_flores_chicas.geojson", JSON.stringify({ type: "FeatureCollection", features: S.d.lotes.flatMap((l) => [{ type: "Feature", properties: { tipo: "lote", nombre: l.nombre, establecimiento: l.campo, ha: +haDe(l.geom).toFixed(2), cultivo: textoCultivos(l), campana: S.campana }, geometry: l.geom }, ...l.subs.map((sb) => ({ type: "Feature", properties: { tipo: "sector", lote: l.nombre, nombre: sb.nombre, establecimiento: l.campo, ha: +haDe(sb.geom).toFixed(2), cultivo: textoCultivos(l, sb.id), campana: S.campana }, geometry: sb.geom }))]) }), "application/geo+json");
}

/* ============ Pantalla de ingreso ============ */
function pantallaIngreso() {
  return new Promise((res) => {
    const d = document.createElement("div"); d.className = "login";
    d.innerHTML = `<form class="box" id="fLogin"><h1>Flores Chicas</h1><div class="muted small">Gestión agrícola · ingresá con tu cuenta</div>
      <div class="field"><label class="lbl" for="lgMail">Correo</label><input type="email" id="lgMail" autocomplete="username" required></div>
      <div class="field"><label class="lbl" for="lgClave">Contraseña</label><input type="password" id="lgClave" autocomplete="current-password" required></div>
      <div id="lgErr" class="small" style="color:var(--danger)"></div>
      <button class="primary" type="submit" style="justify-content:center;padding:10px">Ingresar</button>
      <button type="button" class="ghost small" id="lgOlv">Olvidé mi contraseña</button></form>`;
    document.body.appendChild(d);
    const $ = (q) => d.querySelector(q);
    $("#fLogin").onsubmit = async (e) => {
      e.preventDefault(); $("#lgErr").textContent = "";
      try { await DB.entrar($("#lgMail").value.trim(), $("#lgClave").value); d.remove(); res(); } catch (err) { $("#lgErr").textContent = err.message; }
    };
    $("#lgOlv").onclick = async () => {
      const m = $("#lgMail").value.trim(); if (!m) { $("#lgErr").textContent = "Escribí tu correo y volvé a tocar el botón."; return; }
      try { await DB.recuperar(m); $("#lgErr").style.color = "var(--ok)"; $("#lgErr").textContent = "Te mandamos un correo para elegir una contraseña nueva."; } catch (err) { $("#lgErr").textContent = err.message; }
    };
  });
}
