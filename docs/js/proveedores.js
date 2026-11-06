"use strict";
/* ============ Proveedores de insumos y de labores, con control de remitos contra facturas ============ */
const TIPO_PROV = { proveedor: "Insumos", contratista: "Labores", ambos: "Insumos y labores" };

const Proveedores = {
  detalle(p) {
    const f = S.filtroProv || {}; const camp = f.todas ? null : S.campana;
    const ctl = controlProveedor(p.id, camp);
    const fact = remitosFacturados();
    const esDe = (l) => l.contratista_id === p.id || (!l.contratista_id && l.contratista && claveEmpresa(l.contratista) === claveEmpresa(p.nombre));
    const labs = S.d.labores.filter((l) => esDe(l) && (!camp || l.campana === camp)).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const insumos = p.tipo !== "contratista" || ctl.comps.some((c) => (c.items || []).some((i) => i.producto_id));
    let labUSD = 0, labARS = 0, labHa = 0, aDef = 0; const porLabor = {};
    for (const l of labs) { const c = costoLabor(l); labHa += Number(l.superficie_ha) || 0; if (c.labor != null) { if (c.moneda === "ARS") labARS += c.labor; else labUSD += c.labor; } else aDef++; const k = nombreLabor(l); const a = (porLabor[k] ??= { n: 0, ha: 0, usd: 0, ars: 0, def: 0 }); a.n++; a.ha += Number(l.superficie_ha) || 0; if (c.labor == null) a.def++; else if (c.moneda === "ARS") a.ars += c.labor; else a.usd += c.labor; }
    const comps = [...ctl.comps].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    modal(`<div class="row" style="justify-content:space-between;align-items:flex-start"><div><h4>${esc(p.nombre)}</h4><div class="small muted">${TIPO_PROV[p.tipo] || ""}${p.cuit ? " · CUIT " + esc(p.cuit) : ""}${p.telefono ? " · " + esc(p.telefono) : ""}</div></div><label class="row small"><input type="checkbox" id="pvCamp" ${camp ? "" : "checked"}> Todas las campañas</label></div>
      ${(p.alias || []).length ? `<div class="small"><span class="lbl">También figura como</span> ${p.alias.map((a) => `<span class="chip">${esc(a.texto ?? a)}</span>`).join(" ")}</div>` : ""}
      <div class="stats"><div><span>Facturado neto</span><b class="num">${fmtM(ctl.netoUSD, "USD")}</b>${ctl.sinTC ? `<em class="small muted" style="display:block;font-style:normal">${ctl.sinTC} renglones en pesos sin tipo de cambio</em>` : ""}</div><div><span>Remitos sin facturar</span><b class="num">${ctl.remitosPend.length}</b></div><div><span>Facturas con diferencias</span><b class="num">${ctl.facturasDif.length}</b></div></div>
      ${labs.length || p.tipo !== "proveedor" ? `<h2>Labores que hizo${camp ? " en " + esc(camp) : ""}</h2>
        ${labs.length ? `<div class="tablewrap"><table class="t"><tr><th>Labor</th><th class="right">Veces</th><th class="right">ha</th><th class="right">Valor</th></tr>${Object.entries(porLabor).sort((a, b) => b[1].ha - a[1].ha).map(([k, a]) => `<tr><td><b>${esc(k)}</b></td><td class="num right">${a.n}</td><td class="num right">${fmt(a.ha, 1)}</td><td class="num right">${a.usd || !a.ars ? fmtM(a.usd, "USD") : ""}${a.ars ? (a.usd ? "<br>" : "") + fmtM(a.ars, "ARS") : ""}${a.def ? `<div class="small muted">${a.def} a definir</div>` : ""}</td></tr>`).join("")}<tr><td><b>Total</b></td><td class="num right"><b>${labs.length}</b></td><td class="num right"><b>${fmt(labHa, 1)}</b></td><td class="num right"><b>${labUSD || !labARS ? fmtM(labUSD, "USD") : ""}${labARS ? (labUSD ? "<br>" : "") + fmtM(labARS, "ARS") : ""}</b></td></tr></table></div>
          <details><summary class="small" style="cursor:pointer">Ver cada labor (${labs.length})</summary><div class="tablewrap" style="max-height:300px;overflow:auto;margin-top:6px"><table class="t"><tr><th>Fecha</th><th>Lote</th><th>Labor</th><th class="right">ha</th><th class="right">Precio/ha</th></tr>${labs.map((l) => `<tr class="click" data-l="${l.id}"><td class="num">${fechaAR(l.fecha)}</td><td>${esc(nombreUbic(l.lote_id, l.sub_id))}</td><td>${esc(nombreLabor(l))}</td><td class="num right">${fmt(l.superficie_ha, 1)}</td><td class="num right">${conPrecio(l) ? fmtM(l.costo_ha, l.moneda, 2) : '<span class="pill warn">a definir</span>'}</td></tr>`).join("")}</table></div></details>
          <div class="small">Valor según los precios cargados <b class="num">${labUSD || !labARS ? fmtM(labUSD, "USD") : ""}${labARS ? (labUSD ? " + " : "") + fmtM(labARS, "ARS") : ""}</b>${aDef ? ` (${aDef} con precio a definir)` : ""} · Facturado <b class="num">${fmtM(ctl.netoUSD, "USD")}</b>.</div>` : `<div class="empty">Sin labores cargadas con este contratista${camp ? " en esta campaña" : ""}.</div>`}` : ""}
      ${insumos ? `<h2>Recibido contra facturado</h2>
        ${Object.keys(ctl.porIns).length ? `<div class="tablewrap"><table class="t"><tr><th>Insumo</th><th class="right">Recibido</th><th class="right">Facturado</th><th class="right">Diferencia</th></tr>${Object.entries(ctl.porIns).sort((a, b) => (productoDe(a[0])?.nombre || "").localeCompare(productoDe(b[0])?.nombre || "")).map(([k, a]) => { const d = a.facturado - a.recibido; const pr = productoDe(k); return `<tr><td>${esc(pr?.nombre || "")}</td><td class="num right">${fmt(a.recibido, 1)} ${esc(pr?.unidad || "")}</td><td class="num right">${fmt(a.facturado, 1)} ${esc(pr?.unidad || "")}</td><td class="num right">${Math.abs(d) < 0.001 ? '<span class="pill ok">OK</span>' : `<span class="pill ${d > 0 ? "bad" : "warn"}">${d > 0 ? "+" : ""}${fmt(d, 1)}</span><div class="small muted">${d > 0 ? "facturado sin recibir" : "recibido sin facturar"}</div>`}</td></tr>`; }).join("")}</table></div>
          <div class="small muted">Recibido = remitos + facturas que ingresaron mercadería al galpón. Facturado = facturas y notas de débito, menos notas de crédito.</div>` : `<div class="empty">Sin remitos ni facturas de insumos${camp ? " en esta campaña" : ""}.</div>`}
        ${ctl.remitosPend.length ? `<h2>Remitos sin facturar</h2><div class="tablewrap"><table class="t">${ctl.remitosPend.map((r) => `<tr class="click" data-c="${r.id}"><td class="num">${fechaAR(r.fecha)}</td><td class="num">${esc(r.numero || "s/n")}</td><td class="small">${(r.items || []).filter((i) => i.producto_id).map((i) => `${esc(productoDe(i.producto_id)?.nombre || "")} ${fmt(i.cantidad, 1)}`).join(", ")}</td></tr>`).join("")}</table></div>` : ""}` : ""}
      <h2>Comprobantes</h2>
      ${comps.length ? `<div class="tablewrap" style="max-height:260px;overflow:auto"><table class="t"><tr><th>Fecha</th><th>Comprobante</th><th class="right">Total</th><th>Control</th></tr>${comps.map((c) => `<tr class="click" data-c="${c.id}"><td class="num">${fechaAR(c.fecha)}</td><td>${esc(nombreTipoComp(c.tipo))} <span class="num small">${esc(c.numero || "")}</span></td><td class="num right">${c.total != null ? fmtM(c.total, c.moneda, 2) : "—"}</td><td>${pillControl(c, fact)}</td></tr>`).join("")}</table></div>` : `<div class="empty">Sin comprobantes confirmados${camp ? " en esta campaña" : ""}.</div>`}
      <div class="pie"><button id="pvEdit" style="margin-right:auto">Editar datos</button><button id="mNo">Cerrar</button></div>`, (m, close) => {
      m.querySelector("#mNo").onclick = close;
      m.querySelector("#pvEdit").onclick = () => { close(); Insumos.formProveedor(p, () => { refrescar(); Proveedores.detalle(proveedorDe(p.id)); }); };
      m.querySelectorAll("[data-c]").forEach((tr) => (tr.onclick = () => { close(); Comprobantes.revisar(S.d.comprobantes.find((c) => c.id === tr.dataset.c)); }));
      m.querySelectorAll("[data-l]").forEach((tr) => (tr.onclick = () => { close(); Labores.form(S.d.labores.find((l) => l.id === tr.dataset.l)); }));
      const cc = m.querySelector("#pvCamp"); if (cc) cc.onchange = () => { (S.filtroProv ??= {}).todas = cc.checked; close(); Proveedores.detalle(p); };
    }, "medio");
  },
};

/* Estado de control de un comprobante: remito facturado o no; factura que coincide o no con sus remitos */
function pillControl(c, fact = remitosFacturados()) {
  if (c.estado !== "confirmado") return "";
  if (c.tipo === "remito") return fact.has(c.id) ? '<span class="pill ok">Facturado</span>' : '<span class="pill warn">Sin facturar</span>';
  if (esFactura(c) && (c.remitos || []).length) return Object.keys(difFactura(c)).length ? '<span class="pill bad">Diferencia</span>' : '<span class="pill ok">Coincide</span>';
  if (esFactura(c) && c.mueve_stock && (c.items || []).some((i) => i.producto_id)) return '<span class="pill mut">Ingresó con la factura</span>';
  return "";
}

Vistas.proveedores = function () {
  const el = document.getElementById("v-proveedores");
  const f = S.filtroProv || (S.filtroProv = { tipo: "", todas: false, q: "" });
  const camp = f.todas ? null : S.campana;
  const lista = S.d.proveedores.filter((p) => (!f.tipo || p.tipo === f.tipo || p.tipo === "ambos") && (!f.q || norm(p.nombre + " " + (p.cuit || "") + " " + (p.alias || []).map((a) => a.texto ?? a).join(" ")).includes(norm(f.q)))).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const ctls = new Map(lista.map((p) => [p.id, controlProveedor(p.id, camp)]));
  const totPend = [...ctls.values()].reduce((a, c) => a + c.remitosPend.length, 0), totDif = [...ctls.values()].reduce((a, c) => a + c.facturasDif.length, 0);
  const haLab = (id) => { const p = proveedorDe(id); return S.d.labores.filter((l) => (l.contratista_id === id || (!l.contratista_id && l.contratista && claveEmpresa(l.contratista) === claveEmpresa(p.nombre))) && (!camp || l.campana === camp)).reduce((a, l) => a + (Number(l.superficie_ha) || 0), 0); };
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Proveedores</h1><button class="primary" id="bNV">+ Proveedor o contratista</button></div>
    ${!S.esquemaOk ? avisoEsquema() : ""}
    <div class="small muted" style="max-width:72ch">Al subir un remito o una factura, el proveedor se reconoce por CUIT o por nombre. Si figura con otro nombre, la app te pregunta cuál es y lo recuerda. Al confirmar una factura, tildás los remitos que incluye y se compara lo recibido con lo facturado.</div>
    <div class="kpis"><div class="kpi"><span>Proveedores</span><b>${S.d.proveedores.length}</b></div><div class="kpi ${totPend ? "alerta" : ""}"><span>Remitos sin facturar</span><b>${totPend}</b></div><div class="kpi ${totDif ? "alerta" : ""}"><span>Facturas con diferencias</span><b>${totDif}</b></div></div>
    <div class="filtros"><div class="field grow"><label class="lbl" for="pvQ">Buscar</label><input id="pvQ" value="${esc(f.q)}" placeholder="Nombre o CUIT…"></div>
      <div class="field"><label class="lbl" for="pvT">De</label><select id="pvT"><option value="">Todos</option>${opciones([["proveedor", "Insumos"], ["contratista", "Labores"]], f.tipo)}</select></div>
      <label class="row small"><input type="checkbox" id="pvC" ${f.todas ? "checked" : ""}> Todas las campañas</label></div>
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th>Proveedor</th><th class="hide-m">De</th><th class="right">Facturado ${camp ? esc(camp) : ""}</th><th class="right hide-m">Labores ha</th><th>Control</th></tr>
      ${lista.map((p) => { const c = ctls.get(p.id); const h = haLab(p.id); return `<tr class="click" data-pv="${p.id}"><td><b>${esc(p.nombre)}</b>${p.cuit ? `<div class="small muted num">${esc(p.cuit)}</div>` : ""}</td><td class="small hide-m">${TIPO_PROV[p.tipo] || ""}</td><td class="num right">${c.netoUSD ? fmtM(c.netoUSD, "USD") : "—"}</td><td class="num right hide-m">${h ? fmt(h, 0) : ""}</td><td>${c.remitosPend.length ? `<span class="pill warn">${c.remitosPend.length} remito${c.remitosPend.length > 1 ? "s" : ""} sin facturar</span> ` : ""}${c.facturasDif.length ? `<span class="pill bad">${c.facturasDif.length} con diferencia</span>` : ""}${!c.remitosPend.length && !c.facturasDif.length && c.comps.length ? '<span class="pill ok">Al día</span>' : ""}</td></tr>`; }).join("")}</table></div></div>`
      : `<div class="empty">${S.d.proveedores.length ? "Ninguno coincide con el filtro." : "Cargá tus proveedores de insumos y tus contratistas. También se agregan solos al confirmar comprobantes y al cargar labores."}</div>`}
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#bNV").onclick = () => Insumos.formProveedor(null);
  $("#pvT").onchange = (e) => { f.tipo = e.target.value; Vistas.proveedores(); };
  $("#pvC").onchange = (e) => { f.todas = e.target.checked; Vistas.proveedores(); };
  $("#pvQ").oninput = (e) => { f.q = e.target.value; clearTimeout(S._tpv); S._tpv = setTimeout(() => { Vistas.proveedores(); const i = document.getElementById("pvQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  el.querySelectorAll("[data-pv]").forEach((tr) => (tr.onclick = () => Proveedores.detalle(proveedorDe(tr.dataset.pv))));
};
