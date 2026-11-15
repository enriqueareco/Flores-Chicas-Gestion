"use strict";
/* ============ Asistente: preguntas en lenguaje natural sobre los datos del campo ============
   La conversación va a la función "ia" (acción chat). Las herramientas se ejecutan acá, en el navegador,
   con los datos ya cargados: las cuentas salen de los datos del programa, no de la memoria del modelo. */
const Asis = {
  hist: [], burbujas: [], ocupado: false, el: null, reco: null,
  SUGERENCIAS: [
    "¿Cuántas hectáreas voy a fumigar con Clearsol según las órdenes abiertas?",
    "¿Qué me falta comprar para las órdenes abiertas?",
    "¿Cuánto glifosato hay en el galpón?",
    "¿Qué labores hizo cada contratista esta campaña y cuántas hectáreas?",
    "¿Cuánto llevo gastado por hectárea en el lote 12 Santa Clara Sur?",
  ],
  PASOS: {
    consultar_ordenes: "Buscando en las órdenes de trabajo", consultar_labores: "Buscando en las labores", consultar_lotes: "Mirando los lotes y cultivos",
    consultar_stock: "Mirando el stock del galpón", consultar_comprobantes: "Buscando en los comprobantes", consultar_proveedores: "Buscando proveedores",
    faltantes_ordenes: "Calculando lo que falta para las órdenes", consultar_precios_labores: "Mirando los precios de labores",
  },
};

/* ---------- Búsqueda tolerante de nombres ---------- */
const compacto = (s) => norm(s).replace(/ /g, "");
function coincideTokens(texto, q) {
  const t = norm(texto).split(" "), qs = norm(q).split(" ").filter((w) => w && w !== "lote" && w !== "el" && w !== "de");
  if (!qs.length) return true;
  return qs.every((w) => t.some((x) => x === w || (w.length >= 3 && /[a-z]/.test(w) && x.startsWith(w))));
}
/* Primero coincidencia exacta del nombre, después por palabras, después sin espacios */
function buscarEn(lista, q, textos) {
  if (!q) return lista;
  const n = norm(q).replace(/^lote /, "");
  const exactos = lista.filter((x) => textos(x).some((t) => norm(t) === n)); if (exactos.length) return exactos;
  const pal = lista.filter((x) => coincideTokens(textos(x).join(" "), q)); if (pal.length) return pal;
  const c = compacto(n); return c.length >= 2 ? lista.filter((x) => textos(x).some((t) => compacto(t).includes(c))) : [];
}
const textosProducto = (p) => [p.nombre, p.principio_activo || "", ...(p.alias || []).map((a) => a.texto ?? a)].filter(Boolean);
const buscarProductos = (q) => buscarEn(S.d.productos, q, textosProducto);
const buscarLotes = (q) => buscarEn(S.d.lotes, q, (l) => [l.nombre]);
const buscarProvs = (q) => buscarEn(S.d.proveedores, q, (p) => [p.nombre, ...(p.alias || []).map((a) => a.texto ?? a)]);
function parecidos(q, nombres, n = 5) {
  const tri = (s) => { const x = `  ${norm(s)} `; const o = new Set(); for (let i = 0; i < x.length - 2; i++) o.add(x.slice(i, i + 3)); return o; };
  const a = tri(q);
  return nombres.map((s) => { const b = tri(s); let k = 0; for (const t of a) if (b.has(t)) k++; return [s, k / (a.size + b.size - k)]; }).sort((x, y) => y[1] - x[1]).slice(0, n).filter((x) => x[1] > 0.1).map((x) => x[0]);
}
const r1 = (x, d = 1) => (x == null || !isFinite(x) ? null : +Number(x).toFixed(d));
const enRango = (f, desde, hasta) => (!desde || (f && f >= desde)) && (!hasta || (f && f <= hasta));
const cantIns = (i, ha) => (i.cantidad != null ? Number(i.cantidad) : cantidadInsumo(i, ha).cant);
const nombreIns = (i) => productoDe(i.producto_id)?.nombre || i.nombre || "Insumo";
const unidadIns = (i) => productoDe(i.producto_id)?.unidad || dosisABase(1, i.unidad)[1];
function noEncontrado(tipo, q, nombres) { return { aviso: `No encontré ningún ${tipo} que coincida con «${q}».`, parecidos: parecidos(q, nombres) }; }
/* Suma por insumo: hectáreas donde se usa y cantidad total */
function porProducto(trabajos, prods) {
  const t = {};
  for (const o of trabajos) for (const i of o.insumos || []) {
    if (prods && !prods.some((p) => p.id === i.producto_id)) continue;
    const k = i.producto_id || "n:" + norm(i.nombre); const a = (t[k] ??= { insumo: nombreIns(i), unidad: unidadIns(i), ha: 0, cantidad: 0, n: 0, refs: [] });
    a.ha += Number(o.superficie_ha) || 0; a.cantidad += cantIns(i, o.superficie_ha) || 0; a.n++; a.refs.push(o.numero ?? o.fecha);
  }
  return Object.values(t).map((a) => ({ insumo: a.insumo, unidad: a.unidad, ha: r1(a.ha), cantidad: r1(a.cantidad, 2), veces: a.n, en: a.refs })).sort((a, b) => b.ha - a.ha);
}

/* ---------- Herramientas ---------- */
const AsisHerr = {
  consultar_ordenes({ estado = "abiertas", producto, lote, labor, contratista, desde, hasta } = {}) {
    const est = estado === "abiertas" ? ["pendiente", "en_curso"] : estado === "todas" ? null : [estado];
    const prods = producto ? buscarProductos(producto) : null; if (producto && !prods.length) return noEncontrado("insumo", producto, S.d.productos.map((p) => p.nombre));
    const lts = lote ? buscarLotes(lote) : null; if (lote && !lts.length) return noEncontrado("lote", lote, S.d.lotes.map((l) => l.nombre));
    const os = S.d.ordenes.filter((o) => (!est || est.includes(o.estado)) && (!lts || lts.some((l) => l.id === o.lote_id)) && (!labor || coincideTokens(nombreLabor(o) + " " + (o.tipo || ""), labor))
      && (!contratista || coincideTokens(o.contratista || proveedorDe(o.contratista_id)?.nombre || "", contratista)) && enRango(o.fecha_prevista, desde, hasta)
      && (!prods || (o.insumos || []).some((i) => prods.some((p) => p.id === i.producto_id)))).sort((a, b) => (a.numero || 0) - (b.numero || 0));
    return {
      criterio: { estado, producto: prods?.map((p) => p.nombre), lote: lts?.map((l) => l.nombre), labor, contratista, desde, hasta },
      ordenes: os.map((o) => ({ numero: o.numero, estado: o.estado, fecha_prevista: o.fecha_prevista, lote: nombreUbic(o.lote_id, o.sub_id), sector: loteDe(o.lote_id) ? sectorDe(loteDe(o.lote_id)) : null, labor: nombreLabor(o), contratista: o.contratista || proveedorDe(o.contratista_id)?.nombre || null, ha: r1(o.superficie_ha),
        insumos: (o.insumos || []).map((i) => ({ insumo: nombreIns(i), dosis: i.dosis, unidad_dosis: i.unidad, cantidad: r1(cantIns(i, o.superficie_ha), 2), unidad: unidadIns(i) })) })),
      totales: { ordenes: os.length, ha: r1(os.reduce((s, o) => s + (Number(o.superficie_ha) || 0), 0)) },
      por_insumo: porProducto(os, prods),
    };
  },
  consultar_labores({ campana, desde, hasta, producto, lote, labor, contratista } = {}) {
    const camp = campana === "todas" ? null : campana || (desde || hasta ? null : S.campana);
    const prods = producto ? buscarProductos(producto) : null; if (producto && !prods.length) return noEncontrado("insumo", producto, S.d.productos.map((p) => p.nombre));
    const lts = lote ? buscarLotes(lote) : null; if (lote && !lts.length) return noEncontrado("lote", lote, S.d.lotes.map((l) => l.nombre));
    const precios = preciosProductos();
    const ls = S.d.labores.filter((l) => (!camp || l.campana === camp) && enRango(l.fecha, desde, hasta) && (!lts || lts.some((x) => x.id === l.lote_id)) && (!labor || coincideTokens(nombreLabor(l) + " " + (l.tipo || ""), labor))
      && (!contratista || coincideTokens(l.contratista || proveedorDe(l.contratista_id)?.nombre || "", contratista)) && (!prods || (l.insumos || []).some((i) => prods.some((p) => p.id === i.producto_id))))
      .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
    let cl = 0, ci = 0, sinPrecio = 0; const porLab = {}, porCont = {};
    const filas = ls.map((l) => {
      const c = costoLabor(l, precios); cl += c.labor || 0; ci += c.insumosUSD || 0; if (c.labor == null) sinPrecio++;
      const ha = Number(l.superficie_ha) || 0; const nl = nombreLabor(l); const ct = l.contratista || proveedorDe(l.contratista_id)?.nombre || "Sin contratista";
      (porLab[nl] ??= { ha: 0, veces: 0 }); porLab[nl].ha += ha; porLab[nl].veces++;
      (porCont[ct] ??= { ha: 0, labores: 0 }); porCont[ct].ha += ha; porCont[ct].labores++;
      return { fecha: l.fecha, lote: nombreUbic(l.lote_id, l.sub_id), labor: nl, contratista: ct, ha: r1(ha), insumos: (l.insumos || []).map((i) => ({ insumo: nombreIns(i), dosis: i.dosis, unidad_dosis: i.unidad, cantidad: r1(cantIns(i, l.superficie_ha), 2), unidad: unidadIns(i) })),
        costo_labor_usd: r1(c.labor, 0), costo_insumos_usd: r1(c.insumosUSD, 0), precio_labor: l.costo_estado === "a_definir" ? "a definir" : c.labor == null ? "sin precio" : "ok" };
    });
    return {
      criterio: { campana: camp || "todas", desde, hasta, producto: prods?.map((p) => p.nombre), lote: lts?.map((l) => l.nombre), labor, contratista },
      labores: filas.slice(-150), nota: filas.length > 150 ? `Se muestran las últimas 150 de ${filas.length}; los totales son de todas.` : undefined,
      totales: { labores: ls.length, ha: r1(ls.reduce((s, l) => s + (Number(l.superficie_ha) || 0), 0)), costo_labores_usd: r1(cl, 0), costo_insumos_usd: r1(ci, 0), costo_total_usd: r1(cl + ci, 0), labores_sin_precio: sinPrecio },
      por_labor: Object.entries(porLab).map(([k, v]) => ({ labor: k, ha: r1(v.ha), veces: v.veces })),
      por_contratista: Object.entries(porCont).map(([k, v]) => ({ contratista: k, ha: r1(v.ha), labores: v.labores })),
      por_insumo: porProducto(ls, prods),
    };
  },
  consultar_lotes({ nombre, sector, cultivo, campana } = {}) {
    const camp = campana || S.campana;
    let ls = nombre ? buscarLotes(nombre) : S.d.lotes; if (nombre && !ls.length) return noEncontrado("lote", nombre, S.d.lotes.map((l) => l.nombre));
    if (sector) ls = ls.filter((l) => coincideTokens(sectorDe(l) || "", sector));
    const filas = ls.map((l) => {
      const cs = cultivosDe(l, undefined, camp).map((s) => ({ cultivo: s.cultivo, variedad: s.hibrido || null, fecha_siembra: s.fecha || null, en: s.sub_id ? nombreUbic(l.id, s.sub_id) : "todo el lote", ha: r1(s.sub_id ? haUbic(l.id, s.sub_id) : haDe(l.geom)), sigue_de: s.heredado ? s.desde_campana : undefined }));
      return { lote: l.nombre, sector: sectorDe(l), ha: r1(haDe(l.geom)), cultivos: cs, subdivisiones: (l.subs || []).map((s) => ({ nombre: s.nombre, ha: r1(haDe(s.geom)) })) };
    }).filter((f) => !cultivo || f.cultivos.some((c) => coincideTokens(c.cultivo, cultivo)));
    const porC = {}; for (const f of filas) for (const c of f.cultivos) porC[c.cultivo] = (porC[c.cultivo] || 0) + (c.ha || 0);
    return { campana: camp, lotes: filas.length > 130 ? filas.map(({ subdivisiones, ...x }) => x) : filas, totales: { lotes: filas.length, ha: r1(filas.reduce((s, f) => s + (f.ha || 0), 0)) }, ha_por_cultivo: Object.entries(porC).map(([k, v]) => ({ cultivo: k, ha: r1(v) })).sort((a, b) => b.ha - a.ha) };
  },
  consultar_stock({ producto, tipo } = {}) {
    let ps = producto ? buscarProductos(producto) : S.d.productos; if (producto && !ps.length) return noEncontrado("insumo", producto, S.d.productos.map((p) => p.nombre));
    if (tipo) ps = ps.filter((p) => coincideTokens(p.tipo || "", tipo));
    const st = stockProductos(); const pr = preciosDetalle();
    const filas = ps.map((p) => { const s = st[p.id] || { entra: 0, sale: 0, ordenes: 0 }; const hay = s.entra - s.sale; const pu = pr[p.id]?.usd;
      return { insumo: p.nombre, tipo: p.tipo, unidad: p.unidad, principio_activo: p.principio_activo || null, en_galpon: r1(hay, 2), comprometido_en_ordenes_abiertas: r1(s.ordenes, 2), disponible_despues_de_ordenes: r1(hay - s.ordenes, 2), precio_usd: r1(pu, 2), valor_usd: pu != null ? r1(Math.max(0, hay) * pu, 0) : null }; })
      .filter((f) => producto || tipo || f.en_galpon || f.comprometido_en_ordenes_abiertas).sort((a, b) => (a.tipo || "").localeCompare(b.tipo || "") || a.insumo.localeCompare(b.insumo));
    return { insumos: filas, valor_total_usd: r1(filas.reduce((s, f) => s + (f.valor_usd || 0), 0), 0) };
  },
  consultar_comprobantes({ proveedor, tipo, desde, hasta, producto, estado } = {}) {
    const prods = producto ? buscarProductos(producto) : null; if (producto && !prods.length) return noEncontrado("insumo", producto, S.d.productos.map((p) => p.nombre));
    const pv = proveedor ? buscarProvs(proveedor) : null;
    const cs = S.d.comprobantes.filter((c) => c.tipo !== "ajuste" && (!tipo || c.tipo === tipo) && (!estado || c.estado === estado) && enRango(c.fecha, desde, hasta)
      && (!proveedor || (pv.length ? pv.some((p) => p.id === c.proveedor_id) : coincideTokens(c.proveedor_nombre || "", proveedor)))
      && (!prods || (c.items || []).some((i) => prods.some((p) => p.id === i.producto_id)))).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
    const fact = remitosFacturados();
    return {
      comprobantes: cs.slice(-100).map((c) => ({ fecha: c.fecha, tipo: c.tipo, numero: [c.letra, c.numero].filter(Boolean).join(" ") || null, proveedor: c.proveedor_nombre, estado: c.estado, moneda: c.tipo === "remito" ? undefined : c.moneda, total: c.tipo === "remito" ? undefined : c.total,
        facturado: c.tipo === "remito" && c.estado === "confirmado" ? fact.has(c.id) : undefined,
        items: (c.items || []).filter((i) => !i.ignorar).map((i) => ({ insumo: productoDe(i.producto_id)?.nombre || i.descripcion, cantidad: i.cantidad, unidad: i.unidad, precio_unitario: c.tipo === "remito" ? undefined : i.precio_unitario })) })),
      nota: cs.length > 100 ? `Se muestran los últimos 100 de ${cs.length}.` : undefined, total_comprobantes: cs.length,
    };
  },
  consultar_proveedores({ nombre } = {}) {
    const ps = nombre ? buscarProvs(nombre) : S.d.proveedores; if (nombre && !ps.length) return noEncontrado("proveedor", nombre, S.d.proveedores.map((p) => p.nombre));
    return { proveedores: ps.map((p) => {
      const ls = S.d.labores.filter((l) => l.contratista_id === p.id || (l.contratista && claveEmpresa(l.contratista) === claveEmpresa(p.nombre)));
      const pl = {}; for (const l of ls) { const k = `${l.campana} · ${nombreLabor(l)}`; pl[k] = (pl[k] || 0) + (Number(l.superficie_ha) || 0); }
      const cs = S.d.comprobantes.filter((c) => c.proveedor_id === p.id);
      return { nombre: p.nombre, tipo: p.tipo, cuit: p.cuit || null, telefono: p.telefono || null, otros_nombres: (p.alias || []).map((a) => a.texto ?? a), labores_ha: Object.entries(pl).map(([k, v]) => ({ campana_labor: k, ha: r1(v) })), comprobantes: cs.length, ultimo_comprobante: cs.map((c) => c.fecha).filter(Boolean).sort().pop() || null };
    }) };
  },
  faltantes_ordenes() {
    const ids = new Set(S.d.ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").map((o) => o.id));
    return { ordenes_abiertas: ids.size, insumos: Pedido.calcular(ids).map((r) => ({ insumo: r.p.nombre, unidad: r.p.unidad, necesitan_las_ordenes: r1(r.necesita, 2), hay_en_galpon: r1(Math.max(0, r.hay), 2), falta: r1(r.falta, 2), ordenes: r.ordenes })) };
  },
  consultar_precios_labores() {
    return { labores: S.d.labores_tipo.filter((t) => t.activo !== false).map((t) => { const p = precioCatalogo(t); return { labor: t.nombre, categoria: t.categoria, precio_usd_ha: p?.precio ?? null, rige_desde: p?.desde || null, historial: (t.precios || []).map((x) => ({ precio: x.precio, desde: x.desde || null })) }; }) };
  },
};
const ASIS_TOOLS = [
  { name: "consultar_ordenes", description: "Órdenes de trabajo (labores a hacer) con lote, labor, hectáreas, insumos con dosis y cantidad total. Devuelve totales y, por insumo, en cuántas hectáreas se usa y cuánto hace falta. Usala para preguntas sobre lo que se va a hacer o fumigar.",
    input_schema: { type: "object", properties: { estado: { type: "string", enum: ["abiertas", "pendiente", "en_curso", "realizada", "cancelada", "todas"], description: "abiertas = pendientes o en curso (por defecto)" }, producto: { type: "string", description: "Nombre, marca o principio activo del insumo" }, lote: { type: "string" }, labor: { type: "string", description: "Ej. pulverización, siembra, disco" }, contratista: { type: "string" }, desde: { type: "string", description: "Fecha prevista desde, AAAA-MM-DD" }, hasta: { type: "string" } } } },
  { name: "consultar_labores", description: "Labores realizadas con fecha, lote, contratista, hectáreas, insumos y costos en US$. Devuelve totales, hectáreas por labor, por contratista y por insumo. Por defecto la campaña actual.",
    input_schema: { type: "object", properties: { campana: { type: "string", description: "Ej. 2026/27, o 'todas'" }, desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string" }, producto: { type: "string" }, lote: { type: "string" }, labor: { type: "string" }, contratista: { type: "string" } } } },
  { name: "consultar_lotes", description: "Lotes con sector, hectáreas, subdivisiones y cultivos de la campaña (variedad, fecha de siembra). Devuelve hectáreas por cultivo.",
    input_schema: { type: "object", properties: { nombre: { type: "string" }, sector: { type: "string", description: "Santa Clara Sur, Santa Clara Norte o Flores Chicas" }, cultivo: { type: "string" }, campana: { type: "string" } } } },
  { name: "consultar_stock", description: "Stock del galpón por insumo, lo comprometido en órdenes abiertas, lo disponible, precio y valor en US$.",
    input_schema: { type: "object", properties: { producto: { type: "string" }, tipo: { type: "string", description: "herbicida, fertilizante, semilla, coadyuvante, etc." } } } },
  { name: "consultar_comprobantes", description: "Remitos, facturas y notas de crédito de proveedores, con sus renglones; en remitos indica si ya fueron facturados.",
    input_schema: { type: "object", properties: { proveedor: { type: "string" }, tipo: { type: "string", enum: ["remito", "factura", "nota_credito", "nota_debito", "otro"] }, estado: { type: "string", enum: ["borrador", "confirmado"] }, desde: { type: "string" }, hasta: { type: "string" }, producto: { type: "string" } } } },
  { name: "consultar_proveedores", description: "Proveedores y contratistas con CUIT, teléfono, hectáreas de cada labor que hicieron por campaña y cantidad de comprobantes.",
    input_schema: { type: "object", properties: { nombre: { type: "string" } } } },
  { name: "faltantes_ordenes", description: "Para todas las órdenes abiertas: cuánto necesitan de cada insumo, cuánto hay en el galpón y cuánto falta comprar.", input_schema: { type: "object", properties: {} } },
  { name: "consultar_precios_labores", description: "Precios por hectárea de cada labor del catálogo (US$/ha) y desde cuándo rigen.", input_schema: { type: "object", properties: {} } },
];

/* ---------- Conversación ---------- */
Asis.sistema = () => `Sos el asistente del programa de gestión agrícola de Flores Chicas (Lobería, provincia de Buenos Aires). Respondés preguntas del equipo sobre los datos cargados: lotes y cultivos, órdenes de trabajo, labores, insumos y stock del galpón, comprobantes, proveedores y precios de labores.
- Buscá siempre los datos con las herramientas; no inventes cifras. Para sumas y totales usá los totales que devuelven las herramientas.
- Si un nombre no aparece, la herramienta te sugiere parecidos: usá el que corresponda o preguntá.
- Si la pregunta es ambigua (por ejemplo, órdenes abiertas o todas, campaña), tomá lo más razonable y aclaralo en una línea.
- "Fumigar", "pulverizar" o "aplicar" son labores de pulverización. Órdenes abiertas = pendientes o en curso. Las cantidades de órdenes y labores ya están calculadas (dosis × hectáreas).
- Respondé en español rioplatense, breve y directo: primero la respuesta con el número en **negrita**, después el detalle justo (por ejemplo, la lista de órdenes o lotes). Usá viñetas para listas y una tabla chica solo si ayuda. Hectáreas con un decimal; montos en US$.
Hoy es ${hoy()}. La campaña actual es ${S.campana} (de julio a junio). Los sectores del campo son Santa Clara Sur, Santa Clara Norte y Flores Chicas.`;

Asis.recortar = () => {
  /* Conserva las últimas preguntas completas (no corta un pedido de herramienta de su respuesta) */
  while (Asis.hist.length > 40) { const i = Asis.hist.findIndex((m, k) => k > 0 && m.role === "user" && typeof m.content === "string"); if (i <= 0) break; Asis.hist = Asis.hist.slice(i); }
};
Asis.preguntar = async (texto) => {
  texto = String(texto || "").trim(); if (!texto || Asis.ocupado) return;
  Asis.ocupado = true; Asis.burbujas.push({ quien: "yo", texto }); Asis.hist.push({ role: "user", content: texto }); Asis.recortar();
  const paso = { quien: "paso", texto: "Pensando…" }; Asis.burbujas.push(paso); Asis.pintar();
  try {
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      const r = await DB.ia("chat", { sistema: Asis.sistema(), herramientas: ASIS_TOOLS, mensajes: Asis.hist });
      Asis.hist.push({ role: "assistant", content: r.content });
      const usos = (r.content || []).filter((c) => c.type === "tool_use");
      if (!usos.length || r.stop_reason !== "tool_use") {
        const txt = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        Asis.burbujas.splice(Asis.burbujas.indexOf(paso), 1); Asis.burbujas.push({ quien: "asis", texto: txt || "No encontré una respuesta. Probá preguntarlo de otra forma." });
        break;
      }
      paso.texto = [...new Set(usos.map((u) => Asis.PASOS[u.name] || "Buscando"))].join(" · ") + "…"; Asis.pintar();
      Asis.hist.push({ role: "user", content: usos.map((u) => {
        let res; try { const f = AsisHerr[u.name]; res = f ? f(u.input || {}) : { error: "Herramienta desconocida" }; } catch (e) { console.error(e); res = { error: e.message }; }
        let s = JSON.stringify(res, (k, v) => (v === null || v === undefined ? undefined : v)); if (s.length > 60000) s = s.slice(0, 60000) + '…"(recortado)"';
        return { type: "tool_result", tool_use_id: u.id, content: s };
      }) });
      if (vuelta === 7) { Asis.burbujas.splice(Asis.burbujas.indexOf(paso), 1); Asis.burbujas.push({ quien: "asis", texto: "La consulta necesitó demasiados pasos. Probá con una pregunta más concreta." }); }
    }
  } catch (e) {
    console.error(e); Asis.burbujas.splice(Asis.burbujas.indexOf(paso), 1);
    /* Saca la pregunta que falló del historial para que la conversación siga sana */
    const i = Asis.hist.map((m) => m.role === "user" && typeof m.content === "string").lastIndexOf(true); if (i >= 0) Asis.hist = Asis.hist.slice(0, i);
    Asis.burbujas.push({ quien: "error", texto: /Acción desconocida/.test(e.message) ? "Falta actualizar la función «ia» en Supabase para usar el asistente." : "No pude responder: " + e.message });
  } finally { Asis.ocupado = false; Asis.pintar(); }
};

/* Markdown mínimo: negrita, listas, tablas y párrafos */
Asis.md = (t) => {
  const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const ls = String(t).split("\n"); let h = "", i = 0;
  while (i < ls.length) {
    const l = ls[i];
    if (/^\s*\|.*\|\s*$/.test(l)) { const filas = []; while (i < ls.length && /^\s*\|.*\|\s*$/.test(ls[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(ls[i])) filas.push(ls[i].trim().slice(1, -1).split("|").map((c) => c.trim())); i++; }
      h += `<div class="tablewrap"><table class="t">${filas.map((f, k) => `<tr>${f.map((c) => (k ? `<td${/^[\d.,\s%$US-]+(ha|L|kg|u)?$/.test(c) ? ' class="num right"' : ""}>${inl(c)}</td>` : `<th>${inl(c)}</th>`)).join("")}</tr>`).join("")}</table></div>`; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) { const ord = /^\s*\d/.test(l); const it = []; while (i < ls.length && /^\s*([-*•]|\d+[.)])\s+/.test(ls[i])) { it.push(ls[i].replace(/^\s*([-*•]|\d+[.)])\s+/, "")); i++; } h += `<${ord ? "ol" : "ul"}>${it.map((x) => `<li>${inl(x)}</li>`).join("")}</${ord ? "ol" : "ul"}>`; continue; }
    if (/^#{1,6}\s/.test(l)) { h += `<p><b>${inl(l.replace(/^#+\s*/, ""))}</b></p>`; i++; continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < ls.length && ls[i].trim() && !/^\s*([-*•]|\d+[.)])\s+|^\s*\||^#{1,6}\s/.test(ls[i])) { p.push(inl(ls[i])); i++; } h += `<p>${p.join("<br>")}</p>`;
  }
  return h;
};

/* ---------- Panel ---------- */
Asis.crear = () => {
  if (Asis.el) return;
  const el = document.createElement("aside"); el.className = "chat"; el.id = "chat"; el.hidden = true; el.setAttribute("aria-label", "Asistente");
  el.innerHTML = `<div class="chat-head"><div><b>Asistente</b><div class="small muted">Preguntá sobre lotes, órdenes, labores, stock y proveedores</div></div><span class="row" style="gap:4px"><button class="ghost small" id="chNueva">Nueva charla</button><button class="ghost small" id="chCerrar" aria-label="Cerrar el asistente">✕</button></span></div>
    <div class="chat-msgs" id="chMsgs" aria-live="polite"></div>
    <form class="chat-in" id="chForm"><textarea id="chTxt" rows="1" placeholder="Escribí tu pregunta…" aria-label="Pregunta"></textarea><button type="button" class="ghost" id="chMic" title="Dictar la pregunta" aria-label="Dictar la pregunta" hidden>🎤</button><button class="primary" id="chEnv">Enviar</button></form>`;
  document.body.appendChild(el); Asis.el = el;
  const $ = (q) => el.querySelector(q); const txt = $("#chTxt");
  const ajustar = () => { txt.style.height = "auto"; txt.style.height = Math.min(140, txt.scrollHeight) + "px"; };
  txt.oninput = ajustar;
  txt.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chForm").requestSubmit(); } };
  $("#chForm").onsubmit = (e) => { e.preventDefault(); const t = txt.value; if (!t.trim() || Asis.ocupado) return; txt.value = ""; ajustar(); Asis.preguntar(t); };
  $("#chCerrar").onclick = () => Asis.cerrar();
  $("#chNueva").onclick = () => { if (Asis.ocupado) return; Asis.hist = []; Asis.burbujas = []; Asis.pintar(); txt.focus(); };
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") Asis.cerrar(); });
  /* Dictado por voz, si el navegador lo permite */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const mic = $("#chMic"); mic.hidden = false;
    mic.onclick = () => {
      if (Asis.reco) { Asis.reco.stop(); return; }
      const r = new SR(); r.lang = "es-AR"; r.interimResults = true; r.continuous = false; const base = txt.value ? txt.value.trim() + " " : "";
      r.onresult = (ev) => { txt.value = base + [...ev.results].map((x) => x[0].transcript).join(""); ajustar(); };
      r.onend = () => { Asis.reco = null; mic.classList.remove("on"); };
      r.onerror = (ev) => { if (ev.error !== "aborted" && ev.error !== "no-speech") toast("No pude usar el micrófono: " + ev.error); };
      Asis.reco = r; mic.classList.add("on"); r.start();
    };
  }
  Asis.pintar();
};
Asis.pintar = () => {
  const box = Asis.el?.querySelector("#chMsgs"); if (!box) return;
  box.innerHTML = Asis.burbujas.length ? Asis.burbujas.map((b) => b.quien === "yo" ? `<div class="msg yo">${esc(b.texto)}</div>`
      : b.quien === "paso" ? `<div class="msg paso"><span class="spin"></span> ${esc(b.texto)}</div>`
      : b.quien === "error" ? `<div class="msg asis"><div class="aviso">${esc(b.texto)}</div></div>` : `<div class="msg asis">${Asis.md(b.texto)}</div>`).join("")
    : `<div class="chat-vacio"><div class="small muted">Algunas preguntas para empezar:</div>${Asis.SUGERENCIAS.map((s) => `<button class="sug" type="button">${esc(s)}</button>`).join("")}<div class="small muted">Las respuestas salen de los datos cargados en el programa.</div></div>`;
  box.querySelectorAll(".sug").forEach((b) => (b.onclick = () => Asis.preguntar(b.textContent)));
  const env = Asis.el.querySelector("#chEnv"); env.disabled = Asis.ocupado;
  box.scrollTop = box.scrollHeight;
};
Asis.abrir = () => { Asis.crear(); Asis.el.hidden = false; document.body.classList.add("con-chat"); setTimeout(() => Asis.el.querySelector("#chTxt").focus(), 50); setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 250); };
Asis.cerrar = () => { if (!Asis.el) return; Asis.el.hidden = true; document.body.classList.remove("con-chat"); if (Asis.reco) Asis.reco.stop(); setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 250); };
document.getElementById("btnChat").onclick = () => (Asis.el && !Asis.el.hidden ? Asis.cerrar() : Asis.abrir());
