"use strict";
/* ============ Insumos fijos, stock del galpón, proveedores y contratistas ============ */
const Insumos = {
  formProducto(p, onSave, def = {}) {
    const x = p || { tipo: "herbicida", unidad: "L", ...def };
    modal(`<h4>${p ? "Editar insumo" : "Nuevo insumo"}</h4>
      <div class="field"><label class="lbl" for="pNom">Nombre</label><input id="pNom" value="${esc(x.nombre || "")}" placeholder="Ej. Glifosato 66%"></div>
      <div class="small muted" style="margin-top:-6px">Usá un nombre genérico. Las marcas y los nombres que figuran en los remitos se guardan como nombres alternativos.</div>
      <div class="row"><div class="field grow"><label class="lbl" for="pTipo">Tipo</label><select id="pTipo">${opciones(TIPOS_PRODUCTO.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), x.tipo || "herbicida")}</select></div>
      <div class="field"><label class="lbl" for="pUni">Se mide en</label><select id="pUni">${opciones([["L", "Litros"], ["kg", "Kilos"], ["u", "Unidades / bolsas"]], x.unidad || "L")}</select></div></div>
      <div class="row"><div class="field grow"><label class="lbl" for="pPA">Principio activo</label><input id="pPA" value="${esc(x.principio_activo || "")}" placeholder="Ej. glifosato"></div>
      <div class="field"><label class="lbl" for="pConc">Concentración</label><input id="pConc" value="${esc(x.concentracion || "")}" placeholder="Ej. 66,2%" style="width:120px"></div></div>
      <div class="field"><label class="lbl" for="pPre">Precio de referencia US$ por unidad</label><input id="pPre" inputmode="decimal" value="${x.precio ?? ""}" style="width:140px"><span class="small muted">Se usa hasta que cargues una factura de este insumo. Después manda el precio de la última factura.</span></div>
      ${(x.alias || []).length ? `<div class="field"><span class="lbl">Nombres alternativos</span><div class="row" id="pAlias">${x.alias.map((a, i) => `<span class="chip">${esc(a.texto ?? a)}${a.proveedor_id ? ` <span class="muted">· ${esc(proveedorDe(a.proveedor_id)?.nombre || "")}</span>` : ""} <button type="button" class="ghost small danger" data-al="${i}" title="Quitar nombre" style="padding:0 4px">✕</button></span>`).join("")}</div></div>` : ""}
      <div class="field"><label class="lbl" for="pNot">Notas</label><input id="pNot" value="${esc(x.notas || "")}" placeholder="Banda toxicológica, carencia…"></div>
      <div class="pie">${p ? '<button class="ghost danger" id="mDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
      let alias = [...(x.alias || [])];
      m.querySelectorAll("[data-al]").forEach((b) => (b.onclick = () => { alias.splice(+b.dataset.al, 1); b.closest(".chip").remove(); m.querySelectorAll("[data-al]").forEach((bb, i) => (bb.dataset.al = i)); }));
      if ($("#mDel")) $("#mDel").onclick = async () => {
        const usos = S.d.labores.filter((l) => (l.insumos || []).some((i) => i.producto_id === p.id)).length + S.d.comprobantes.filter((c) => (c.items || []).some((i) => i.producto_id === p.id)).length + S.d.labores_tipo.filter((t) => (t.insumos || []).some((i) => i.producto_id === p.id)).length;
        if (usos) { toast(`No se puede eliminar: aparece en ${usos} labor${usos > 1 ? "es" : ""}, comprobante${usos > 1 ? "s" : ""} o en el catálogo.`, 6000); return; }
        if (await confirmar(`¿Eliminar <b>${esc(p.nombre)}</b>?`)) { await borrar("productos", p.id); close(); refrescar(); }
      };
      $("#mOk").onclick = async () => {
        const nombre = $("#pNom").value.trim(); if (!nombre) { $("#pNom").focus(); return; }
        const dup = S.d.productos.find((y) => y.id !== x.id && claveInsumo(y.nombre) === claveInsumo(nombre)); if (dup) { toast(`Ya existe el insumo «${dup.nombre}».`); return; }
        const n = { ...x, id: x.id || uid(), nombre, tipo: $("#pTipo").value, unidad: $("#pUni").value, principio_activo: $("#pPA").value.trim() || null, concentracion: $("#pConc").value.trim() || null, precio: num($("#pPre").value), moneda: "USD", alias, notas: $("#pNot").value.trim() || null };
        try { await guardar("productos", n); close(); onSave ? onSave(n) : refrescar(); } catch (e) { toast(e.message, 7000); }
      };
    });
  },

  /* Movimientos de un insumo: entradas por comprobantes y ajustes, salidas por labores */
  movimientos(p) {
    const mv = []; const ini = iniciosStock();
    for (const c of S.d.comprobantes) {
      if (c.estado !== "confirmado" || !c.mueve_stock) continue;
      const sg = c.tipo === "nota_credito" ? -1 : 1;
      for (const it of c.items || []) if (it.producto_id === p.id && !it.ignorar && cuentaStock(ini, p.id, c.fecha, c.creado, c.id)) mv.push({ fecha: c.fecha, txt: c.tipo === "ajuste" ? (c.ia?.inicio ? "Inventario inicial" : `Ajuste de inventario${c.notas ? " · " + c.notas : ""}`) : `${nombreTipoCompCorto(c.tipo)} ${c.numero || ""} · ${c.proveedor_nombre || ""}`, cant: sg * (Number(it.cantidad) || 0), comp: c.id, creado: c.creado });
    }
    for (const l of S.d.labores) for (const i of l.insumos || []) if (i.producto_id === p.id && cuentaStock(ini, p.id, l.fecha, l.creado)) mv.push({ fecha: l.fecha, txt: `${nombreLabor(l)} · ${nombreUbic(l.lote_id, l.sub_id)}`, cant: -(i.cantidad != null ? Number(i.cantidad) : cantidadInsumo(i, l.superficie_ha).cant), lab: l.id, creado: l.creado });
    mv.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.creado || "").localeCompare(b.creado || ""));
    let saldo = 0; for (const m of mv) { saldo += m.cant; m.saldo = saldo; }
    return mv;
  },
  detalle(p) {
    const st = stockProductos()[p.id] || { entra: 0, sale: 0, ordenes: 0 }; const hay = st.entra - st.sale;
    const pr = preciosDetalle()[p.id]; const mv = Insumos.movimientos(p).reverse();
    modal(`<div class="row" style="justify-content:space-between"><h4>${esc(p.nombre)}</h4><span class="small muted">${esc(p.tipo || "")}${p.principio_activo ? " · " + esc(p.principio_activo) : ""} ${esc(p.concentracion || "")}</span></div>
      <div class="stats"><div><span>En el galpón</span><b class="num">${fmt(hay, 1)} ${esc(p.unidad)}</b></div><div><span>Precio vigente</span><b class="num">${pr ? `US$ ${fmt(pr.usd, 2)}` : "—"}</b>${pr ? `<div class="small muted">${esc(pr.origen)}${pr.fecha ? " · " + fechaAR(pr.fecha) : ""}</div>` : ""}</div><div><span>En órdenes abiertas</span><b class="num">${fmt(st.ordenes, 1)} ${esc(p.unidad)}</b></div></div>
      ${hay < -1e-9 ? `<div class="aviso">El stock da negativo: se usó más de lo que ingresó. Falta cargar algún remito o hacer un ajuste de inventario.</div>` : ""}
      ${(p.alias || []).length ? `<div class="small"><span class="lbl">También figura como</span> ${(p.alias || []).map((a) => `<span class="chip">${esc(a.texto ?? a)}</span>`).join(" ")}</div>` : ""}
      <h2>Movimientos</h2>${(() => { const m = iniciosStock(); const i = m.por[p.id] || m.glob; return i ? `<div class="small muted" style="margin-top:-6px">Desde el inventario inicial del ${fechaAR(i.fecha)}. Lo cargado antes no mueve el stock.</div>` : ""; })()}
      ${mv.length ? `<div class="tablewrap" style="max-height:320px;overflow:auto"><table class="t"><tr><th>Fecha</th><th>Movimiento</th><th class="right">Cantidad</th><th class="right">Saldo</th></tr>${mv.map((m) => `<tr class="click" ${m.comp ? `data-mc="${m.comp}"` : `data-ml="${m.lab}"`}><td class="num">${fechaAR(m.fecha)}</td><td class="small">${esc(m.txt)}</td><td class="num right" style="color:${m.cant < 0 ? "var(--danger)" : "var(--ok)"}">${m.cant > 0 ? "+" : ""}${fmt(m.cant, 1)}</td><td class="num right">${fmt(m.saldo, 1)}</td></tr>`).join("")}</table></div>` : `<div class="empty">Sin movimientos. Entra stock al confirmar remitos o facturas, y sale al cargar labores.</div>`}
      <div class="pie"><button id="dEdit" style="margin-right:auto">Editar insumo</button><button id="mNo">Cerrar</button><button class="primary" id="dAj">Ajustar stock</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      $("#mNo").onclick = close;
      $("#dEdit").onclick = () => { close(); Insumos.formProducto(p, () => { refrescar(); Insumos.detalle(productoDe(p.id)); }); };
      $("#dAj").onclick = () => { close(); Insumos.ajustar(p); };
      m.querySelectorAll("[data-mc]").forEach((tr) => (tr.onclick = () => { const c = S.d.comprobantes.find((x) => x.id === tr.dataset.mc); close(); c.tipo === "ajuste" ? Insumos.verAjuste(c) : Comprobantes.revisar(c); }));
      m.querySelectorAll("[data-ml]").forEach((tr) => (tr.onclick = () => { close(); Labores.form(S.d.labores.find((x) => x.id === tr.dataset.ml)); }));
    }, "medio");
  },
  /* Ajuste de inventario: se carga lo que se contó en el galpón y se registra la diferencia */
  ajustar(p) {
    const st = stockProductos()[p.id] || { entra: 0, sale: 0 }; const hay = st.entra - st.sale;
    modal(`<h4>Ajustar stock · ${esc(p.nombre)}</h4>
      <div class="small muted">Según la app hay <b class="num">${fmt(hay, 1)} ${esc(p.unidad)}</b>. Cargá lo que hay realmente en el galpón y se registra la diferencia. Sirve también para cargar el stock inicial.</div>
      <div class="row"><div class="field"><label class="lbl" for="ajC">Hay en el galpón (${esc(p.unidad)})</label><input id="ajC" inputmode="decimal" style="width:140px" autofocus></div>
        <div class="field"><label class="lbl" for="ajF">Fecha</label><input type="date" id="ajF" value="${hoy()}"></div></div>
      <div class="field"><label class="lbl" for="ajN">Motivo</label><input id="ajN" placeholder="Ej. stock inicial, recuento, derrame"></div>
      <div id="ajD" class="small"></div>
      <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="ajOk">Guardar ajuste</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      $("#ajC").oninput = () => { const v = num($("#ajC").value); $("#ajD").textContent = v == null ? "" : `Diferencia: ${v - hay > 0 ? "+" : ""}${fmt(v - hay, 1)} ${p.unidad}`; };
      $("#mNo").onclick = close;
      $("#ajOk").onclick = async () => {
        const v = num($("#ajC").value); if (v == null) { $("#ajC").focus(); return; }
        const d = +(v - hay).toFixed(3); if (!d) { close(); toast("El stock ya coincide."); return; }
        try { await guardar("comprobantes", { id: uid(), tipo: "ajuste", estado: "confirmado", origen: "manual", mueve_stock: true, fecha: $("#ajF").value || hoy(), campana: campanaDeFecha($("#ajF").value), moneda: "USD", items: [{ producto_id: p.id, producto: p.nombre, descripcion: "Ajuste de inventario", cantidad: d, unidad: p.unidad }], archivos: [], notas: $("#ajN").value.trim() || null }); close(); refrescar(); toast("Stock ajustado"); }
        catch (e) { toast(e.message, 7000); }
      };
    });
  },
  verAjuste(c) {
    const it = c.items?.[0] || {}; const p = productoDe(it.producto_id);
    modal(`<h4>Ajuste de inventario</h4><p>${esc(p?.nombre || "")}: <b class="num">${it.cantidad > 0 ? "+" : ""}${fmt(it.cantidad, 1)} ${esc(it.unidad || "")}</b> el ${fechaAR(c.fecha)}${c.notas ? "<br>" + esc(c.notas) : ""}</p>
      <div class="pie"><button class="ghost danger" id="vaDel" style="margin-right:auto">Eliminar ajuste</button><button id="mNo">Cerrar</button></div>`, (m, close) => {
      m.querySelector("#mNo").onclick = close;
      m.querySelector("#vaDel").onclick = async () => { await borrar("comprobantes", c.id); close(); refrescar(); toast("Ajuste eliminado"); };
    });
  },
  formProveedor(p, onSave, tipoDef = "proveedor") {
    const x = p || {};
    modal(`<h4>${p ? "Editar" : "Nuevo"} proveedor o contratista</h4>
      <div class="field"><label class="lbl" for="vNom">Nombre o razón social</label><input id="vNom" value="${esc(x.nombre || "")}"></div>
      <div class="row"><div class="field grow"><label class="lbl" for="vCuit">CUIT</label><input id="vCuit" value="${esc(x.cuit || "")}" inputmode="numeric" placeholder="30-12345678-9"></div>
      <div class="field grow"><label class="lbl" for="vTipo">Es</label><select id="vTipo">${opciones([["proveedor", "Proveedor de insumos"], ["contratista", "Contratista de labores"], ["ambos", "Insumos y labores"]], x.tipo || tipoDef)}</select></div></div>
      <div class="field"><label class="lbl" for="vTel">Teléfono (para mandar órdenes por WhatsApp)</label><input id="vTel" value="${esc(x.telefono || "")}" inputmode="tel" placeholder="2262 15 123456"></div>
      ${(x.alias || []).length ? `<div class="field"><span class="lbl">Otros nombres con que figura</span><div class="row">${x.alias.map((a, i) => `<span class="chip">${esc(a.texto ?? a)} <button type="button" class="ghost small danger" data-val="${i}" title="Quitar nombre" style="padding:0 4px">✕</button></span>`).join("")}</div></div>` : ""}
      <div class="field"><label class="lbl" for="vNot">Notas</label><input id="vNot" value="${esc(x.notas || "")}"></div>
      <div class="pie">${p ? '<button class="ghost danger" id="mDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
      const alias = [...(x.alias || [])];
      m.querySelectorAll("[data-val]").forEach((b) => (b.onclick = () => { alias.splice(+b.dataset.val, 1); b.closest(".chip").remove(); m.querySelectorAll("[data-val]").forEach((bb, i) => (bb.dataset.val = i)); }));
      if ($("#mDel")) $("#mDel").onclick = async () => {
        const usos = S.d.comprobantes.filter((c) => c.proveedor_id === p.id).length + S.d.labores.filter((l) => l.contratista_id === p.id).length + S.d.ordenes.filter((o) => o.contratista_id === p.id).length;
        if (usos) { toast(`No se puede eliminar: tiene ${usos} comprobantes, labores u órdenes asociadas.`, 5000); return; }
        if (await confirmar(`¿Eliminar <b>${esc(p.nombre)}</b>?`)) { await borrar("proveedores", p.id); close(); refrescar(); }
      };
      $("#mOk").onclick = async () => {
        const nombre = $("#vNom").value.trim(); if (!nombre) { $("#vNom").focus(); return; }
        const n = { ...x, id: x.id || uid(), nombre, cuit: soloDig($("#vCuit").value) || null, tipo: $("#vTipo").value, alias, telefono: $("#vTel").value.trim() || null, notas: $("#vNot").value.trim() || null };
        try { await guardar("proveedores", n); close(); onSave ? onSave(n) : refrescar(); } catch (e) { toast(e.message, 6000); }
      };
    });
  },
};

Vistas.insumos = function () {
  const el = document.getElementById("v-insumos");
  const st = stockProductos(), pr = preciosDetalle();
  const f = S.filtroIns || (S.filtroIns = { tipo: "", q: "", soloStock: false });
  const hayDe = (id) => { const s = st[id]; return s ? s.entra - s.sale : 0; };
  const prods = S.d.productos.filter((p) => (!f.tipo || p.tipo === f.tipo) && (!f.soloStock || Math.abs(hayDe(p.id)) > 1e-9) && (!f.q || norm([p.nombre, p.principio_activo, ...(p.alias || []).map((a) => a.texto ?? a)].join(" ")).includes(norm(f.q)))).sort((a, b) => (a.tipo || "").localeCompare(b.tipo || "") || a.nombre.localeCompare(b.nombre));
  let valor = 0, sinPrecio = 0, negativos = 0;
  for (const p of S.d.productos) { const h = hayDe(p.id); if (h < -1e-9) negativos++; if (h > 0) { if (pr[p.id]) valor += h * pr[p.id].usd; else sinPrecio++; } }
  const provs = [...S.d.proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const nComp = (id) => S.d.comprobantes.filter((c) => c.proveedor_id === id).length;
  const nLab = (id) => S.d.labores.filter((l) => l.contratista_id === id).length;
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Insumos y stock del galpón</h1><div class="row"><button class="primary" id="bNP">+ Insumo</button><button id="bRem">📷 Cargar remito</button><button id="bPed">🧾 Pedido de insumos</button><button id="bCsvI" class="hide-m">Exportar stock</button></div></div>
    ${!S.esquemaOk ? avisoEsquema() : ""}
    <div class="kpis"><div class="kpi"><span>Insumos</span><b>${S.d.productos.length}</b></div><div class="kpi"><span>Valor del stock</span><b>${fmtM(valor, "USD")}</b>${sinPrecio ? `<div class="small muted">${sinPrecio} insumo${sinPrecio > 1 ? "s" : ""} sin precio</div>` : ""}</div><div class="kpi ${negativos ? "alerta" : ""}"><span>Con stock negativo</span><b>${negativos}</b></div></div>
    <div class="filtros"><div class="field grow"><label class="lbl" for="fQ">Buscar</label><input id="fQ" placeholder="Nombre, marca o principio activo…" value="${esc(f.q)}"></div>
      <div class="field"><label class="lbl" for="fT">Tipo</label><select id="fT"><option value="">Todos</option>${opciones(TIPOS_PRODUCTO.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), f.tipo)}</select></div>
      <label class="row small"><input type="checkbox" id="fS" ${f.soloStock ? "checked" : ""}> Solo con stock</label></div>
    ${prods.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th>Insumo</th><th class="hide-m">Tipo</th><th class="right">En el galpón</th><th class="right hide-m">En órdenes</th><th class="right">Precio vigente</th><th class="right hide-m">Valor</th></tr>
      ${prods.map((p) => { const h = hayDe(p.id); const s = st[p.id]; const pp = pr[p.id]; return `<tr class="click" data-p="${p.id}"><td><b>${esc(p.nombre)}</b>${p.principio_activo ? `<div class="small muted">${esc(p.principio_activo)} ${esc(p.concentracion || "")}</div>` : ""}${(p.alias || []).length ? `<div class="small muted">También: ${(p.alias || []).slice(0, 3).map((a) => esc(a.texto ?? a)).join(", ")}${p.alias.length > 3 ? "…" : ""}</div>` : ""}</td><td class="small hide-m">${esc(p.tipo || "")}</td><td class="num right">${fmt(h, 1)} ${esc(p.unidad)}${h < -1e-9 ? '<div><span class="pill bad">negativo</span></div>' : ""}</td><td class="num right hide-m">${s?.ordenes ? fmt(s.ordenes, 1) : ""}</td><td class="num right">${pp ? `US$ ${fmt(pp.usd, 2)}/${esc(p.unidad)}` : '<span class="muted">—</span>'}</td><td class="num right hide-m">${pp && h > 0 ? fmtM(h * pp.usd, "USD") : ""}</td></tr>`; }).join("")}</table></div></div>
      <div class="small muted">Entra stock al confirmar remitos y facturas; sale al cargar labores. Tocá un insumo para ver sus movimientos o ajustar el stock contado en el galpón.</div>`
      : `<div class="empty">${S.d.productos.length ? "Ningún insumo coincide con el filtro." : "Cargá los insumos que usás (herbicidas, fertilizantes, semillas…). Quedan fijos en la lista y se eligen al cargar labores. También se agregan al confirmar remitos."}</div>`}
    <div class="row"><button class="ghost" data-ir="proveedores">Ver proveedores y control de remitos →</button></div></div>`;
  const $ = (q) => el.querySelector(q);
  $("#bNP").onclick = () => Insumos.formProducto(null);
  $("#bRem").onclick = () => document.getElementById("fFoto").click();
  $("#bPed").onclick = () => Pedido.abrir();
  el.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => irA(b.dataset.ir)));
  $("#bCsvI").onclick = () => descargar(`stock_galpon_${hoy()}.csv`, csv([["Insumo", "Tipo", "Principio activo", "Concentración", "Unidad", "Stock", "En órdenes abiertas", "Precio US$", "Valor US$"], ...S.d.productos.map((p) => { const h = hayDe(p.id); const pp = pr[p.id]; return [p.nombre, p.tipo, p.principio_activo, p.concentracion, p.unidad, +h.toFixed(3), st[p.id]?.ordenes || 0, pp ? +pp.usd.toFixed(4) : null, pp && h > 0 ? +(h * pp.usd).toFixed(2) : null]; })]), "text/csv");
  el.querySelectorAll("[data-p]").forEach((tr) => (tr.onclick = () => Insumos.detalle(productoDe(tr.dataset.p))));
  $("#fQ").oninput = (e) => { f.q = e.target.value; clearTimeout(S._tq); S._tq = setTimeout(() => { Vistas.insumos(); const i = document.getElementById("fQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $("#fT").onchange = (e) => { f.tipo = e.target.value; Vistas.insumos(); };
  $("#fS").onchange = (e) => { f.soloStock = e.target.checked; Vistas.insumos(); };
};
