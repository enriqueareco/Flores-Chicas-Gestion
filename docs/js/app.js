"use strict";
/* ============ Utilidades y estado común ============ */
const CULTIVOS = {
  "Maíz": "#E3B23C", "Soja": "#5E9E3F", "Soja 2da": "#9BC46A", "Trigo": "#D2B37A", "Cebada": "#B98B4E",
  "Girasol": "#F08A24", "Avena": "#A3B86C", "Sorgo": "#A85B3A", "Maíz de pastoreo": "#B8862B", "Pastura": "#2E8B7A", "Verdeo": "#6CC4A1",
  "Ryegrass": "#3FA7C9", "Promoción de ryegrass": "#8FCFE0", "Campo natural": "#7D8F4E", "Barbecho": "#9C8B7A", "Otro": "#8E7CC3",
};
const SIN = "#7C8794";
/* Categorías de labor: agrupan el catálogo y deciden qué datos se piden (las pulverizaciones llevan condiciones de aplicación) */
const TIPOS_LABOR = ["Siembra", "Pulverización", "Fertilización", "Cosecha", "Labranza", "Rolo", "Picado", "Enfardado", "Embolsado", "Desmalezado", "Flete", "Otra"];
const CATALOGO_INICIAL = [
  ["Pulverización terrestre", "Pulverización"], ["Pulverización aérea", "Pulverización"],
  ["Siembra directa grano grueso", "Siembra"], ["Siembra directa grano fino", "Siembra"], ["Siembra de pasturas y verdeos", "Siembra"],
  ["Fertilización al voleo", "Fertilización"], ["Fertilización incorporada", "Fertilización"],
  ["Cosecha grano grueso", "Cosecha"], ["Cosecha grano fino", "Cosecha"],
  ["Rastra de discos", "Labranza"], ["Disco doble acción", "Labranza"], ["Cincel / descompactador", "Labranza"], ["Rastra de dientes", "Labranza"],
  ["Rolo", "Rolo"], ["Picado de forraje", "Picado"], ["Rollos", "Enfardado"], ["Embolsado de grano", "Embolsado"], ["Desmalezadora", "Desmalezado"],
];
const TIPOS_CON_INSUMOS = new Set(["Siembra", "Pulverización", "Fertilización"]);
const TIPOS_PRODUCTO = ["herbicida", "insecticida", "fungicida", "fertilizante", "semilla", "coadyuvante", "combustible", "servicio", "otro"];
const UNIDADES_DOSIS = ["L/ha", "cc/ha", "kg/ha", "g/ha", "u/ha"];

const S = {
  campana: campanaActual(),
  d: { lotes: [], siembras: [], rindes: [], proveedores: [], productos: [], labores_tipo: [], comprobantes: [], ordenes: [], labores: [] },
  esquemaOk: true,
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
/* Cultivos que se mantienen de una campaña a la siguiente hasta que se cargue otro */
const PERENNES = new Set(["Campo natural", "Promoción de ryegrass", "Pastura"]);
function cultivosCargados(l, subId, c) { return S.d.siembras.filter((s) => s.lote_id === l.id && s.campana === c && (subId === undefined || !s.sub_id || s.sub_id === subId)).sort(ordenSiembras); }
/* Si en la campaña no hay nada cargado y la última campaña con datos terminó con un cultivo perenne, ese cultivo continúa */
function cultivoHeredado(l, subId, c) {
  const anteriores = [...new Set(S.d.siembras.filter((s) => s.lote_id === l.id && s.campana < c).map((s) => s.campana))].sort().reverse();
  for (const ca of anteriores) {
    const cs = cultivosCargados(l, subId, ca);
    if (!cs.length) continue;
    const ult = cs[cs.length - 1];
    return PERENNES.has(ult.cultivo) ? { ...ult, campana: c, heredado: true, desde_campana: ult.heredado ? ult.desde_campana : ca } : null;
  }
  return null;
}
function cultivosDe(l, subId, c = S.campana) {
  const r = cultivosCargados(l, subId, c); if (r.length) return r;
  if (subId === undefined && (l.subs || []).length) { const hs = l.subs.map((sb) => cultivoHeredado(l, sb.id, c)).filter(Boolean); if (hs.length) return hs; }
  const h = cultivoHeredado(l, subId, c); return h ? [h] : [];
}
function siembraDe(l, c = S.campana) { return cultivosDe(l, undefined, c)[0]; }
const colorCult = (n) => CULTIVOS[n] || CULTIVOS.Otro;
function colorDe(l) { const s = siembraDe(l); return s ? colorCult(s.cultivo) : SIN; }
function colorSub(l, sub) { const s = cultivosDe(l, sub.id)[0]; return s ? colorCult(s.cultivo) : SIN; }
function textoCultivos(l, subId) { return [...new Set(cultivosDe(l, subId).map((s) => s.cultivo))].join(" / "); }

/* Unidades y costos */
function dosisABase(dosis, unidad) { const d = Number(dosis) || 0; switch (unidad) { case "cc/ha": return [d / 1000, "L"]; case "g/ha": return [d / 1000, "kg"]; case "kg/ha": return [d, "kg"]; case "u/ha": return [d, "u"]; default: return [d, "L"]; } }
function cantidadInsumo(ins, ha) { const [b, u] = dosisABase(ins.dosis, ins.unidad); return { cant: b * (Number(ha) || 0), unidad: u }; }
function aUSD(monto, moneda, tc) { if (monto == null) return null; if (moneda === "USD") return monto; return tc ? monto / tc : null; }
/* Precio vigente de cada insumo en US$ por unidad: el de la última factura confirmada (por fecha); si no hay, el precio de referencia cargado a mano */
function preciosDetalle() {
  const out = {};
  const comps = S.d.comprobantes.filter((c) => c.estado === "confirmado" && (c.tipo === "factura" || c.tipo === "nota_debito" || c.tipo === "otro")).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.creado || "").localeCompare(b.creado || ""));
  for (const c of comps) for (const it of c.items || []) {
    if (!it.producto_id || !it.precio_unitario) continue;
    const pu = aUSD(Number(it.precio_unitario), c.moneda, Number(c.tipo_cambio));
    if (pu != null) out[it.producto_id] = { usd: pu, fecha: c.fecha, origen: `${nombreTipoCompCorto(c.tipo)} ${c.numero || ""} · ${c.proveedor_nombre || ""}`.trim() };
  }
  for (const p of S.d.productos) if (!out[p.id] && p.precio != null && (p.moneda || "USD") === "USD") out[p.id] = { usd: Number(p.precio), fecha: null, origen: "precio de referencia" };
  return out;
}
function preciosProductos() { const d = preciosDetalle(); const o = {}; for (const k in d) o[k] = d[k].usd; return o; }
const nombreTipoCompCorto = (t) => ({ factura: "Factura", remito: "Remito", nota_credito: "N. crédito", nota_debito: "N. débito", ajuste: "Ajuste" }[t] || "Comprob.");
/* Stock del galpón: entra por remitos/facturas confirmados (y ajustes de inventario), sale por labores realizadas */
function stockProductos() {
  const st = {};
  const a = (id) => (st[id] ??= { entra: 0, sale: 0, ordenes: 0 });
  for (const c of S.d.comprobantes) {
    if (c.estado !== "confirmado" || !c.mueve_stock) continue;
    const sg = c.tipo === "nota_credito" ? -1 : 1;
    for (const it of c.items || []) if (it.producto_id && !it.ignorar) a(it.producto_id).entra += sg * (Number(it.cantidad) || 0);
  }
  for (const l of S.d.labores) for (const ins of l.insumos || []) if (ins.producto_id) a(ins.producto_id).sale += ins.cantidad != null ? Number(ins.cantidad) : cantidadInsumo(ins, l.superficie_ha).cant;
  for (const o of S.d.ordenes) if (o.estado === "pendiente" || o.estado === "en_curso") for (const ins of o.insumos || []) if (ins.producto_id) a(ins.producto_id).ordenes += ins.cantidad != null ? Number(ins.cantidad) : cantidadInsumo(ins, o.superficie_ha).cant;
  return st;
}
/* ---------- Catálogo de labores ---------- */
const laborTipoDe = (id) => S.d.labores_tipo.find((t) => t.id === id);
function nombreLabor(l) { return laborTipoDe(l?.labor_tipo_id)?.nombre || l?.tipo || "Labor"; }
/* Precio del catálogo que rige en una fecha. El primer precio cargado rige desde siempre. */
function precioCatalogo(t, fecha = hoy()) {
  const ps = (t?.precios || []).filter((p) => p.precio != null).sort((a, b) => (a.desde || "").localeCompare(b.desde || ""));
  let v = null; for (const p of ps) if (!p.desde || p.desde <= fecha) v = p;
  return v;
}
const conPrecio = (l) => l.costo_ha != null && l.costo_estado !== "a_definir";
function opcionesCatalogo(sel, extra = true) {
  const g = {}; for (const t of S.d.labores_tipo) if (t.activo !== false || t.id === sel) (g[t.categoria || "Otra"] ??= []).push(t);
  return `<option value="">Elegir labor…</option>` + TIPOS_LABOR.filter((c) => g[c]).map((c) => `<optgroup label="${esc(c)}">${g[c].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((t) => { const p = precioCatalogo(t); return `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.nombre)}${p ? ` · ${p.moneda === "ARS" ? "$" : "US$"} ${fmt(p.precio, 2)}/ha` : ""}</option>`; }).join("")}</optgroup>`).join("") + (extra ? `<option value="__nueva">+ Agregar una labor al catálogo…</option>` : "");
}
/* ---------- Insumos ---------- */
const unidadDosis = (p) => ({ kg: "kg/ha", u: "u/ha" }[p?.unidad] || "L/ha");
function opcionesProductos(sel, extra = true) {
  const g = {}; for (const p of S.d.productos) (g[p.tipo || "otro"] ??= []).push(p);
  return `<option value="">Elegir insumo…</option>` + TIPOS_PRODUCTO.filter((t) => g[t]).map((t) => `<optgroup label="${esc(t[0].toUpperCase() + t.slice(1))}">${g[t].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.nombre)}${p.principio_activo ? " · " + esc(p.principio_activo) : ""}</option>`).join("")}</optgroup>`).join("") + (extra ? `<option value="__nuevo">+ Crear un insumo nuevo…</option>` : "");
}
/* Clave para reconocer un nombre de insumo sin importar envase, mayúsculas ni acentos */
function claveInsumo(s) {
  return norm(s).replace(/\b(x\s*)?\d+([ .,]\d+)?\s*(l|lt|lts|litro|litros|kg|kgs|kilo|kilos|cc|ml|g|gr|grs)\b/g, " ").replace(/\b(x|bidon|bidones|bid|bolsa|bolsas|bls|envase|envases|caja|cajas|pack|unid|unidad|unidades|un|tambor|tambores|bigbag|big bag)\b/g, " ").replace(/\s+/g, " ").trim();
}
function productoPorTexto(txt) {
  const k = claveInsumo(txt); if (!k) return null;
  return S.d.productos.find((p) => claveInsumo(p.nombre) === k || (p.alias || []).some((a) => claveInsumo(a.texto ?? a) === k)) || null;
}
/* Editor de lista de insumos (producto de la lista + dosis por ha). lista se modifica en el lugar. */
function editorInsumos(cont, lista, opts = {}) {
  const ha = opts.ha || (() => 0);
  const totFila = (row, i) => { const el = row.querySelector(".tot"); if (!el) return; const t = cantidadInsumo(i, ha()); el.textContent = i.dosis && ha() ? fmt(t.cant, 1) + " " + t.unidad : ""; };
  const ed = {
    pintar() {
      cont.innerHTML = lista.length ? lista.map((i, k) => `<div class="ins-row" data-k="${k}"><div class="col" style="gap:2px;min-width:0"><select data-f="producto_id" aria-label="Insumo">${opcionesProductos(i.producto_id)}</select>${!i.producto_id && i.nombre ? `<span class="small" style="color:var(--warn)">Dictado: «${esc(i.nombre)}». Elegí el insumo de la lista.</span>` : ""}</div><input data-f="dosis" inputmode="decimal" value="${i.dosis ?? ""}" placeholder="Dosis" aria-label="Dosis por ha"><select data-f="unidad" aria-label="Unidad">${opciones(UNIDADES_DOSIS, i.unidad)}</select><span class="num small tot"></span><button type="button" class="ghost small danger" data-q="${k}" title="Quitar insumo">✕</button></div>`).join("") : `<div class="small muted">${opts.vacio || "Sin insumos."}</div>`;
      cont.querySelectorAll("[data-k]").forEach((row) => {
        const i = lista[+row.dataset.k]; totFila(row, i);
        row.querySelector("[data-f=dosis]").oninput = (e) => { i.dosis = num(e.target.value); totFila(row, i); };
        row.querySelector("[data-f=unidad]").onchange = (e) => { i.unidad = e.target.value; totFila(row, i); };
        row.querySelector("[data-f=producto_id]").onchange = (e) => {
          const v = e.target.value;
          if (v === "__nuevo") { e.target.value = i.producto_id || ""; Insumos.formProducto(null, (p) => { i.producto_id = p.id; i.nombre = p.nombre; i.unidad = unidadDosis(p); ed.pintar(); }, { nombre: i.nombre, tipo: opts.tipoDef?.() }); return; }
          const p = productoDe(v); i.producto_id = p?.id || null; i.nombre = p?.nombre || ""; if (p && dosisABase(1, i.unidad)[1] !== (p.unidad || "L")) i.unidad = unidadDosis(p); ed.pintar();
        };
      });
      cont.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { lista.splice(+b.dataset.q, 1); ed.pintar(); }));
    },
    agregar() { lista.push({ producto_id: null, nombre: "", dosis: null, unidad: "L/ha" }); ed.pintar(); cont.querySelector(`[data-k="${lista.length - 1}"] select`)?.focus(); },
    reemplazar(nueva) { lista.splice(0, lista.length, ...nueva.map((i) => ({ ...i }))); ed.pintar(); },
    /* Devuelve los insumos listos para guardar, o null y un mensaje si falta elegir alguno */
    resultado() {
      const out = [];
      for (const i of lista) {
        if (!i.producto_id) { if (i.dosis || i.nombre) return { error: `Elegí de la lista el insumo${i.nombre ? " «" + i.nombre + "»" : ""}. Si no está, usá "Crear un insumo nuevo".` }; continue; }
        const p = productoDe(i.producto_id);
        out.push({ producto_id: p.id, nombre: p.nombre, dosis: i.dosis, unidad: i.unidad, cantidad: +cantidadInsumo(i, ha()).cant.toFixed(3) });
      }
      return { insumos: out };
    },
    refrescarTotales() { cont.querySelectorAll("[data-k]").forEach((row) => totFila(row, lista[+row.dataset.k])); },
  };
  ed.pintar();
  return ed;
}
function costoLabor(l, precios = preciosProductos()) {
  let ins = 0, insFalta = 0;
  for (const i of l.insumos || []) {
    const q = i.cantidad != null ? Number(i.cantidad) : cantidadInsumo(i, l.superficie_ha).cant;
    const p = precios[i.producto_id];
    if (p != null) ins += p * q; else if (q) insFalta++;
  }
  const lab = conPrecio(l) && l.superficie_ha ? Number(l.costo_ha) * Number(l.superficie_ha) : null;
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
  const r = await Promise.all(Object.keys(S.d).map((t) => DB.listar(t).catch((e) => { if (t === "labores_tipo") { S.esquemaOk = false; return []; } throw e; })));
  Object.keys(S.d).forEach((t, i) => (S.d[t] = r[i]));
  for (const l of S.d.lotes) l.subs = l.subs || [];
  for (const p of S.d.productos) p.alias = p.alias || [];
  for (const p of S.d.proveedores) p.alias = p.alias || [];
  for (const c of S.d.comprobantes) c.remitos = c.remitos || [];
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
/* Clave para comparar nombres de empresas sin S.A., S.R.L., etc. */
function claveEmpresa(s) { return norm(s).replace(/\b(s ?a|s ?r ?l|s ?a ?s|s ?a ?c ?i|s ?c ?a|soc anon|sociedad anonima|srl|sa|sas|saci|y cia|hnos|hermanos|e hijos)\b/g, " ").replace(/\s+/g, " ").trim(); }
function buscarProveedor(nombre, cuit) {
  const c = soloDig(cuit); if (c.length >= 10) { const p = S.d.proveedores.find((x) => soloDig(x.cuit) === c || (x.alias || []).some((a) => soloDig(a.cuit) === c)); if (p) return p; }
  const n = claveEmpresa(nombre); if (!n) return null;
  return S.d.proveedores.find((p) => claveEmpresa(p.nombre) === n || (p.alias || []).some((a) => claveEmpresa(a.texto ?? a) === n)) || S.d.proveedores.find((p) => n.length > 4 && (claveEmpresa(p.nombre).includes(n) || n.includes(claveEmpresa(p.nombre)))) || null;
}
/* ---------- Control de remitos contra facturas ---------- */
const esFactura = (c) => c.tipo === "factura" || c.tipo === "nota_debito" || c.tipo === "nota_credito" || c.tipo === "otro";
/* Remito id → factura confirmada que lo incluye */
function remitosFacturados() { const m = new Map(); for (const f of S.d.comprobantes) if (f.estado === "confirmado" && esFactura(f)) for (const r of f.remitos || []) m.set(r, f); return m; }
const cantItems = (c, acc, sg = 1) => { for (const it of c.items || []) if (it.producto_id && !it.ignorar) acc[it.producto_id] = (acc[it.producto_id] || 0) + sg * (Number(it.cantidad) || 0); return acc; };
/* Diferencias de una factura contra sus remitos: {producto_id: {recibido, facturado, dif}} con dif != 0 */
function difFactura(f) {
  if (!(f.remitos || []).length) return {};
  const rec = {}; for (const id of f.remitos) { const r = S.d.comprobantes.find((x) => x.id === id && x.estado === "confirmado"); if (r) cantItems(r, rec); }
  const fac = cantItems(f, {}, f.tipo === "nota_credito" ? -1 : 1);
  const out = {}; for (const k of new Set([...Object.keys(rec), ...Object.keys(fac)])) { const d = (fac[k] || 0) - (rec[k] || 0); if (Math.abs(d) > 0.001) out[k] = { recibido: rec[k] || 0, facturado: fac[k] || 0, dif: d }; }
  return out;
}
/* Resumen de un proveedor: recibido vs facturado por insumo, remitos sin facturar y facturas con diferencias */
function controlProveedor(pid, campana) {
  const comps = S.d.comprobantes.filter((c) => c.proveedor_id === pid && c.estado === "confirmado" && c.tipo !== "ajuste" && (!campana || c.campana === campana));
  const fact = remitosFacturados(); const porIns = {};
  const add = (k, campo, q) => ((porIns[k] ??= { recibido: 0, facturado: 0 })[campo] += q);
  let netoUSD = 0, sinTC = 0;
  for (const c of comps) {
    const sg = c.tipo === "nota_credito" ? -1 : 1;
    for (const it of c.items || []) {
      if (esFactura(c)) { const u = aUSD((it.subtotal ?? (it.cantidad || 0) * (it.precio_unitario || 0)) * sg, c.moneda, c.tipo_cambio); if (u != null) netoUSD += u; else if (it.precio_unitario) sinTC++; }
      if (!it.producto_id || it.ignorar) continue;
      const q = Number(it.cantidad) || 0;
      if (c.tipo === "remito") add(it.producto_id, "recibido", q);
      else { add(it.producto_id, "facturado", sg * q); if (c.mueve_stock) add(it.producto_id, "recibido", sg * q); }
    }
  }
  const remitosPend = comps.filter((c) => c.tipo === "remito" && !fact.has(c.id)).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  const facturasDif = comps.filter((c) => esFactura(c) && Object.keys(difFactura(c)).length);
  const difIns = Object.entries(porIns).filter(([, a]) => Math.abs(a.facturado - a.recibido) > 0.001);
  return { comps, porIns, difIns, remitosPend, facturasDif, netoUSD, sinTC };
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
    <button class="big" data-ir="insumos">Insumos y stock del galpón</button>
    <button class="big" data-ir="proveedores">Proveedores y control de remitos</button>
    <button class="big" data-ir="catalogo">Catálogo de labores y precios</button>
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
        for (const t of ["lotes", "proveedores", "productos", "labores_tipo", "siembras", "comprobantes", "ordenes", "labores", "rindes"]) {
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
