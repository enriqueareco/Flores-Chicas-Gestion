"use strict";
/* ============ Insumos, proveedores y contratistas ============ */
const Insumos = {
  formProducto(p, onSave) {
    const x = p || {};
    modal(`<h4>${p ? "Editar producto" : "Nuevo producto"}</h4>
      <div class="field"><label class="lbl" for="pNom">Nombre comercial</label><input id="pNom" value="${esc(x.nombre || "")}" placeholder="Ej. Glifosato Full II"></div>
      <div class="row"><div class="field grow"><label class="lbl" for="pTipo">Tipo</label><select id="pTipo">${opciones(TIPOS_PRODUCTO.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), x.tipo || "herbicida")}</select></div>
      <div class="field"><label class="lbl" for="pUni">Unidad de stock</label><select id="pUni">${opciones([["L", "Litros"], ["kg", "Kilos"], ["u", "Unidades / bolsas"]], x.unidad || "L")}</select></div></div>
      <div class="row"><div class="field grow"><label class="lbl" for="pPA">Principio activo</label><input id="pPA" value="${esc(x.principio_activo || "")}" placeholder="Ej. glifosato"></div>
      <div class="field"><label class="lbl" for="pConc">Concentración</label><input id="pConc" value="${esc(x.concentracion || "")}" placeholder="Ej. 66,2%" style="width:120px"></div></div>
      <div class="field"><label class="lbl" for="pNot">Notas</label><input id="pNot" value="${esc(x.notas || "")}" placeholder="Banda toxicológica, carencia…"></div>
      <div class="pie">${p ? '<button class="ghost danger" id="mDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
      if ($("#mDel")) $("#mDel").onclick = async () => {
        const usos = S.d.labores.filter((l) => (l.insumos || []).some((i) => i.producto_id === p.id)).length + S.d.comprobantes.filter((c) => (c.items || []).some((i) => i.producto_id === p.id)).length;
        if (usos) { toast(`No se puede eliminar: aparece en ${usos} labor${usos > 1 ? "es" : ""} o comprobante${usos > 1 ? "s" : ""}.`, 5000); return; }
        if (await confirmar(`¿Eliminar <b>${esc(p.nombre)}</b>?`)) { await borrar("productos", p.id); close(); refrescar(); }
      };
      $("#mOk").onclick = async () => {
        const nombre = $("#pNom").value.trim(); if (!nombre) { $("#pNom").focus(); return; }
        const dup = buscarProducto(nombre); if (dup && dup.id !== x.id) { toast("Ya existe un producto con ese nombre."); return; }
        const n = { ...x, id: x.id || uid(), nombre, tipo: $("#pTipo").value, unidad: $("#pUni").value, principio_activo: $("#pPA").value.trim() || null, concentracion: $("#pConc").value.trim() || null, notas: $("#pNot").value.trim() || null };
        try { await guardar("productos", n); close(); onSave ? onSave(n) : refrescar(); } catch (e) { toast(e.message, 6000); }
      };
    });
  },
  formProveedor(p, onSave, tipoDef = "proveedor") {
    const x = p || {};
    modal(`<h4>${p ? "Editar" : "Nuevo"} proveedor o contratista</h4>
      <div class="field"><label class="lbl" for="vNom">Nombre o razón social</label><input id="vNom" value="${esc(x.nombre || "")}"></div>
      <div class="row"><div class="field grow"><label class="lbl" for="vCuit">CUIT</label><input id="vCuit" value="${esc(x.cuit || "")}" inputmode="numeric" placeholder="30-12345678-9"></div>
      <div class="field grow"><label class="lbl" for="vTipo">Es</label><select id="vTipo">${opciones([["proveedor", "Proveedor de insumos"], ["contratista", "Contratista de labores"], ["ambos", "Ambos"]], x.tipo || tipoDef)}</select></div></div>
      <div class="field"><label class="lbl" for="vTel">Teléfono (para mandar órdenes por WhatsApp)</label><input id="vTel" value="${esc(x.telefono || "")}" inputmode="tel" placeholder="2262 15 123456"></div>
      <div class="field"><label class="lbl" for="vNot">Notas</label><input id="vNot" value="${esc(x.notas || "")}"></div>
      <div class="pie">${p ? '<button class="ghost danger" id="mDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
      if ($("#mDel")) $("#mDel").onclick = async () => {
        const usos = S.d.comprobantes.filter((c) => c.proveedor_id === p.id).length + S.d.labores.filter((l) => l.contratista_id === p.id).length + S.d.ordenes.filter((o) => o.contratista_id === p.id).length;
        if (usos) { toast(`No se puede eliminar: tiene ${usos} comprobantes, labores u órdenes asociadas.`, 5000); return; }
        if (await confirmar(`¿Eliminar <b>${esc(p.nombre)}</b>?`)) { await borrar("proveedores", p.id); close(); refrescar(); }
      };
      $("#mOk").onclick = async () => {
        const nombre = $("#vNom").value.trim(); if (!nombre) { $("#vNom").focus(); return; }
        const n = { ...x, id: x.id || uid(), nombre, cuit: soloDig($("#vCuit").value) || null, tipo: $("#vTipo").value, telefono: $("#vTel").value.trim() || null, notas: $("#vNot").value.trim() || null };
        try { await guardar("proveedores", n); close(); onSave ? onSave(n) : refrescar(); } catch (e) { toast(e.message, 6000); }
      };
    });
  },
};

Vistas.insumos = function () {
  const el = document.getElementById("v-insumos");
  const st = stockProductos(), pr = preciosProductos();
  const f = S.filtroIns || (S.filtroIns = { tipo: "", q: "" });
  const prods = S.d.productos.filter((p) => (!f.tipo || p.tipo === f.tipo) && (!f.q || norm(p.nombre + " " + (p.principio_activo || "")).includes(norm(f.q)))).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const provs = [...S.d.proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const nComp = (id) => S.d.comprobantes.filter((c) => c.proveedor_id === id).length;
  const nLab = (id) => S.d.labores.filter((l) => l.contratista_id === id).length;
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Insumos y proveedores</h1></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Productos</h2><button class="primary" id="bNP">+ Producto</button></div>
      <div class="row"><input id="fQ" placeholder="Buscar producto o principio activo…" value="${esc(f.q)}" class="grow"><select id="fT"><option value="">Todos los tipos</option>${opciones(TIPOS_PRODUCTO.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), f.tipo)}</select></div>
      ${prods.length ? `<div class="tablewrap"><table class="t"><tr><th>Producto</th><th>Tipo</th><th class="hide-m">Principio activo</th><th class="right">Stock</th><th class="right">Precio prom.</th></tr>
      ${prods.map((p) => { const s = st[p.id]; const q = s ? s.entra - s.sale : null; return `<tr class="click" data-p="${p.id}"><td><b>${esc(p.nombre)}</b></td><td class="small">${esc(p.tipo || "")}</td><td class="small hide-m">${esc(p.principio_activo || "")} ${esc(p.concentracion || "")}</td><td class="num right ${q != null && q < 0 ? "" : ""}">${q == null ? "—" : `${fmt(q, 1)} ${esc(p.unidad)}`}${q != null && q < 0 ? '<div><span class="pill bad">falta cargar compra</span></div>' : ""}</td><td class="num right">${pr[p.id] != null ? `US$ ${fmt(pr[p.id], 2)}/${esc(p.unidad)}` : "—"}</td></tr>`; }).join("")}</table></div>
      <div class="small muted">Stock = lo que ingresó por remitos y facturas confirmados, menos lo usado en labores. El precio es el promedio ponderado de las facturas confirmadas, en dólares.</div>`
      : `<div class="empty">${S.d.productos.length ? "Ningún producto coincide con el filtro." : "Los productos se crean solos al confirmar comprobantes o cargar labores. También podés agregarlos a mano."}</div>`}
    </div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Proveedores y contratistas</h2><button class="primary" id="bNV">+ Proveedor o contratista</button></div>
      ${provs.length ? `<div class="tablewrap"><table class="t"><tr><th>Nombre</th><th class="hide-m">CUIT</th><th>Es</th><th class="hide-m">Teléfono</th><th class="right">Comprob.</th><th class="right">Labores</th></tr>
      ${provs.map((p) => `<tr class="click" data-pv="${p.id}"><td><b>${esc(p.nombre)}</b></td><td class="num small hide-m">${esc(p.cuit || "")}</td><td class="small">${{ proveedor: "Proveedor", contratista: "Contratista", ambos: "Ambos" }[p.tipo] || ""}</td><td class="small hide-m">${esc(p.telefono || "")}</td><td class="num right">${nComp(p.id) || ""}</td><td class="num right">${nLab(p.id) || ""}</td></tr>`).join("")}</table></div>`
      : `<div class="empty">Se agregan solos al leer comprobantes y al cargar labores con contratista.</div>`}
    </div></div>`;
  const $ = (q) => el.querySelector(q);
  $("#bNP").onclick = () => Insumos.formProducto(null);
  $("#bNV").onclick = () => Insumos.formProveedor(null);
  el.querySelectorAll("[data-p]").forEach((tr) => (tr.onclick = () => Insumos.formProducto(productoDe(tr.dataset.p))));
  el.querySelectorAll("tr[data-pv]").forEach((tr) => (tr.onclick = () => Insumos.formProveedor(proveedorDe(tr.dataset.pv))));
  $("#fQ").oninput = (e) => { f.q = e.target.value; clearTimeout(S._tq); S._tq = setTimeout(() => { Vistas.insumos(); const i = document.getElementById("fQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $("#fT").onchange = (e) => { f.tipo = e.target.value; Vistas.insumos(); };
};
