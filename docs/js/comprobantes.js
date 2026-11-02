"use strict";
/* ============ Comprobantes: facturas y remitos ============ */
const TIPOS_COMP = [["factura", "Factura"], ["remito", "Remito"], ["nota_credito", "Nota de crédito"], ["nota_debito", "Nota de débito"], ["otro", "Otro"]];
const nombreTipoComp = (t) => (TIPOS_COMP.find((x) => x[0] === t) || [, "Comprobante"])[1];

async function comprimirImagen(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", 0.85));
  } catch (e) { return file; }
}

const Comprobantes = {
  /* Una o varias fotos = un comprobante (páginas). Cada PDF = un comprobante. */
  async desdeArchivos(files, origen) {
    files = [...files]; if (!files.length) return;
    const grupos = origen === "foto" ? [files] : files.map((f) => [f]);
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (origen !== "foto" && imgs.length > 1 && imgs.length === files.length) grupos.splice(0, grupos.length, imgs);
    let primero = null;
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const fin = cargando(grupos.length > 1 ? `Subiendo comprobante ${gi + 1} de ${grupos.length}…` : "Subiendo comprobante…");
      const c = { id: uid(), tipo: "factura", estado: "borrador", origen: g[0].type.includes("pdf") ? "pdf" : "foto", items: [], archivos: [], mueve_stock: true, moneda: "ARS" };
      try {
        for (let i = 0; i < g.length; i++) {
          const b = await comprimirImagen(g[i]);
          const ext = b.type.includes("pdf") ? "pdf" : b.type.includes("png") ? "png" : "jpg";
          const path = `${c.id}/${i + 1}.${ext}`;
          await DB.subir("comprobantes", path, b);
          c.archivos.push({ path, tipo: b.type || (ext === "pdf" ? "application/pdf" : "image/jpeg"), nombre: g[i].name });
        }
        await guardar("comprobantes", c);
      } catch (e) { fin(); toast(e.message, 7000); continue; }
      fin();
      await this.leer(c, grupos.length > 1 ? ` (${gi + 1} de ${grupos.length})` : "");
      primero = primero || c;
    }
    refrescar();
    if (primero) this.revisar(primero);
  },
  async leer(c, sufijo = "") {
    if (DB.modo === "local") return;
    const fin = cargando("Leyendo el comprobante con IA" + sufijo + "…");
    try {
      const r = await DB.ia("comprobante", { archivos: c.archivos, contexto: {
        proveedores: S.d.proveedores.slice(0, 200).map((p) => p.nombre + (p.cuit ? ` (${p.cuit})` : "")),
        productos: S.d.productos.slice(0, 400).map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, principio_activo: p.principio_activo, concentracion: p.concentracion, unidad: p.unidad, otros_nombres: (p.alias || []).map((a) => a.texto ?? a).slice(0, 10) })),
      } });
      const d = r.datos || {}; c.ia = d;
      c.tipo = d.tipo || c.tipo; c.letra = d.letra || null; c.numero = d.numero || null; c.fecha = d.fecha || null;
      c.moneda = d.moneda || "ARS"; c.tipo_cambio = d.tipo_cambio || null; c.total = d.total ?? null;
      c.proveedor_nombre = d.proveedor?.nombre || null; c.cuit = soloDig(d.proveedor?.cuit) || null;
      const pv = buscarProveedor(c.proveedor_nombre, c.cuit); c.proveedor_id = pv?.id || null;
      c.mueve_stock = c.tipo !== "nota_debito";
      c.items = (d.items || []).map((it) => Comprobantes.asignar({ ...it, sugerido_id: it.producto_id || null, producto_id: null }));
      c.campana = campanaDeFecha(c.fecha);
      await guardar("comprobantes", c);
    } catch (e) { toast("No pude leerlo automáticamente: " + e.message + ". Completalo a mano.", 8000); }
    finally { fin(); }
  },
  /* Reconoce el insumo de un renglón: por nombre ya visto (seguro) o por sugerencia de la IA (a confirmar) */
  asignar(it) {
    const p = productoPorTexto(it.descripcion);
    if (p) return { ...it, producto_id: p.id, producto: p.nombre, match: "conocido" };
    const s = productoDe(it.sugerido_id);
    if (s) return { ...it, producto_id: s.id, producto: s.nombre, match: "sugerido" };
    return { ...it, producto_id: null, producto: null, match: null };
  },
  nombreSugerido(it) { return String(it.descripcion || "").replace(/\b(x\s*)?\d+([ .,]\d+)?\s*(l|lt|lts|litros|kg|kgs|cc)\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 60); },

  async revisar(c) {
    const urls = []; for (const a of c.archivos || []) { try { urls.push({ ...a, url: await DB.url("comprobantes", a.path) }); } catch (e) {} }
    const it0 = { descripcion: "", producto_id: null, match: "manual", cantidad: null, unidad: "L", precio_unitario: null, alicuota_iva: null, tipo_producto: "herbicida" };
    let items = (c.items || []).map((x) => (c.estado === "confirmado" || x.producto_id || x.ignorar ? { ...x } : Comprobantes.asignar(x)));
    const prov = proveedorDe(c.proveedor_id);
    modal(`<div class="row" style="justify-content:space-between"><h4>${c.estado === "confirmado" ? "Comprobante" : "Revisar comprobante"}</h4>${c.estado === "confirmado" ? '<span class="pill ok">Confirmado</span>' : '<span class="pill warn">Borrador</span>'}</div>
      ${c.ia?.observaciones ? `<div class="aviso"><b>Para revisar:</b> ${esc(c.ia.observaciones)}</div>` : ""}
      ${DB.modo === "local" && !c.ia ? `<div class="aviso">En modo prueba no se lee automáticamente. Completá los datos mirando la imagen.</div>` : ""}
      <div class="visor">
        <div class="doc">${urls.length ? urls.map((u) => u.tipo.includes("pdf") ? `<iframe src="${esc(u.url)}" title="Comprobante PDF"></iframe>` : `<a href="${esc(u.url)}" target="_blank" rel="noopener"><img src="${esc(u.url)}" alt="Página del comprobante"></a>`).join("") : '<div class="muted" style="padding:20px;color:#bbb">Sin archivo adjunto</div>'}</div>
        <div class="col" style="gap:10px;min-width:0">
          <div class="row"><div class="field"><label class="lbl" for="cTipo">Tipo</label><select id="cTipo">${opciones(TIPOS_COMP, c.tipo)}</select></div>
            <div class="field"><label class="lbl" for="cLetra">Letra</label><input id="cLetra" value="${esc(c.letra || "")}" style="width:52px" maxlength="1"></div>
            <div class="field grow"><label class="lbl" for="cNum">Número</label><input id="cNum" value="${esc(c.numero || "")}" placeholder="0003-00012345"></div>
            <div class="field"><label class="lbl" for="cFecha">Fecha</label><input type="date" id="cFecha" value="${esc(c.fecha || "")}"></div></div>
          <div class="row"><div class="field grow"><label class="lbl" for="cProv">Proveedor</label><input id="cProv" list="dlProvs" value="${esc(prov?.nombre || c.proveedor_nombre || "")}"><datalist id="dlProvs">${S.d.proveedores.map((p) => `<option value="${esc(p.nombre)}">`).join("")}</datalist></div>
            <div class="field"><label class="lbl" for="cCuit">CUIT</label><input id="cCuit" value="${esc(prov?.cuit || c.cuit || "")}" inputmode="numeric" style="width:140px"></div></div>
          <div class="small" id="cProvEstado"></div>
          <div class="row" id="cPrecios"><div class="field"><label class="lbl" for="cMon">Moneda</label><select id="cMon">${opciones([["ARS", "Pesos"], ["USD", "Dólares"]], c.moneda)}</select></div>
            <div class="field"><label class="lbl" for="cTC">Tipo de cambio</label><input id="cTC" inputmode="decimal" value="${c.tipo_cambio ?? ""}" style="width:110px" placeholder="$ por US$"></div>
            <div class="field"><label class="lbl" for="cTot">Total con IVA</label><input id="cTot" inputmode="decimal" value="${c.total ?? ""}" style="width:130px"></div></div>
          <div class="row" style="justify-content:space-between"><h2>¿Qué insumo es cada renglón?</h2><button id="cAddIt" class="small">+ Renglón</button></div>
          <div id="cResumen" class="small"></div>
          <div id="cItems" class="col" style="gap:8px"></div>
          <label class="row small"><input type="checkbox" id="cStock" ${c.mueve_stock !== false ? "checked" : ""}> Ingresa mercadería al galpón <span class="muted">(destildá si es la factura de un remito ya cargado)</span></label>
          <div class="field"><label class="lbl" for="cNot">Notas</label><input id="cNot" value="${esc(c.notas || "")}"></div>
        </div>
      </div>
      <div class="pie"><button class="ghost danger" id="cDel" style="margin-right:auto">Eliminar</button><button id="mNo">Cerrar</button>${c.estado === "confirmado" ? '<button class="primary" id="cOk">Guardar cambios</button>' : '<button id="cBorr">Guardar borrador</button><button class="primary" id="cOk">Confirmar</button>'}</div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      const chip = (it) => {
        if (it.ignorar) return `<span class="pill mut">No va al galpón</span>`;
        if (!it.producto_id) return `<span class="pill bad">¿A qué insumo pertenece?</span>`;
        if (it.match === "conocido") return `<span class="pill ok">Reconocido</span>`;
        if (it.match === "sugerido") return `<span class="pill warn">¿Es este insumo?</span> <button type="button" class="small primary" data-si>Sí, es este</button>`;
        return `<span class="pill ok">Asignado</span>`;
      };
      const avisoUnidad = (it) => { const p = productoDe(it.producto_id); return p && !it.ignorar && it.unidad && it.unidad !== p.unidad ? `<div class="small" style="color:var(--warn)">${esc(p.nombre)} se mide en ${esc(p.unidad)}: pasá la cantidad a ${esc(p.unidad)}.</div>` : ""; };
      const resumen = () => { const falta = items.filter((it) => !it.producto_id && !it.ignorar).length, dudas = items.filter((it) => it.match === "sugerido" && !it.ignorar).length; $("#cResumen").innerHTML = c.estado === "confirmado" ? "" : falta || dudas ? `<div class="aviso">${falta ? `${falta} renglón${falta > 1 ? "es" : ""} sin insumo asignado. ` : ""}${dudas ? `${dudas} con nombre distinto al de tu lista: confirmá si corresponde al insumo sugerido o elegí otro.` : ""} Lo que elijas queda guardado y la próxima vez se reconoce solo.</div>` : items.length ? `<span class="pill ok">Todos los renglones tienen insumo</span>` : ""; };
      const pintarItems = () => {
        $("#cItems").innerHTML = items.length ? items.map((it, i) => `<div class="card" style="padding:10px;gap:6px" data-i="${i}">
            <div class="row" style="justify-content:space-between;align-items:flex-start"><div class="grow"><span class="lbl">En el comprobante dice</span><input data-k="descripcion" value="${esc(it.descripcion || "")}" placeholder="Descripción" style="width:100%"></div><button class="ghost small danger" data-del="${i}" title="Quitar renglón">✕</button></div>
            <div class="row"><div class="field grow" style="min-width:200px"><label class="lbl">Insumo de tu lista</label><select data-k="producto_id" aria-label="Insumo">${opcionesProductos(it.ignorar ? "" : it.producto_id).replace('<option value="__nuevo">', `<option value="__ignorar" ${it.ignorar ? "selected" : ""}>No va al galpón (flete, servicio, otro)</option><option value="__nuevo">`)}</select></div><div style="align-self:flex-end;padding-bottom:4px">${chip(it)}</div></div>
            <div class="row"><div class="field"><label class="lbl">Cantidad</label><input data-k="cantidad" inputmode="decimal" value="${it.cantidad ?? ""}" style="width:100px"></div>
              <div class="field"><label class="lbl">Unidad</label><select data-k="unidad">${opciones(["L", "kg", "u", "ha", "otro"], it.unidad || "L")}</select></div>
              <div class="field"><label class="lbl">Precio unit. sin IVA</label><input data-k="precio_unitario" inputmode="decimal" value="${it.precio_unitario ?? ""}" placeholder="${c.tipo === "remito" ? "sin precio" : ""}" style="width:120px"></div></div>
            ${avisoUnidad(it)}</div>`).join("") : `<div class="empty">Sin renglones. Agregá los insumos del comprobante.</div>`;
        $("#cItems").querySelectorAll("[data-i]").forEach((row) => {
          const i = +row.dataset.i; const it = items[i];
          row.querySelectorAll("input[data-k],select[data-k=unidad]").forEach((inp) => (inp.onchange = () => { const k = inp.dataset.k; it[k] = k === "cantidad" || k === "precio_unitario" ? num(inp.value) : inp.value; if (k === "unidad") pintarItems(); }));
          row.querySelector("select[data-k=producto_id]").onchange = (e) => {
            const v = e.target.value;
            if (v === "__nuevo") {
              e.target.value = it.producto_id || "";
              Insumos.formProducto(null, (p) => { it.producto_id = p.id; it.producto = p.nombre; it.match = "nuevo"; it.ignorar = false; it.unidad = p.unidad; pintarItems(); }, { nombre: Comprobantes.nombreSugerido(it), tipo: it.tipo_producto || "herbicida", principio_activo: it.principio_activo || null, concentracion: it.concentracion || null, unidad: ["L", "kg", "u"].includes(it.unidad) ? it.unidad : "L" });
              return;
            }
            if (v === "__ignorar") { it.ignorar = true; it.producto_id = null; it.producto = null; it.match = "manual"; }
            else { const p = productoDe(v); it.ignorar = false; it.producto_id = p?.id || null; it.producto = p?.nombre || null; it.match = p ? "manual" : null; }
            pintarItems();
          };
          const si = row.querySelector("[data-si]"); if (si) si.onclick = () => { it.match = "manual"; pintarItems(); };
        });
        $("#cItems").querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { items.splice(+b.dataset.del, 1); pintarItems(); }));
        resumen();
      };
      const estadoProv = () => { const p = buscarProveedor($("#cProv").value, $("#cCuit").value); $("#cProvEstado").innerHTML = !$("#cProv").value.trim() ? "" : p ? `<span class="pill ok">Proveedor conocido</span> ${esc(p.nombre)}` : `<span class="pill mut">Proveedor nuevo</span> se agrega al confirmar`; };
      pintarItems(); estadoProv();
      $("#cProv").oninput = estadoProv; $("#cCuit").oninput = estadoProv;
      $("#cProv").onchange = () => { const p = buscarProveedor($("#cProv").value); if (p?.cuit && !$("#cCuit").value) $("#cCuit").value = p.cuit; estadoProv(); };
      $("#cAddIt").onclick = () => { items.push({ ...it0 }); pintarItems(); };
      $("#mNo").onclick = close;
      $("#cDel").onclick = async () => {
        if (!(await confirmar("¿Eliminar este comprobante y sus imágenes? Si era un remito confirmado, sus cantidades salen del stock."))) return;
        for (const a of c.archivos || []) await DB.borrarArchivo("comprobantes", a.path).catch(() => {});
        await borrar("comprobantes", c.id); close(); refrescar(); toast("Comprobante eliminado");
      };
      const juntar = () => {
        m.querySelectorAll("#cItems [data-i]").forEach((row) => { const it = items[+row.dataset.i]; row.querySelectorAll("input[data-k],select[data-k=unidad]").forEach((inp) => { const k = inp.dataset.k; it[k] = k === "cantidad" || k === "precio_unitario" ? num(inp.value) : inp.value; }); });
        Object.assign(c, { tipo: $("#cTipo").value, letra: $("#cLetra").value.trim().toUpperCase() || null, numero: $("#cNum").value.trim() || null, fecha: $("#cFecha").value || null, proveedor_nombre: $("#cProv").value.trim() || null, cuit: soloDig($("#cCuit").value) || null, moneda: $("#cMon").value, tipo_cambio: num($("#cTC").value), total: num($("#cTot").value), mueve_stock: $("#cStock").checked, notas: $("#cNot").value.trim() || null });
        c.campana = campanaDeFecha(c.fecha);
        c.items = items.filter((it) => it.descripcion || it.producto_id).map((it) => ({ ...it, subtotal: it.cantidad != null && it.precio_unitario != null ? +(it.cantidad * it.precio_unitario).toFixed(2) : it.subtotal ?? null }));
      };
      if ($("#cBorr")) $("#cBorr").onclick = async () => { juntar(); try { await guardar("comprobantes", c); close(); refrescar(); toast("Borrador guardado"); } catch (e) { toast(e.message, 6000); } };
      $("#cOk").onclick = async () => {
        juntar();
        if (!c.proveedor_nombre) { toast("Falta el proveedor."); $("#cProv").focus(); return; }
        if (!c.items.length) { toast("Agregá al menos un renglón."); return; }
        const sinAsignar = c.items.filter((it) => !it.producto_id && !it.ignorar);
        if (sinAsignar.length) { toast(`Elegí a qué insumo pertenece «${sinAsignar[0].descripcion}», o marcalo como que no va al galpón.`, 7000); return; }
        const dudas = c.items.filter((it) => it.match === "sugerido");
        if (dudas.length && !(await confirmar(`${dudas.length === 1 ? "Un renglón tiene" : dudas.length + " renglones tienen"} el insumo sugerido sin confirmar:<br>${dudas.map((it) => `«${esc(it.descripcion)}» → <b>${esc(productoDe(it.producto_id)?.nombre)}</b>`).join("<br>")}<br><br>¿Son correctos?`, "Sí, confirmar"))) return;
        const malUnidad = c.items.filter((it) => { const p = productoDe(it.producto_id); return p && it.unidad !== p.unidad; });
        if (malUnidad.length && !(await confirmar(`Hay renglones en otra unidad que la del insumo (por ejemplo «${esc(malUnidad[0].descripcion)}» en ${esc(malUnidad[0].unidad)}). El stock se suma tal cual. ¿Confirmar igual?`, "Confirmar igual"))) return;
        if (c.moneda === "ARS" && c.tipo !== "remito" && !c.tipo_cambio && c.items.some((it) => it.precio_unitario)) {
          if (!(await confirmar("No cargaste tipo de cambio. Sin él, los precios en pesos de este comprobante no se usan como precio del insumo en dólares. ¿Confirmar igual?", "Confirmar igual"))) return;
        }
        const fin = cargando("Guardando…");
        try {
          let p = buscarProveedor(c.proveedor_nombre, c.cuit);
          if (!p) p = await guardar("proveedores", { id: uid(), nombre: c.proveedor_nombre, cuit: c.cuit, tipo: "proveedor" });
          else if (c.cuit && !p.cuit) { p.cuit = c.cuit; await guardar("proveedores", p); }
          c.proveedor_id = p.id; c.proveedor_nombre = p.nombre;
          /* Recordar cómo figura cada insumo en los comprobantes de este proveedor */
          const cambiados = new Map();
          for (const it of c.items) {
            if (!it.producto_id) continue;
            const pr = productoDe(it.producto_id); it.producto = pr.nombre; it.match = it.match === "sugerido" ? "manual" : it.match;
            const k = claveInsumo(it.descripcion);
            if (k && k !== claveInsumo(pr.nombre) && !(pr.alias || []).some((a) => claveInsumo(a.texto ?? a) === k)) { pr.alias = [...(pr.alias || []), { texto: String(it.descripcion).trim(), proveedor_id: p.id }]; cambiados.set(pr.id, pr); }
          }
          for (const pr of cambiados.values()) await guardar("productos", pr);
          c.estado = "confirmado";
          await guardar("comprobantes", c); close(); refrescar();
          toast(c.mueve_stock ? `Confirmado: ${c.items.filter((it) => it.producto_id).length} insumo(s) ingresados al galpón` : "Comprobante confirmado");
        } catch (e) { toast(e.message, 7000); } finally { fin(); }
      };
    }, "ancho");
  },
};

document.getElementById("fFoto").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; Comprobantes.desdeArchivos(f, "foto"); };
document.getElementById("fDoc").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; Comprobantes.desdeArchivos(f, "pdf"); };

Vistas.comprobantes = function () {
  const el = document.getElementById("v-comprobantes");
  const f = S.filtroComp || (S.filtroComp = { estado: "", prov: "", tipo: "", todas: false });
  const lista = S.d.comprobantes.filter((c) => c.tipo !== "ajuste" && (f.todas || !c.campana || c.campana === S.campana || c.estado === "borrador") && (!f.estado || c.estado === f.estado) && (!f.prov || c.proveedor_id === f.prov) && (!f.tipo || c.tipo === f.tipo))
    .sort((a, b) => (a.estado === "borrador" ? 0 : 1) - (b.estado === "borrador" ? 0 : 1) || (b.fecha || b.creado || "").localeCompare(a.fecha || a.creado || ""));
  const pend = S.d.comprobantes.filter((c) => c.estado === "borrador" && c.tipo !== "ajuste").length;
  let totUSD = 0, sinTC = 0;
  for (const c of S.d.comprobantes) if (c.estado === "confirmado" && c.campana === S.campana && c.tipo !== "remito" && c.tipo !== "ajuste") { const neto = (c.items || []).reduce((a, it) => a + (it.subtotal || 0), 0) * (c.tipo === "nota_credito" ? -1 : 1); const u = aUSD(neto, c.moneda, c.tipo_cambio); if (u == null) { if (neto) sinTC++; } else totUSD += u; }
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Comprobantes</h1><div class="row"><button class="primary" id="bFoto">📷 Sacar foto</button><button id="bPdf">Subir PDF o imagen</button><button id="bMan">Cargar a mano</button></div></div>
    <div class="kpis"><div class="kpi ${pend ? "alerta" : ""}"><span>Para revisar</span><b>${pend}</b></div><div class="kpi"><span>Compras netas ${esc(S.campana)}</span><b>${fmtM(totUSD, "USD")}</b>${sinTC ? `<div class="small muted">${sinTC} en pesos sin tipo de cambio</div>` : ""}</div></div>
    <div class="filtros"><div class="field"><label class="lbl" for="fE">Estado</label><select id="fE"><option value="">Todos</option>${opciones([["borrador", "Para revisar"], ["confirmado", "Confirmados"]], f.estado)}</select></div>
      <div class="field"><label class="lbl" for="fTi">Tipo</label><select id="fTi"><option value="">Todos</option>${opciones(TIPOS_COMP, f.tipo)}</select></div>
      <div class="field grow"><label class="lbl" for="fP">Proveedor</label><select id="fP"><option value="">Todos</option>${opciones(S.d.proveedores.filter((p) => p.tipo !== "contratista").sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => [p.id, p.nombre]), f.prov)}</select></div>
      <label class="row small"><input type="checkbox" id="fTodas" ${f.todas ? "checked" : ""}> Todas las campañas</label></div>
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th>Fecha</th><th>Comprobante</th><th>Proveedor</th><th class="hide-m">Productos</th><th class="right">Total</th><th>Estado</th></tr>
      ${lista.map((c) => `<tr class="click" data-c="${c.id}"><td class="num">${fechaAR(c.fecha)}</td><td>${esc(nombreTipoComp(c.tipo))} ${esc(c.letra || "")}<div class="small muted num">${esc(c.numero || "")}</div></td><td>${esc(proveedorDe(c.proveedor_id)?.nombre || c.proveedor_nombre || "—")}</td><td class="small hide-m">${(c.items || []).filter((i) => !i.ignorar).slice(0, 3).map((i) => esc(productoDe(i.producto_id)?.nombre || i.descripcion)).join(", ")}${(c.items || []).length > 3 ? "…" : ""}</td><td class="num right">${c.total != null ? fmtM(c.total, c.moneda, 2) : "—"}</td><td>${c.estado === "confirmado" ? '<span class="pill ok">Confirmado</span>' : '<span class="pill warn">Revisar</span>'}</td></tr>`).join("")}</table></div></div>`
      : `<div class="empty">No hay comprobantes${f.estado || f.prov || f.tipo ? " con ese filtro" : " en esta campaña"}. Sacá una foto de una factura o remito, o subí el PDF de una factura electrónica: se leen el proveedor, los productos, las cantidades y los precios, y vos lo revisás antes de confirmar.</div>`}
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#bFoto").onclick = () => document.getElementById("fFoto").click();
  $("#bPdf").onclick = () => document.getElementById("fDoc").click();
  $("#bMan").onclick = async () => { const c = await guardar("comprobantes", { id: uid(), tipo: "factura", estado: "borrador", origen: "manual", items: [], archivos: [], mueve_stock: true, moneda: "ARS", fecha: hoy() }); Comprobantes.revisar(c); };
  $("#fE").onchange = (e) => { f.estado = e.target.value; Vistas.comprobantes(); };
  $("#fTi").onchange = (e) => { f.tipo = e.target.value; Vistas.comprobantes(); };
  $("#fP").onchange = (e) => { f.prov = e.target.value; Vistas.comprobantes(); };
  $("#fTodas").onchange = (e) => { f.todas = e.target.checked; Vistas.comprobantes(); };
  el.querySelectorAll("[data-c]").forEach((tr) => (tr.onclick = () => Comprobantes.revisar(S.d.comprobantes.find((c) => c.id === tr.dataset.c))));
};
