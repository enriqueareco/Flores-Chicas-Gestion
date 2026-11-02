"use strict";
/* ============ Labores, aplicaciones y dictado ============ */
const tipoProdPorLabor = (t) => ({ Pulverización: "herbicida", Fertilización: "fertilizante", Siembra: "semilla" }[t] || "otro");
const unidadPorTipo = (t) => ({ Pulverización: "L/ha", Fertilización: "kg/ha", Siembra: "kg/ha" }[t] || "L/ha");
const COND = [["hora", "Hora", "time"], ["viento_kmh", "Viento km/h", "decimal"], ["direccion_viento", "Dirección", "text"], ["temperatura", "Temp. °C", "decimal"], ["humedad", "Humedad %", "decimal"], ["caudal_lha", "Caudal L/ha", "decimal"], ["receta", "N° receta agronómica", "text"], ["ing_agronomo", "Ing. agrónomo", "text"], ["aplicador", "Aplicador / equipo", "text"]];

function textoInsumos(l) { return (l.insumos || []).map((i) => `${i.nombre} ${fmt(i.dosis, 2)} ${i.unidad}`).join(" + "); }

const Labores = {
  form(lab, def = {}, alGuardar) {
    const x = lab ? { ...lab } : { tipo: "Pulverización", fecha: hoy(), costo_estado: "a_definir", moneda: "USD", insumos: [], condiciones: {}, origen: "manual", ...def };
    if (!lab && x.lote_id && x.superficie_ha == null) x.superficie_ha = +(haUbic(x.lote_id, x.sub_id) || 0).toFixed(1) || null;
    let insumos = (x.insumos || []).map((i) => ({ ...i }));
    const cond = { ...(x.condiciones || {}) };
    const orden = x.orden_id ? S.d.ordenes.find((o) => o.id === x.orden_id) : null;
    modal(`<h4>${lab ? "Labor" : "Nueva labor"}${orden ? ` · Orden N° ${orden.numero}` : ""}</h4>
      ${x._dudas ? `<div class="aviso"><b>Revisar:</b> ${esc(x._dudas)}</div>` : ""}
      ${x.origen === "dictado" && !lab ? `<div class="small muted">Completado a partir del dictado. Revisá los datos antes de guardar.</div>` : ""}
      <div class="row"><div class="field grow" style="min-width:200px"><label class="lbl" for="lbLote">Lote</label><select id="lbLote">${opcionesLotes(x.lote_id)}</select></div>
        <div class="field grow" id="lbSubF"><label class="lbl" for="lbSub">Sector</label><select id="lbSub"></select></div></div>
      <div class="row"><div class="field"><label class="lbl" for="lbFecha">Fecha</label><input type="date" id="lbFecha" value="${esc(x.fecha || "")}"></div>
        <div class="field grow"><label class="lbl" for="lbTipo">Labor</label><select id="lbTipo">${opciones(TIPOS_LABOR, x.tipo)}</select></div>
        <div class="field"><label class="lbl" for="lbHa">Superficie ha</label><input id="lbHa" inputmode="decimal" value="${x.superficie_ha ?? ""}" style="width:100px"></div></div>
      <div class="field"><label class="lbl" for="lbCont">Contratista o quien la hizo</label><input id="lbCont" list="dlCont" value="${esc(x.contratista || "")}" placeholder="Ej. Martínez Servicios, personal propio">${datalistContratistas()}</div>
      <div class="row" style="justify-content:space-between"><h2>Insumos</h2><button class="small" id="lbAddI">+ Insumo</button></div>
      <div id="lbIns" class="col" style="gap:6px"></div>${datalistProductos()}
      <div id="lbCondBox" class="col" style="gap:8px"><h2>Condiciones de aplicación</h2>
        <div class="row">${COND.map(([k, t, tp]) => `<div class="field" style="${k === "ing_agronomo" || k === "aplicador" ? "flex:1;min-width:150px" : ""}"><label class="lbl" for="cd_${k}">${t}</label><input id="cd_${k}" ${tp === "time" ? 'type="time"' : tp === "decimal" ? 'inputmode="decimal" style="width:90px"' : ""} value="${esc(cond[k] ?? "")}"></div>`).join("")}</div></div>
      <h2>Costo de la labor</h2>
      <div class="row"><div class="field"><label class="lbl" for="lbCostE">Precio</label><select id="lbCostE">${opciones([["a_definir", "A definir"], ["acordado", "Acordado"]], x.costo_estado)}</select></div>
        <div class="field"><label class="lbl" for="lbCosto">Precio por ha</label><input id="lbCosto" inputmode="decimal" value="${x.costo_ha ?? ""}" style="width:110px"></div>
        <div class="field"><label class="lbl" for="lbMon">Moneda</label><select id="lbMon">${opciones([["USD", "US$"], ["ARS", "$"]], x.moneda || "USD")}</select></div>
        <div class="small muted" id="lbCostoTot" style="align-self:flex-end;padding-bottom:6px"></div></div>
      <div class="field"><label class="lbl" for="lbNot">Notas</label><textarea id="lbNot" style="min-height:50px">${esc(x.notas || "")}</textarea></div>
      <div class="pie">${lab ? '<button class="ghost danger" id="lbDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="lbOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      const ha = () => num($("#lbHa").value) || 0;
      const subs = () => { const l = loteDe($("#lbLote").value); $("#lbSubF").hidden = !l?.subs?.length; $("#lbSub").innerHTML = opcionesSubs(l, x.sub_id); };
      const leerIns = () => $("#lbIns").querySelectorAll("[data-k]").forEach((row) => { const i = insumos[+row.dataset.k]; if (!i) return; row.querySelectorAll("[data-f]").forEach((inp) => { const f = inp.dataset.f; i[f] = f === "dosis" ? num(inp.value) : inp.value; }); i.producto_id = buscarProducto(i.nombre)?.id || null; });
      const totFila = (row, i) => { const t = cantidadInsumo(i, ha()); row.querySelector(".tot").textContent = i.dosis ? fmt(t.cant, 1) + " " + t.unidad : ""; };
      const pintarIns = (leer = true) => {
        if (leer) leerIns();
        $("#lbIns").innerHTML = insumos.length ? insumos.map((i, k) => `<div class="ins-row" data-k="${k}"><input data-f="nombre" list="dlProd" value="${esc(i.nombre || "")}" placeholder="Producto" aria-label="Producto"><input data-f="dosis" inputmode="decimal" value="${i.dosis ?? ""}" placeholder="Dosis" aria-label="Dosis"><select data-f="unidad" aria-label="Unidad">${opciones(UNIDADES_DOSIS, i.unidad)}</select><span class="num small tot"></span><button class="ghost small danger" data-q="${k}" title="Quitar insumo">✕</button></div>`).join("") : `<div class="small muted">Sin insumos.</div>`;
        $("#lbIns").querySelectorAll("[data-k]").forEach((row) => { const i = insumos[+row.dataset.k]; totFila(row, i); row.querySelectorAll("[data-f]").forEach((inp) => (inp.oninput = inp.onchange = () => { const f = inp.dataset.f; i[f] = f === "dosis" ? num(inp.value) : inp.value; totFila(row, i); })); });
        $("#lbIns").querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { leerIns(); insumos.splice(+b.dataset.q, 1); pintarIns(false); }));
      };
      const costoTot = () => { const c = num($("#lbCosto").value); $("#lbCostoTot").textContent = c && ha() ? "Total " + fmtM(c * ha(), $("#lbMon").value) : ""; };
      const verCond = () => { $("#lbCondBox").hidden = $("#lbTipo").value !== "Pulverización"; };
      subs(); pintarIns(false); costoTot(); verCond();
      $("#lbLote").onchange = () => { x.sub_id = null; subs(); $("#lbHa").value = (haUbic($("#lbLote").value, null) || 0).toFixed(1); pintarIns(); costoTot(); };
      $("#lbSub").onchange = () => { $("#lbHa").value = (haUbic($("#lbLote").value, $("#lbSub").value || null) || 0).toFixed(1); pintarIns(); costoTot(); };
      $("#lbHa").oninput = () => { pintarIns(); costoTot(); };
      $("#lbCosto").oninput = () => { if (num($("#lbCosto").value)) $("#lbCostE").value = "acordado"; costoTot(); };
      $("#lbMon").onchange = costoTot;
      $("#lbTipo").onchange = verCond;
      $("#lbAddI").onclick = () => { leerIns(); insumos.push({ nombre: "", dosis: null, unidad: unidadPorTipo($("#lbTipo").value), producto_id: null }); pintarIns(false); const r = $("#lbIns").querySelectorAll("[data-f=nombre]"); r[r.length - 1]?.focus(); };
      $("#mNo").onclick = close;
      if ($("#lbDel")) $("#lbDel").onclick = async () => {
        if (!(await confirmar("¿Eliminar esta labor? Los insumos usados vuelven al stock."))) return;
        if (orden) { orden.estado = "pendiente"; orden.labor_id = null; await guardar("ordenes", orden); }
        await borrar("labores", lab.id); close(); afterSave();
      };
      const afterSave = () => { dibujarLotes(); if (S.vista === "mapa") render(); else refrescar(); };
      $("#lbOk").onclick = async () => {
        leerIns();
        if (!$("#lbLote").value) { toast("Elegí el lote."); $("#lbLote").focus(); return; }
        if (!$("#lbFecha").value) { toast("Falta la fecha."); return; }
        const fin = cargando("Guardando…");
        try {
          const ct = await asegurarContratista($("#lbCont").value);
          const h = ha(); const tipo = $("#lbTipo").value;
          const ins = [];
          for (const i of insumos) {
            if (!String(i.nombre || "").trim()) continue;
            const p = await asegurarProducto(i.nombre, { tipo: tipoProdPorLabor(tipo), unidad: dosisABase(1, i.unidad)[1] });
            ins.push({ producto_id: p.id, nombre: p.nombre, dosis: i.dosis, unidad: i.unidad, cantidad: +cantidadInsumo(i, h).cant.toFixed(3) });
          }
          const c = {}; if (tipo === "Pulverización") for (const [k, , tp] of COND) { const v = $("#cd_" + k).value.trim(); if (v) c[k] = tp === "decimal" ? num(v) : v; }
          const n = { ...x, id: x.id || uid(), lote_id: $("#lbLote").value, sub_id: $("#lbSub").value || null, fecha: $("#lbFecha").value, campana: campanaDeFecha($("#lbFecha").value), tipo, contratista_id: ct.id, contratista: ct.nombre, superficie_ha: h || null, costo_ha: num($("#lbCosto").value), moneda: $("#lbMon").value, costo_estado: $("#lbCostE").value, insumos: ins, condiciones: c, notas: $("#lbNot").value.trim() || null };
          delete n._dudas;
          await guardar("labores", n);
          if (orden && orden.estado !== "realizada") { orden.estado = "realizada"; orden.labor_id = n.id; await guardar("ordenes", orden); }
          close(); afterSave(); toast("Labor guardada"); alGuardar && alGuardar(n);
        } catch (e) { toast(e.message, 7000); } finally { fin(); }
      };
    }, "medio");
  },

  dictado() {
    modal(`<h4>Dictar labor</h4>
      <div class="small muted">Contá qué se hizo, en qué lote, con qué productos y dosis, y quién lo hizo. En el teléfono tocá el <b>micrófono del teclado</b> y hablá. Podés contar varias labores juntas.</div>
      <textarea id="dTxt" style="min-height:140px" placeholder="Ej.: Ayer Martínez pulverizó el lote 12 con glifosato a 2 litros y 2,4-D a 0,8 litros por hectárea, viento de 10 del norte."></textarea>
      <div id="dErr"></div>
      <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="dOk">Interpretar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
      $("#dOk").onclick = async () => {
        const texto = $("#dTxt").value.trim(); if (!texto) return;
        const fin = cargando("Interpretando…");
        try {
          const ctx = {
            lotes: S.d.lotes.map((l) => ({ id: l.id, nombre: l.nombre, campo: l.campo, ha: +haDe(l.geom).toFixed(1), sectores: l.subs.map((s) => ({ id: s.id, nombre: s.nombre })), cultivo: textoCultivos(l) })),
            productos: S.d.productos.map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, principio_activo: p.principio_activo })),
            contratistas: S.d.proveedores.filter((p) => p.tipo !== "proveedor").map((p) => ({ id: p.id, nombre: p.nombre })),
          };
          const r = await DB.ia("dictado", { texto, hoy: hoy(), campana: S.campana, contexto: ctx });
          const labs = (r.datos?.labores || []).map((d) => Labores.desdeIA(d, texto));
          fin(); close();
          if (!labs.length) { toast("No encontré labores en el texto."); return; }
          Labores.revisarVarias(labs);
        } catch (e) { fin(); $("#dErr").innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
      };
    });
  },
  desdeIA(d, texto) {
    const l = loteDe(d.lote_id); const sub = l && subDe(l, d.sub_id) ? d.sub_id : null;
    const ct = d.contratista_id ? proveedorDe(d.contratista_id) : null;
    const ha = d.superficie_ha ?? (l ? +haUbic(l.id, sub).toFixed(1) : null);
    return {
      lote_id: l ? l.id : null, sub_id: sub, fecha: d.fecha || hoy(), tipo: TIPOS_LABOR.includes(d.tipo) ? d.tipo : "Otra",
      contratista: ct?.nombre || d.contratista || "", superficie_ha: ha, costo_ha: d.costo_ha ?? null, moneda: d.moneda || "USD", costo_estado: d.costo_ha ? "acordado" : "a_definir",
      insumos: (d.insumos || []).map((i) => { const p = i.producto_id ? productoDe(i.producto_id) : buscarProducto(i.nombre); return { producto_id: p?.id || null, nombre: p?.nombre || i.nombre, dosis: i.dosis, unidad: i.unidad || "L/ha" }; }),
      condiciones: Object.fromEntries(Object.entries(d.condiciones || {}).filter(([, v]) => v != null)),
      notas: [d.notas, `Dictado: «${texto.slice(0, 400)}»`].filter(Boolean).join("\n"), origen: "dictado", _dudas: [d.dudas, l ? null : "No identifiqué el lote."].filter(Boolean).join(" "),
    };
  },
  revisarVarias(labs) {
    if (labs.length === 1) { Labores.form(null, labs[0]); return; }
    const hechas = new Set();
    const abrir = () => modal(`<h4>${labs.length} labores para revisar</h4>
      <div class="col">${labs.map((l, i) => `<div class="card" style="padding:10px"><div class="row" style="justify-content:space-between"><div><b>${esc(l.tipo)}</b> · ${esc(l.lote_id ? nombreUbic(l.lote_id, l.sub_id) : "lote sin identificar")} · ${fechaAR(l.fecha)}<div class="small muted">${esc(textoInsumos(l))}</div></div>${hechas.has(i) ? '<span class="pill ok">Guardada</span>' : `<button class="primary" data-r="${i}">Revisar</button>`}</div></div>`).join("")}</div>
      <div class="pie"><button id="mNo">Cerrar</button></div>`, (m, close) => {
      m.querySelector("#mNo").onclick = close;
      m.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { close(); const i = +b.dataset.r; Labores.form(null, labs[i], () => { hechas.add(i); if (hechas.size < labs.length) abrir(); }); }));
    });
    abrir();
  },
  precioMasivo(ids) {
    const sel = S.d.labores.filter((l) => ids.includes(l.id));
    const ha = sel.reduce((a, l) => a + (Number(l.superficie_ha) || 0), 0);
    modal(`<h4>Poner precio a ${sel.length} labor${sel.length > 1 ? "es" : ""}</h4><div class="small muted">${fmt(ha, 1)} ha en total.</div>
      <div class="row"><div class="field"><label class="lbl" for="pmP">Precio por ha</label><input id="pmP" inputmode="decimal" style="width:120px" autofocus></div>
      <div class="field"><label class="lbl" for="pmM">Moneda</label><select id="pmM">${opciones([["USD", "US$"], ["ARS", "$"]], "USD")}</select></div><div class="small muted" id="pmT" style="align-self:flex-end;padding-bottom:6px"></div></div>
      <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Aplicar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
      $("#pmP").oninput = () => { const p = num($("#pmP").value); $("#pmT").textContent = p ? "Total " + fmtM(p * ha, $("#pmM").value) : ""; };
      $("#mOk").onclick = async () => {
        const p = num($("#pmP").value); if (p == null) { $("#pmP").focus(); return; }
        const fin = cargando("Guardando…");
        try { for (const l of sel) { l.costo_ha = p; l.moneda = $("#pmM").value; l.costo_estado = "acordado"; } await DB.guardarVarios("labores", sel); close(); S.selLab = new Set(); refrescar(); toast("Precios actualizados"); }
        catch (e) { toast(e.message, 6000); } finally { fin(); }
      };
    });
  },
};

/* ---------- Vista Labores ---------- */
Vistas.labores = function () {
  const el = document.getElementById("v-labores");
  const f = S.filtroLab || (S.filtroLab = { lote: "", tipo: "", cont: "", costo: "" });
  S.selLab = S.selLab || new Set();
  const lista = S.d.labores.filter((l) => l.campana === S.campana && (!f.lote || l.lote_id === f.lote) && (!f.tipo || l.tipo === f.tipo) && (!f.cont || (l.contratista || "") === f.cont) && (!f.costo || l.costo_estado === f.costo)).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  const precios = preciosProductos();
  const deCamp = S.d.labores.filter((l) => l.campana === S.campana);
  const aDef = deCamp.filter((l) => l.costo_estado !== "acordado").length;
  let cl = { USD: 0, ARS: 0 }, ci = 0; for (const l of deCamp) { const c = costoLabor(l, precios); ci += c.insumosUSD; if (l.costo_estado === "acordado" && c.labor != null) cl[c.moneda] += c.labor; }
  const conts = [...new Set(S.d.labores.map((l) => l.contratista).filter(Boolean))].sort();
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Labores ${esc(S.campana)}</h1><div class="row"><button class="primary" id="bNL">+ Labor</button><button id="bDic">🎤 Dictar labor</button><button id="bCsv" class="hide-m">Exportar CSV</button></div></div>
    <div class="kpis"><div class="kpi"><span>Labores</span><b>${deCamp.length}</b></div><div class="kpi ${aDef ? "alerta" : ""}"><span>Precio a definir</span><b>${aDef}</b></div>
      <div class="kpi"><span>Costo labores</span><b>${cl.USD || !cl.ARS ? fmtM(cl.USD, "USD") : ""}${cl.ARS ? (cl.USD ? " + " : "") + fmtM(cl.ARS, "ARS") : ""}</b></div><div class="kpi"><span>Costo insumos</span><b>${fmtM(ci, "USD")}</b></div></div>
    <div class="filtros"><div class="field grow" style="min-width:160px"><label class="lbl" for="fL">Lote</label><select id="fL"><option value="">Todos</option>${opcionesLotes(f.lote, false)}</select></div>
      <div class="field"><label class="lbl" for="fT">Labor</label><select id="fT"><option value="">Todas</option>${opciones(TIPOS_LABOR, f.tipo)}</select></div>
      <div class="field"><label class="lbl" for="fC">Contratista</label><select id="fC"><option value="">Todos</option>${opciones(conts, f.cont)}</select></div>
      <div class="field"><label class="lbl" for="fK">Precio</label><select id="fK"><option value="">Todos</option>${opciones([["a_definir", "A definir"], ["acordado", "Acordado"]], f.costo)}</select></div></div>
    ${S.selLab.size ? `<div class="row aviso" style="border-color:var(--accent)"><b>${S.selLab.size} seleccionada${S.selLab.size > 1 ? "s" : ""}</b><button class="primary" id="bPM">Poner precio</button><button class="ghost" id="bSN">Quitar selección</button></div>` : ""}
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th><input type="checkbox" id="ckAll" aria-label="Seleccionar todas" ${lista.every((l) => S.selLab.has(l.id)) ? "checked" : ""}></th><th>Fecha</th><th>Lote</th><th>Labor</th><th class="hide-m">Insumos</th><th class="right">ha</th><th class="right">Precio/ha</th><th class="right hide-m">Total</th></tr>
      ${lista.map((l) => { const c = costoLabor(l, precios); return `<tr class="click" data-l="${l.id}"><td><input type="checkbox" data-ck="${l.id}" ${S.selLab.has(l.id) ? "checked" : ""} aria-label="Seleccionar"></td><td class="num">${fechaAR(l.fecha)}</td><td>${esc(nombreUbic(l.lote_id, l.sub_id))}</td><td>${esc(l.tipo)}${l.contratista ? `<div class="small muted">${esc(l.contratista)}</div>` : ""}</td><td class="small hide-m">${esc(textoInsumos(l)) || "—"}</td><td class="num right">${fmt(l.superficie_ha, 1)}</td><td class="num right">${l.costo_estado === "acordado" ? fmtM(l.costo_ha, l.moneda, 2) : '<span class="pill warn">a definir</span>'}</td><td class="num right hide-m">${l.costo_estado === "acordado" && c.labor != null ? fmtM(c.labor, l.moneda) : "—"}</td></tr>`; }).join("")}</table></div></div>
      <div class="small muted">Para acordar el precio después: filtrá por contratista y "a definir", seleccioná las labores y tocá "Poner precio".</div>`
      : `<div class="empty">No hay labores${f.lote || f.tipo || f.cont || f.costo ? " con ese filtro" : " en esta campaña"}. Cargalas a mano, dictándolas desde el teléfono o desde una orden de trabajo realizada.</div>`}
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#bNL").onclick = () => Labores.form(null, f.lote ? { lote_id: f.lote } : {});
  $("#bDic").onclick = () => Labores.dictado();
  $("#bCsv").onclick = () => descargar(`labores_${S.campana.replace("/", "-")}.csv`, csv([["Fecha", "Campaña", "Establecimiento", "Lote", "Sector", "Labor", "Contratista", "ha", "Insumos", "Precio/ha", "Moneda", "Estado precio", "Total labor", "Costo insumos US$", "Notas"], ...lista.map((l) => { const lo = loteDe(l.lote_id); const c = costoLabor(l, precios); return [l.fecha, l.campana, lo?.campo, lo?.nombre, lo ? subDe(lo, l.sub_id)?.nombre : "", l.tipo, l.contratista, l.superficie_ha, textoInsumos(l), l.costo_ha, l.moneda, l.costo_estado === "acordado" ? "Acordado" : "A definir", l.costo_estado === "acordado" ? c.labor : null, +c.insumosUSD.toFixed(2), l.notas]; })]), "text/csv");
  ["fL:lote", "fT:tipo", "fC:cont", "fK:costo"].forEach((s) => { const [id, k] = s.split(":"); $("#" + id).onchange = (e) => { f[k] = e.target.value; Vistas.labores(); }; });
  el.querySelectorAll("[data-l]").forEach((tr) => (tr.onclick = (e) => { if (e.target.matches("input")) return; Labores.form(S.d.labores.find((x) => x.id === tr.dataset.l)); }));
  el.querySelectorAll("[data-ck]").forEach((ck) => (ck.onchange = () => { ck.checked ? S.selLab.add(ck.dataset.ck) : S.selLab.delete(ck.dataset.ck); Vistas.labores(); }));
  if ($("#ckAll")) $("#ckAll").onchange = (e) => { lista.forEach((l) => (e.target.checked ? S.selLab.add(l.id) : S.selLab.delete(l.id))); Vistas.labores(); };
  if ($("#bPM")) $("#bPM").onclick = () => Labores.precioMasivo([...S.selLab]);
  if ($("#bSN")) $("#bSN").onclick = () => { S.selLab = new Set(); Vistas.labores(); };
};

/* ---------- Vista Aplicaciones (registro de agroquímicos) ---------- */
Vistas.aplicaciones = function () {
  const el = document.getElementById("v-aplicaciones");
  const f = S.filtroApl || (S.filtroApl = { lote: "", q: "", todas: false });
  const lista = S.d.labores.filter((l) => l.tipo === "Pulverización" && (f.todas || l.campana === S.campana) && (!f.lote || l.lote_id === f.lote) && (!f.q || (l.insumos || []).some((i) => norm(i.nombre + " " + (productoDe(i.producto_id)?.principio_activo || "")).includes(norm(f.q))))).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  const porPA = {};
  for (const l of lista) for (const i of l.insumos || []) { const p = productoDe(i.producto_id); const k = (p?.principio_activo || p?.nombre || i.nombre || "").trim() || "—"; const t = cantidadInsumo(i, l.superficie_ha); const a = (porPA[k] ??= { cant: 0, unidad: t.unidad, ha: 0, n: 0, tipo: p?.tipo }); a.cant += i.cantidad != null ? Number(i.cantidad) : t.cant; a.ha += Number(l.superficie_ha) || 0; a.n++; }
  const cultivoDe = (l) => { const lo = loteDe(l.lote_id); return lo ? [...new Set(cultivosDe(lo, l.sub_id || undefined, l.campana).map((s) => s.cultivo))].join(" / ") : ""; };
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Aplicaciones de agroquímicos</h1><div class="row"><button class="primary" id="bNA">+ Aplicación</button><button id="bCsvA">Exportar registro (CSV)</button></div></div>
    <div class="filtros"><div class="field grow" style="min-width:160px"><label class="lbl" for="aL">Lote</label><select id="aL"><option value="">Todos</option>${opcionesLotes(f.lote, false)}</select></div>
      <div class="field grow"><label class="lbl" for="aQ">Producto o principio activo</label><input id="aQ" value="${esc(f.q)}" placeholder="Ej. atrazina"></div>
      <label class="row small"><input type="checkbox" id="aT" ${f.todas ? "checked" : ""}> Todas las campañas</label></div>
    ${Object.keys(porPA).length ? `<div class="card"><h2>Total por principio activo</h2><div class="tablewrap"><table class="t"><tr><th>Principio activo</th><th class="right">Cantidad</th><th class="right">Aplicaciones</th><th class="right">ha tratadas</th></tr>${Object.entries(porPA).sort((a, b) => b[1].cant - a[1].cant).map(([k, a]) => `<tr><td>${esc(k)}</td><td class="num right">${fmt(a.cant, 1)} ${a.unidad}</td><td class="num right">${a.n}</td><td class="num right">${fmt(a.ha, 0)}</td></tr>`).join("")}</table></div></div>` : ""}
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th>Fecha</th><th>Lote</th><th>Cultivo</th><th>Productos y dosis</th><th class="right">ha</th><th class="hide-m">Condiciones</th><th class="hide-m">Receta</th></tr>
      ${lista.map((l) => { const c = l.condiciones || {}; return `<tr class="click" data-l="${l.id}"><td class="num">${fechaAR(l.fecha)}${c.hora ? `<div class="small muted">${esc(c.hora)}</div>` : ""}</td><td>${esc(nombreUbic(l.lote_id, l.sub_id))}${l.contratista ? `<div class="small muted">${esc(l.contratista)}</div>` : ""}</td><td class="small">${esc(cultivoDe(l)) || "—"}</td><td class="small">${(l.insumos || []).map((i) => { const t = cantidadInsumo(i, l.superficie_ha); return `${esc(i.nombre)} <span class="num">${fmt(i.dosis, 2)} ${esc(i.unidad)}</span> <span class="muted num">(${fmt(i.cantidad ?? t.cant, 1)} ${t.unidad})</span>`; }).join("<br>") || "—"}</td><td class="num right">${fmt(l.superficie_ha, 1)}</td><td class="small hide-m">${[c.viento_kmh != null ? `Viento ${fmt(c.viento_kmh, 0)} km/h ${esc(c.direccion_viento || "")}` : "", c.temperatura != null ? `${fmt(c.temperatura, 0)} °C` : "", c.humedad != null ? `HR ${fmt(c.humedad, 0)}%` : "", c.caudal_lha != null ? `${fmt(c.caudal_lha, 0)} L/ha` : ""].filter(Boolean).join(" · ") || "—"}</td><td class="small hide-m">${esc(c.receta || "")}${c.ing_agronomo ? `<div class="muted">${esc(c.ing_agronomo)}</div>` : ""}</td></tr>`; }).join("")}</table></div></div>`
      : `<div class="empty">No hay pulverizaciones registradas${f.lote || f.q ? " con ese filtro" : " en esta campaña"}. Cada pulverización que cargues como labor aparece acá con sus productos, dosis, condiciones y receta agronómica.</div>`}
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#bNA").onclick = () => Labores.form(null, { tipo: "Pulverización", lote_id: f.lote || null });
  $("#aL").onchange = (e) => { f.lote = e.target.value; Vistas.aplicaciones(); };
  $("#aT").onchange = (e) => { f.todas = e.target.checked; Vistas.aplicaciones(); };
  $("#aQ").onchange = (e) => { f.q = e.target.value; Vistas.aplicaciones(); };
  el.querySelectorAll("[data-l]").forEach((tr) => (tr.onclick = () => Labores.form(S.d.labores.find((x) => x.id === tr.dataset.l))));
  $("#bCsvA").onclick = () => {
    const filas = [["Fecha", "Hora", "Campaña", "Establecimiento", "Lote", "Sector", "Cultivo", "ha", "Producto", "Principio activo", "Dosis", "Unidad", "Cantidad total", "Contratista", "Aplicador", "Viento km/h", "Dirección", "Temp °C", "Humedad %", "Caudal L/ha", "Receta", "Ing. agrónomo"]];
    for (const l of lista) { const lo = loteDe(l.lote_id); const c = l.condiciones || {}; for (const i of l.insumos || []) { const p = productoDe(i.producto_id); filas.push([l.fecha, c.hora, l.campana, lo?.campo, lo?.nombre, lo ? subDe(lo, l.sub_id)?.nombre : "", cultivoDe(l), l.superficie_ha, i.nombre, p?.principio_activo, i.dosis, i.unidad, i.cantidad, l.contratista, c.aplicador, c.viento_kmh, c.direccion_viento, c.temperatura, c.humedad, c.caudal_lha, c.receta, c.ing_agronomo]); } }
    descargar(`aplicaciones_${f.todas ? "todas" : S.campana.replace("/", "-")}.csv`, csv(filas), "text/csv");
  };
};
