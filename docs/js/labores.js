"use strict";
/* ============ Labores, aplicaciones y dictado ============ */
/* La campaña de una siembra: desde abril se siembra para la campaña que empieza ese año (fina, pasturas, gruesa) */
function campanaDeSiembra(f) { if (!f) return S.campana; const d = new Date(f + "T12:00"); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${String(y + 1).slice(2)}`; }
/* Adivina el cultivo por el nombre de la semilla elegida (ej. "Maíz DK 72-10") */
function cultivoPorSemilla(insumos) {
  const claves = Object.keys(CULTIVOS).filter((c) => !["Otro", "Barbecho", "Campo natural", "Soja 2da", "Promoción de ryegrass", "Maíz de pastoreo", "Verdeo"].includes(c)).sort((a, b) => b.length - a.length);
  for (const i of insumos) { const p = productoDe(i.producto_id); if (!p || p.tipo !== "semilla") continue; const n = norm(p.nombre + " " + (p.principio_activo || "")); const c = claves.find((k) => n.includes(norm(k))); if (c) return { cultivo: c, semilla: p }; }
  const p = insumos.map((i) => productoDe(i.producto_id)).find((p) => p?.tipo === "semilla"); return p ? { cultivo: null, semilla: p } : null;
}
const tipoProdPorLabor = (t) => ({ Pulverización: "herbicida", Fertilización: "fertilizante", Siembra: "semilla" }[t] || "otro");
const unidadPorTipo = (t) => ({ Pulverización: "L/ha", Fertilización: "kg/ha", Siembra: "kg/ha" }[t] || "L/ha");
const COND = [["hora", "Hora", "time"], ["viento_kmh", "Viento km/h", "decimal"], ["direccion_viento", "Dirección", "text"], ["temperatura", "Temp. °C", "decimal"], ["humedad", "Humedad %", "decimal"], ["caudal_lha", "Caudal L/ha", "decimal"], ["receta", "N° receta agronómica", "text"], ["ing_agronomo", "Ing. agrónomo", "text"], ["aplicador", "Aplicador / equipo", "text"]];

function textoInsumos(l) { return (l.insumos || []).map((i) => `${i.nombre} ${fmt(i.dosis, 2)} ${i.unidad}`).join(" + "); }

const Labores = {
  form(lab, def = {}, alGuardar) {
    const x = lab ? { ...lab } : { fecha: hoy(), moneda: "USD", insumos: [], condiciones: {}, origen: "manual", ...def };
    if (!lab && !x.labor_tipo_id && x.tipo) { const ts = S.d.labores_tipo.filter((t) => t.activo !== false && t.categoria === x.tipo); if (ts.length === 1) x.labor_tipo_id = ts[0].id; }
    if (!lab && x.lote_id && x.superficie_ha == null) x.superficie_ha = +(haUbic(x.lote_id, x.sub_id) || 0).toFixed(1) || null;
    const insumos = (x.insumos || []).map((i) => ({ ...i }));
    const cond = { ...(x.condiciones || {}) };
    const orden = x.orden_id ? S.d.ordenes.find((o) => o.id === x.orden_id) : null;
    let manual = x.costo_estado === "acordado" || (x.costo_estado === "a_definir" && !!lab && !x.labor_tipo_id);
    let recetaPrevia = null;
    modal(`<h4>${lab ? "Labor" : "Nueva labor"}${orden ? ` · Orden N° ${orden.numero}` : ""}</h4>
      ${x._dudas ? `<div class="aviso"><b>Revisar:</b> ${esc(x._dudas)}</div>` : ""}
      ${x.origen === "dictado" && !lab ? `<div class="small muted">Completado a partir del dictado. Revisá los datos antes de guardar.</div>` : ""}
      ${!S.d.labores_tipo.length ? `<div class="aviso">Todavía no hay labores en el catálogo. Elegí "Agregar una labor al catálogo" en la lista.</div>` : ""}
      <div class="row"><div class="field grow" style="min-width:200px"><label class="lbl" for="lbLote">Lote</label><select id="lbLote">${opcionesLotes(x.lote_id)}</select></div>
        <div class="field grow" id="lbSubF"><label class="lbl" for="lbSub">Sector</label><select id="lbSub"></select></div></div>
      <div class="row"><div class="field grow" style="min-width:220px"><label class="lbl" for="lbTipo">¿Qué labor es?</label><select id="lbTipo">${opcionesCatalogo(x.labor_tipo_id)}</select>${lab && !x.labor_tipo_id && x.tipo ? `<span class="small muted">Cargada antes del catálogo como «${esc(x.tipo)}»</span>` : ""}</div>
        <div class="field"><label class="lbl" for="lbFecha">Fecha</label><input type="date" id="lbFecha" value="${esc(x.fecha || "")}"></div>
        <div class="field"><label class="lbl" for="lbHa">Superficie ha</label><input id="lbHa" inputmode="decimal" value="${x.superficie_ha ?? ""}" style="width:100px"></div></div>
      <div class="field"><label class="lbl" for="lbCont">Contratista o quien la hizo</label><input id="lbCont" list="dlCont" value="${esc(x.contratista || "")}" placeholder="Ej. Martínez Servicios, personal propio">${datalistContratistas()}</div>
      <div class="row" style="justify-content:space-between"><h2>Insumos</h2><button type="button" class="small" id="lbAddI">+ Insumo</button></div>
      <div id="lbIns" class="col" style="gap:6px"></div>
      <div id="lbSiemBox" class="col" style="gap:8px"><h2>Qué se sembró</h2>
        <div class="row"><div class="field grow"><label class="lbl" for="lbCult">Cultivo</label><select id="lbCult"><option value="">Elegir cultivo…</option>${opciones(Object.keys(CULTIVOS))}</select></div>
          <div class="field grow"><label class="lbl" for="lbVar">Híbrido / variedad</label><input id="lbVar" list="dlVar" placeholder="Ej. DK 72-10"><datalist id="dlVar">${[...new Set(S.d.siembras.map((y) => y.hibrido).filter(Boolean))].map((h) => `<option value="${esc(h)}">`).join("")}</datalist></div>
          <div class="field"><label class="lbl" for="lbCamp">Campaña</label><select id="lbCamp">${opciones(campanas())}</select></div></div>
        <div class="small muted">Al guardar, el cultivo queda cargado en la campaña del lote con esta fecha de siembra.</div></div>
      <div id="lbCondBox" class="col" style="gap:8px"><h2>Condiciones de aplicación</h2>
        <div class="row">${COND.map(([k, t, tp]) => `<div class="field" style="${k === "ing_agronomo" || k === "aplicador" ? "flex:1;min-width:150px" : ""}"><label class="lbl" for="cd_${k}">${t}</label><input id="cd_${k}" ${tp === "time" ? 'type="time"' : tp === "decimal" ? 'inputmode="decimal" style="width:90px"' : ""} value="${esc(cond[k] ?? "")}"></div>`).join("")}</div></div>
      <h2>Precio de la labor</h2><div id="lbPrecio" class="col" style="gap:8px"></div>
      <div class="field"><label class="lbl" for="lbNot">Notas</label><textarea id="lbNot" style="min-height:50px">${esc(x.notas || "")}</textarea></div>
      <div class="pie">${lab ? '<button class="ghost danger" id="lbDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="lbOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      const ha = () => num($("#lbHa").value) || 0;
      const tipoSel = () => laborTipoDe($("#lbTipo").value);
      const ed = editorInsumos($("#lbIns"), insumos, { ha, tipoDef: () => tipoProdPorLabor(tipoSel()?.categoria) });
      const subs = () => { const l = loteDe($("#lbLote").value); $("#lbSubF").hidden = !l?.subs?.length; $("#lbSub").innerHTML = opcionesSubs(l, x.sub_id); };
      const esSiembra = () => (tipoSel()?.categoria || x.tipo) === "Siembra";
      const siemPrev = x.condiciones?.siembra_id ? S.d.siembras.find((y) => y.id === x.condiciones.siembra_id) : null;
      if (siemPrev) { $("#lbCult").value = siemPrev.cultivo; $("#lbVar").value = siemPrev.hibrido || ""; }
      let campTocada = !!siemPrev; $("#lbCamp").value = siemPrev?.campana || campanaDeSiembra($("#lbFecha").value);
      $("#lbCamp").onchange = () => (campTocada = true);
      let cultTocado = !!siemPrev, varTocada = !!siemPrev;
      $("#lbCult").onchange = () => (cultTocado = true); $("#lbVar").oninput = () => (varTocada = true);
      /* Propone cultivo y variedad según la semilla y lo que ya tiene el lote en la campaña */
      const sugerirSiembra = () => {
        if (!esSiembra()) return;
        if (!campTocada) $("#lbCamp").value = campanaDeSiembra($("#lbFecha").value);
        const g = cultivoPorSemilla(insumos);
        if (!varTocada && g?.semilla) { const sin = g.cultivo ? g.semilla.nombre.replace(new RegExp(g.cultivo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[aeiou]/g, "[aeiouáéíóú]"), "i"), "").trim() : ""; $("#lbVar").value = sin || g.semilla.nombre; }
        if (!cultTocado) {
          const l = loteDe($("#lbLote").value); const sub = $("#lbSub").value || undefined;
          let c = g?.cultivo || null;
          const ya = l ? cultivosCargados(l, sub, $("#lbCamp").value) : [];
          if (!c && ya.length === 1 && !ya[0].fecha) c = ya[0].cultivo;
          if (c === "Soja" && ya.some((y) => y.cultivo !== "Soja" && !PERENNES.has(y.cultivo))) c = "Soja 2da";
          if (c) $("#lbCult").value = c;
        }
      };
      const verCond = () => { $("#lbCondBox").hidden = (tipoSel()?.categoria || x.tipo) !== "Pulverización"; $("#lbSiemBox").hidden = !esSiembra(); sugerirSiembra(); };
      const pintarPrecio = () => {
        const t = tipoSel(); const pc = precioCatalogo(t, $("#lbFecha").value || hoy()); const box = $("#lbPrecio");
        const tot = (p, mon) => (p != null && ha() ? ` · total ${fmtM(p * ha(), mon)}` : "");
        if (manual) {
          box.innerHTML = `<div class="row"><div class="field"><label class="lbl" for="lbCosto">Precio por ha</label><input id="lbCosto" inputmode="decimal" value="${x.costo_ha ?? ""}" style="width:110px"></div>
            <div class="field"><label class="lbl" for="lbMon">Moneda</label><select id="lbMon">${opciones([["USD", "US$"], ["ARS", "$"]], x.moneda || "USD")}</select></div><span class="small muted" id="lbTot" style="align-self:flex-end;padding-bottom:6px"></span></div>
            <div class="small muted">Precio solo para esta labor. Si lo dejás vacío queda "a definir".${t ? ' <button type="button" class="ghost small" id="lbUsarCat">Usar el precio del catálogo</button>' : ""}</div>`;
          const upd = () => { const p = num($("#lbCosto").value); $("#lbTot").textContent = p != null && ha() ? "Total " + fmtM(p * ha(), $("#lbMon").value) : ""; x.costo_ha = p; x.moneda = $("#lbMon").value; };
          $("#lbCosto").oninput = upd; $("#lbMon").onchange = upd; upd();
          if ($("#lbUsarCat")) $("#lbUsarCat").onclick = () => { manual = false; pintarPrecio(); };
        } else if (pc) {
          box.innerHTML = `<div class="row"><b class="num">${textoPrecio(pc)}</b><span class="small muted">precio del catálogo${pc.desde ? " desde " + fechaAR(pc.desde) : ""}${tot(pc.precio, pc.moneda)}</span></div>
            <div><button type="button" class="ghost small" id="lbOtro">Otro precio solo para esta labor</button></div>`;
          $("#lbOtro").onclick = () => { manual = true; x.costo_ha = pc.precio; x.moneda = pc.moneda; pintarPrecio(); };
        } else if (t) {
          box.innerHTML = `<div class="aviso">«${esc(t.nombre)}» no tiene precio en el catálogo. Si no lo ponés, queda "a definir".</div>
            <div class="row"><button type="button" class="primary small" id="lbPonerCat">Poner precio en el catálogo</button><button type="button" class="small" id="lbOtro">Precio solo para esta labor</button></div>`;
          $("#lbPonerCat").onclick = () => Catalogo.cambiarPrecio(t, () => pintarPrecio());
          $("#lbOtro").onclick = () => { manual = true; pintarPrecio(); };
        } else box.innerHTML = `<div class="small muted">Elegí la labor para ver su precio.</div>`;
      };
      const aplicarReceta = (t) => {
        const igual = recetaPrevia && JSON.stringify(insumos.map((i) => [i.producto_id, i.dosis, i.unidad])) === JSON.stringify(recetaPrevia);
        if ((!insumos.length || igual) && (t?.insumos || []).length) { ed.reemplazar(t.insumos); recetaPrevia = insumos.map((i) => [i.producto_id, i.dosis, i.unidad]); }
      };
      subs(); verCond(); pintarPrecio();
      $("#lbLote").onchange = () => { x.sub_id = null; subs(); $("#lbHa").value = (haUbic($("#lbLote").value, null) || 0).toFixed(1); ed.refrescarTotales(); pintarPrecio(); };
      $("#lbSub").onchange = () => { $("#lbHa").value = (haUbic($("#lbLote").value, $("#lbSub").value || null) || 0).toFixed(1); ed.refrescarTotales(); pintarPrecio(); };
      $("#lbHa").oninput = () => { ed.refrescarTotales(); pintarPrecio(); };
      $("#lbFecha").onchange = () => { pintarPrecio(); sugerirSiembra(); };
      $("#lbIns").addEventListener("change", () => setTimeout(sugerirSiembra, 0));
      $("#lbTipo").onchange = () => {
        if ($("#lbTipo").value === "__nueva") {
          $("#lbTipo").value = x.labor_tipo_id || "";
          Catalogo.form(null, (t) => { $("#lbTipo").innerHTML = opcionesCatalogo(t.id); x.labor_tipo_id = t.id; aplicarReceta(t); verCond(); pintarPrecio(); });
          return;
        }
        x.labor_tipo_id = $("#lbTipo").value || null; aplicarReceta(tipoSel()); verCond(); pintarPrecio();
      };
      if (!lab && !insumos.length && tipoSel()) aplicarReceta(tipoSel());
      sugerirSiembra();
      $("#lbAddI").onclick = () => ed.agregar();
      $("#mNo").onclick = close;
      if ($("#lbDel")) $("#lbDel").onclick = async () => {
        if (!(await confirmar(`¿Eliminar esta labor? Los insumos usados vuelven al stock.${siemPrev ? ` También se quita ${esc(siemPrev.cultivo)} de la campaña ${esc(siemPrev.campana)}.` : ""}`))) return;
        if (orden) { orden.estado = "pendiente"; orden.labor_id = null; await guardar("ordenes", orden); }
        if (siemPrev) await borrar("siembras", siemPrev.id);
        await borrar("labores", lab.id); close(); afterSave();
      };
      const afterSave = () => { dibujarLotes(); if (S.vista === "mapa") render(); else refrescar(); };
      $("#lbOk").onclick = async () => {
        if (!$("#lbLote").value) { toast("Elegí el lote."); $("#lbLote").focus(); return; }
        const t = tipoSel();
        if (!t && !(lab && x.tipo)) { toast("Elegí qué labor es."); $("#lbTipo").focus(); return; }
        if (!$("#lbFecha").value) { toast("Falta la fecha."); return; }
        if (esSiembra() && !$("#lbCult").value) { toast("Elegí qué cultivo se sembró."); $("#lbCult").focus(); return; }
        const r = ed.resultado(); if (r.error) { toast(r.error, 6000); return; }
        const fin = cargando("Guardando…");
        try {
          const ct = await asegurarContratista($("#lbCont").value);
          const fecha = $("#lbFecha").value; const categoria = t?.categoria || x.tipo;
          const c = {}; if (categoria === "Pulverización") for (const [k, , tp] of COND) { const v = $("#cd_" + k).value.trim(); if (v) c[k] = tp === "decimal" ? num(v) : v; }
          const pc = precioCatalogo(t, fecha);
          const precio = manual ? { costo_ha: x.costo_ha, moneda: x.moneda || "USD", costo_estado: x.costo_ha != null ? "acordado" : "a_definir" } : pc ? { costo_ha: pc.precio, moneda: pc.moneda, costo_estado: "catalogo" } : { costo_ha: null, moneda: "USD", costo_estado: "a_definir" };
          /* Siembra: cargar o actualizar el cultivo de la campaña */
          let siemId = null, campana = campanaDeFecha(fecha);
          if (categoria === "Siembra") {
            const loteId = $("#lbLote").value, subId = $("#lbSub").value || null, camp = $("#lbCamp").value, cult = $("#lbCult").value;
            campana = camp;
            let sm = siemPrev && siemPrev.lote_id === loteId ? siemPrev : null;
            /* Si el cultivo ya estaba cargado a mano en esa campaña sin fecha, se completa ese en vez de duplicarlo */
            if (!sm) sm = S.d.siembras.find((y) => y.lote_id === loteId && (y.sub_id || null) === subId && y.campana === camp && y.cultivo === cult && !y.fecha) || null;
            if (siemPrev && siemPrev !== sm) await borrar("siembras", siemPrev.id);
            sm = { ...(sm || {}), id: sm?.id || uid(), lote_id: loteId, sub_id: subId, campana: camp, cultivo: cult, hibrido: $("#lbVar").value.trim() || null, fecha };
            await guardar("siembras", sm); siemId = sm.id;
            c.siembra_id = siemId;
          } else if (siemPrev) await borrar("siembras", siemPrev.id);
          const n = { ...x, id: x.id || uid(), lote_id: $("#lbLote").value, sub_id: $("#lbSub").value || null, fecha, campana, labor_tipo_id: t?.id || null, tipo: categoria, contratista_id: ct.id, contratista: ct.nombre, superficie_ha: ha() || null, ...precio, insumos: r.insumos, condiciones: c, notas: $("#lbNot").value.trim() || null };
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
            productos: S.d.productos.map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, principio_activo: p.principio_activo, otros_nombres: (p.alias || []).map((a) => a.texto ?? a).slice(0, 8) })),
            labores_catalogo: S.d.labores_tipo.filter((t) => t.activo !== false).map((t) => ({ id: t.id, nombre: t.nombre, tipo: t.categoria })),
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
    let t = laborTipoDe(d.labor_tipo_id);
    if (!t) { const ts = S.d.labores_tipo.filter((y) => y.activo !== false && y.categoria === d.tipo); if (ts.length === 1) t = ts[0]; }
    const dudas = [d.dudas, l ? null : "No identifiqué el lote.", t ? null : "Elegí qué labor del catálogo es."];
    const insumos = (d.insumos || []).map((i) => { const p = productoDe(i.producto_id) || productoPorTexto(i.nombre); return { producto_id: p?.id || null, nombre: p?.nombre || i.nombre, dosis: i.dosis, unidad: i.unidad || unidadDosis(p) }; });
    if (insumos.some((i) => !i.producto_id)) dudas.push("Hay insumos que no reconocí: elegilos de la lista.");
    const precio = d.costo_ha != null ? { costo_ha: d.costo_ha, moneda: d.moneda || "USD", costo_estado: "acordado" } : {};
    return {
      lote_id: l ? l.id : null, sub_id: sub, fecha: d.fecha || hoy(), labor_tipo_id: t?.id || null, tipo: t?.categoria || (TIPOS_LABOR.includes(d.tipo) ? d.tipo : null),
      contratista: ct?.nombre || d.contratista || "", superficie_ha: ha, ...precio, insumos,
      condiciones: Object.fromEntries(Object.entries(d.condiciones || {}).filter(([, v]) => v != null)),
      notas: [d.notas, `Dictado: «${texto.slice(0, 400)}»`].filter(Boolean).join("\n"), origen: "dictado", _dudas: dudas.filter(Boolean).join(" "),
    };
  },
  revisarVarias(labs) {
    if (labs.length === 1) { Labores.form(null, labs[0]); return; }
    const hechas = new Set();
    const abrir = () => modal(`<h4>${labs.length} labores para revisar</h4>
      <div class="col">${labs.map((l, i) => `<div class="card" style="padding:10px"><div class="row" style="justify-content:space-between"><div><b>${esc(nombreLabor(l))}</b> · ${esc(l.lote_id ? nombreUbic(l.lote_id, l.sub_id) : "lote sin identificar")} · ${fechaAR(l.fecha)}<div class="small muted">${esc(textoInsumos(l))}</div></div>${hechas.has(i) ? '<span class="pill ok">Guardada</span>' : `<button class="primary" data-r="${i}">Revisar</button>`}</div></div>`).join("")}</div>
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
  const lista = S.d.labores.filter((l) => l.campana === S.campana && (!f.lote || l.lote_id === f.lote) && (!f.tipo || l.labor_tipo_id === f.tipo) && (!f.cont || (l.contratista || "") === f.cont) && (!f.costo || l.costo_estado === f.costo)).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  const precios = preciosProductos();
  const deCamp = S.d.labores.filter((l) => l.campana === S.campana);
  const aDef = deCamp.filter((l) => !conPrecio(l)).length;
  let cl = { USD: 0, ARS: 0 }, ci = 0; for (const l of deCamp) { const c = costoLabor(l, precios); ci += c.insumosUSD; if (c.labor != null) cl[c.moneda] += c.labor; }
  const conts = [...new Set(S.d.labores.map((l) => l.contratista).filter(Boolean))].sort();
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Labores ${esc(S.campana)}</h1><div class="row"><button class="primary" id="bNL">+ Labor</button><button id="bDic">🎤 Dictar labor</button><button data-ir="catalogo">Catálogo y precios</button><button id="bCsv" class="hide-m">Exportar CSV</button></div></div>
    <div class="kpis"><div class="kpi"><span>Labores</span><b>${deCamp.length}</b></div><div class="kpi ${aDef ? "alerta" : ""}"><span>Precio a definir</span><b>${aDef}</b></div>
      <div class="kpi"><span>Costo labores</span><b>${cl.USD || !cl.ARS ? fmtM(cl.USD, "USD") : ""}${cl.ARS ? (cl.USD ? " + " : "") + fmtM(cl.ARS, "ARS") : ""}</b></div><div class="kpi"><span>Costo insumos</span><b>${fmtM(ci, "USD")}</b></div></div>
    <div class="filtros"><div class="field grow" style="min-width:160px"><label class="lbl" for="fL">Lote</label><select id="fL"><option value="">Todos</option>${opcionesLotes(f.lote, false)}</select></div>
      <div class="field"><label class="lbl" for="fT">Labor</label><select id="fT"><option value="">Todas</option>${opciones(S.d.labores_tipo.map((t) => [t.id, t.nombre]).sort((a, b) => a[1].localeCompare(b[1])), f.tipo)}</select></div>
      <div class="field"><label class="lbl" for="fC">Contratista</label><select id="fC"><option value="">Todos</option>${opciones(conts, f.cont)}</select></div>
      <div class="field"><label class="lbl" for="fK">Precio</label><select id="fK"><option value="">Todos</option>${opciones([["catalogo", "Del catálogo"], ["acordado", "Puesto a mano"], ["a_definir", "A definir"]], f.costo)}</select></div></div>
    ${S.selLab.size ? `<div class="row aviso" style="border-color:var(--accent)"><b>${S.selLab.size} seleccionada${S.selLab.size > 1 ? "s" : ""}</b><button class="primary" id="bPM">Poner precio</button><button class="ghost" id="bSN">Quitar selección</button></div>` : ""}
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th><input type="checkbox" id="ckAll" aria-label="Seleccionar todas" ${lista.every((l) => S.selLab.has(l.id)) ? "checked" : ""}></th><th>Fecha</th><th>Lote</th><th>Labor</th><th class="hide-m">Insumos</th><th class="right">ha</th><th class="right">Precio/ha</th><th class="right hide-m">Total</th></tr>
      ${lista.map((l) => { const c = costoLabor(l, precios); return `<tr class="click" data-l="${l.id}"><td><input type="checkbox" data-ck="${l.id}" ${S.selLab.has(l.id) ? "checked" : ""} aria-label="Seleccionar"></td><td class="num">${fechaAR(l.fecha)}</td><td>${esc(nombreUbic(l.lote_id, l.sub_id))}</td><td>${esc(nombreLabor(l))}${l.contratista ? `<div class="small muted">${esc(l.contratista)}</div>` : ""}</td><td class="small hide-m">${esc(textoInsumos(l)) || "—"}</td><td class="num right">${fmt(l.superficie_ha, 1)}</td><td class="num right">${conPrecio(l) ? fmtM(l.costo_ha, l.moneda, 2) + (l.costo_estado === "acordado" ? '<div class="small muted">a mano</div>' : "") : '<span class="pill warn">a definir</span>'}</td><td class="num right hide-m">${c.labor != null ? fmtM(c.labor, l.moneda) : "—"}</td></tr>`; }).join("")}</table></div></div>
      <div class="small muted">Las labores toman el precio del catálogo. Si alguna quedó "a definir", filtrá por contratista y "a definir", seleccionalas y tocá "Poner precio".</div>`
      : `<div class="empty">No hay labores${f.lote || f.tipo || f.cont || f.costo ? " con ese filtro" : " en esta campaña"}. Cargalas a mano, dictándolas desde el teléfono o desde una orden de trabajo realizada.</div>`}
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#bNL").onclick = () => Labores.form(null, f.lote ? { lote_id: f.lote } : {});
  $("#bDic").onclick = () => Labores.dictado();
  el.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => irA(b.dataset.ir)));
  $("#bCsv").onclick = () => descargar(`labores_${S.campana.replace("/", "-")}.csv`, csv([["Fecha", "Campaña", "Establecimiento", "Lote", "Sector", "Labor", "Contratista", "ha", "Insumos", "Precio/ha", "Moneda", "Estado precio", "Total labor", "Costo insumos US$", "Notas"], ...lista.map((l) => { const lo = loteDe(l.lote_id); const c = costoLabor(l, precios); return [l.fecha, l.campana, lo?.campo, lo?.nombre, lo ? subDe(lo, l.sub_id)?.nombre : "", nombreLabor(l), l.contratista, l.superficie_ha, textoInsumos(l), l.costo_ha, l.moneda, { catalogo: "Catálogo", acordado: "A mano" }[l.costo_estado] || "A definir", c.labor, +c.insumosUSD.toFixed(2), l.notas]; })]), "text/csv");
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
