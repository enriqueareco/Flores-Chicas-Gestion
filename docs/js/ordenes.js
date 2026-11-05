"use strict";
/* ============ Órdenes de trabajo ============ */
const ESTADOS_ORDEN = [["pendiente", "Pendiente"], ["en_curso", "En curso"], ["realizada", "Realizada"], ["cancelada", "Cancelada"]];
const pillOrden = (e) => `<span class="pill ${{ pendiente: "warn", en_curso: "warn", realizada: "ok", cancelada: "mut" }[e] || "mut"}">${(ESTADOS_ORDEN.find((x) => x[0] === e) || [, e])[1]}</span>`;

/* Teléfono argentino a formato internacional de WhatsApp (549 + área + número, sin 0 ni 15) */
function telWhatsapp(t) {
  let d = soloDig(t); if (!d) return null;
  if (d.startsWith("549")) return d;
  if (d.startsWith("54")) return "549" + d.slice(2);
  d = d.replace(/^0/, "");
  if (d.length === 12) for (const a of [4, 3, 2]) if (d.substr(a, 2) === "15") { d = d.slice(0, a) + d.slice(a + 2); break; }
  return d.length === 10 ? "549" + d : null;
}

const Ordenes = {
  form(o, def = {}) {
    const x = o ? { ...o } : { estado: "pendiente", fecha_emision: hoy(), insumos: [], ...def };
    if (!o && x.lote_id && x.superficie_ha == null) x.superficie_ha = +(haUbic(x.lote_id, x.sub_id) || 0).toFixed(1) || null;
    const insumos = (x.insumos || []).map((i) => ({ ...i }));
    let recetaPrevia = null;
    modal(`<h4>${o ? `Orden N° ${o.numero}` : "Nueva orden de trabajo"}</h4>
      <div class="row"><div class="field grow" style="min-width:200px"><label class="lbl" for="oLote">Lote</label><select id="oLote">${opcionesLotes(x.lote_id)}</select></div>
        <div class="field" id="oSubF" style="flex-basis:100%"><span class="lbl">Sectores</span><div class="row" id="oSubChips" style="gap:6px"></div><input type="hidden" id="oSub"></div></div>
      <div class="row"><div class="field grow" style="min-width:220px"><label class="lbl" for="oTipo">¿Qué labor es?</label><select id="oTipo">${opcionesCatalogo(x.labor_tipo_id)}</select></div>
        <div class="field"><label class="lbl" for="oFecha">Fecha prevista</label><input type="date" id="oFecha" value="${esc(x.fecha_prevista || "")}"></div>
        <div class="field"><label class="lbl" for="oHa">Superficie ha</label><input id="oHa" inputmode="decimal" value="${x.superficie_ha ?? ""}" style="width:100px"></div></div>
      <div class="field"><label class="lbl" for="oCont">Contratista</label><input id="oCont" list="dlCont" value="${esc(x.contratista || "")}">${datalistContratistas()}</div>
      <div class="row" style="justify-content:space-between"><h2>Insumos a aplicar</h2><button type="button" class="small" id="oAddI">+ Insumo</button></div>
      <div id="oIns" class="col" style="gap:6px"></div><div id="oStock" class="small"></div>
      <div class="field"><label class="lbl" for="oInd">Indicaciones</label><textarea id="oInd" placeholder="Orden de carga, caudal, boquillas, cuidados con lotes vecinos…">${esc(x.indicaciones || "")}</textarea></div>
      ${o ? `<div class="field"><label class="lbl" for="oEst">Estado</label><select id="oEst">${opciones(ESTADOS_ORDEN, x.estado)}</select></div>` : ""}
      <div class="pie">${o ? '<button class="ghost danger" id="oDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="oOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      const ha = () => num($("#oHa").value) || 0;
      const tipoSel = () => laborTipoDe($("#oTipo").value);
      const ed = editorInsumos($("#oIns"), insumos, { ha, tipoDef: () => tipoProdPorLabor(tipoSel()?.categoria) });
      /* Aviso si en el galpón no alcanza */
      const verStock = () => {
        const st = stockProductos(); const falta = [];
        for (const i of insumos) { if (!i.producto_id || !i.dosis) continue; const p = productoDe(i.producto_id); const s = st[i.producto_id] || { entra: 0, sale: 0 }; const hay = s.entra - s.sale; const nec = cantidadInsumo(i, ha()).cant; if (nec > hay + 1e-9) falta.push(`${p.nombre}: hacen falta ${fmt(nec, 1)} ${p.unidad}, en el galpón hay ${fmt(hay, 1)}`); }
        $("#oStock").innerHTML = falta.length ? `<div class="aviso">${falta.map(esc).join("<br>")}</div>` : "";
      };
      const pintarIns = ed.pintar; ed.pintar = () => { pintarIns(); verStock(); }; ed.pintar();
      $("#oIns").addEventListener("input", verStock);
      const subs = () => { const l = loteDe($("#oLote").value); $("#oSubF").hidden = !l?.subs?.length; pintarSectores($("#oSubChips"), $("#oSub"), l, x.sub_id); };
      const aplicarReceta = (t) => {
        const igual = recetaPrevia && JSON.stringify(insumos.map((i) => [i.producto_id, i.dosis, i.unidad])) === JSON.stringify(recetaPrevia);
        if ((!insumos.length || igual) && (t?.insumos || []).length) { ed.reemplazar(t.insumos); recetaPrevia = insumos.map((i) => [i.producto_id, i.dosis, i.unidad]); }
      };
      subs();
      $("#oLote").onchange = () => { x.sub_id = null; subs(); $("#oHa").value = (haUbic($("#oLote").value, null) || 0).toFixed(1); ed.refrescarTotales(); verStock(); };
      $("#oSub").onchange = () => { $("#oHa").value = (haUbic($("#oLote").value, $("#oSub").value || null) || 0).toFixed(1); ed.refrescarTotales(); verStock(); };
      $("#oHa").oninput = () => { ed.refrescarTotales(); verStock(); };
      $("#oTipo").onchange = () => {
        if ($("#oTipo").value === "__nueva") { $("#oTipo").value = x.labor_tipo_id || ""; Catalogo.form(null, (t) => { $("#oTipo").innerHTML = opcionesCatalogo(t.id); x.labor_tipo_id = t.id; aplicarReceta(t); }); return; }
        x.labor_tipo_id = $("#oTipo").value || null; aplicarReceta(tipoSel());
      };
      $("#oAddI").onclick = () => ed.agregar();
      $("#mNo").onclick = close;
      if ($("#oDel")) $("#oDel").onclick = async () => { if (await confirmar(`¿Eliminar la orden N° ${o.numero}?`)) { await borrar("ordenes", o.id); close(); refrescar(); } };
      $("#oOk").onclick = async () => {
        if (!$("#oLote").value) { toast("Elegí el lote."); return; }
        const t = tipoSel(); if (!t && !(o && x.tipo)) { toast("Elegí qué labor es."); return; }
        const r = ed.resultado(); if (r.error) { toast(r.error, 6000); return; }
        const fin = cargando("Guardando…");
        try {
          const ct = await asegurarContratista($("#oCont").value);
          const n = { ...x, id: x.id || uid(), numero: x.numero || Math.max(0, ...S.d.ordenes.map((y) => y.numero || 0)) + 1, lote_id: $("#oLote").value, sub_id: $("#oSub").value || null, labor_tipo_id: t?.id || null, tipo: t?.categoria || x.tipo, fecha_prevista: $("#oFecha").value || null, superficie_ha: ha() || null, contratista_id: ct.id, contratista: ct.nombre, insumos: r.insumos, indicaciones: $("#oInd").value.trim() || null, estado: $("#oEst")?.value || x.estado, campana: campanaDeFecha($("#oFecha").value || hoy()) };
          await guardar("ordenes", n); close(); refrescar(); if (S.vista === "mapa") render(); Ordenes.ver(n);
        } catch (e) { toast(e.message, 7000); } finally { fin(); }
      };
    }, "medio");
  },

  texto(o) {
    const l = loteDe(o.lote_id);
    const cult = l ? textoCultivos(l, o.sub_id || undefined) : "";
    return [`*Orden de trabajo N° ${o.numero}* · Flores Chicas`, `Labor: ${nombreLabor(o)}`, `Lote: ${nombreUbic(o.lote_id, o.sub_id)}${l?.campo ? " (" + l.campo + ")" : ""} · ${fmt(o.superficie_ha, 1)} ha${cult ? " · " + cult : ""}`,
      o.fecha_prevista ? `Fecha prevista: ${fechaAR(o.fecha_prevista)}` : null,
      (o.insumos || []).length ? "Productos:\n" + o.insumos.map((i) => { const t = cantidadInsumo(i, o.superficie_ha); return `• ${i.nombre}: ${fmt(i.dosis, 2)} ${i.unidad} → ${fmt(t.cant, 1)} ${t.unidad}`; }).join("\n") : null,
      o.indicaciones ? `Indicaciones: ${o.indicaciones}` : null].filter(Boolean).join("\n");
  },
  html(o, imgUrl) {
    const l = loteDe(o.lote_id);
    return `<div style="font:14px/1.5 'Source Sans 3',Arial,sans-serif;color:#000;max-width:720px;margin:0 auto;padding:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:6px"><div><div style="font:800 22px Archivo,Arial">Orden de trabajo N° ${o.numero}</div><div>Flores Chicas · ${esc(l?.campo || "")}</div></div><div style="text-align:right">Emitida ${fechaAR(o.fecha_emision)}<br>Prevista ${fechaAR(o.fecha_prevista)}</div></div>
      <table style="width:100%;border-collapse:collapse;margin:12px 0"><tr><td style="padding:4px 0;width:140px"><b>Labor</b></td><td>${esc(nombreLabor(o))}</td></tr><tr><td style="padding:4px 0"><b>Lote</b></td><td>${esc(nombreUbic(o.lote_id, o.sub_id))}</td></tr><tr><td style="padding:4px 0"><b>Superficie</b></td><td>${fmt(o.superficie_ha, 1)} ha</td></tr><tr><td style="padding:4px 0"><b>Cultivo</b></td><td>${esc(l ? textoCultivos(l, o.sub_id || undefined) : "") || "—"}</td></tr><tr><td style="padding:4px 0"><b>Contratista</b></td><td>${esc(o.contratista || "—")}</td></tr></table>
      ${imgUrl ? `<img src="${imgUrl}" alt="" style="width:100%;margin:6px 0 10px;border:1px solid #000">` : ""}
      ${(o.insumos || []).length ? `<table style="width:100%;border-collapse:collapse;margin:8px 0"><tr style="border-bottom:1px solid #000"><th style="text-align:left;padding:4px">Producto</th><th style="text-align:right;padding:4px">Dosis</th><th style="text-align:right;padding:4px">Total a cargar</th></tr>${o.insumos.map((i) => { const t = cantidadInsumo(i, o.superficie_ha); return `<tr style="border-bottom:1px solid #ccc"><td style="padding:6px 4px">${esc(i.nombre)}</td><td style="text-align:right;padding:6px 4px">${fmt(i.dosis, 2)} ${esc(i.unidad)}</td><td style="text-align:right;padding:6px 4px"><b>${fmt(t.cant, 1)} ${t.unidad}</b></td></tr>`; }).join("")}</table>` : ""}
      ${o.indicaciones ? `<p><b>Indicaciones:</b> ${esc(o.indicaciones)}</p>` : ""}
      ${o.tipo === "Pulverización" ? `<p style="margin-top:18px"><b>Registro de la aplicación</b></p><table style="width:100%;border-collapse:collapse">${["Fecha y hora", "Viento (km/h y dirección)", "Temperatura / humedad", "Caudal (L/ha)", "N° receta agronómica"].map((t) => `<tr><td style="padding:8px 4px;width:220px">${t}</td><td style="border-bottom:1px solid #000"></td></tr>`).join("")}</table>` : ""}
      <div style="display:flex;gap:40px;margin-top:50px"><div style="flex:1;border-top:1px solid #000;text-align:center;padding-top:4px">Firma responsable</div><div style="flex:1;border-top:1px solid #000;text-align:center;padding-top:4px">Firma contratista</div></div></div>`;
  },
  ver(o) {
    if (!o) return;
    const ct = proveedorDe(o.contratista_id); const tel = telWhatsapp(ct?.telefono);
    const wa = `https://wa.me/${tel || ""}?text=${encodeURIComponent(Ordenes.texto(o))}`;
    let img = null, imgUrl = null;
    const archivo = () => new File([img.blob], `Orden_${o.numero}_${(loteDe(o.lote_id)?.nombre || "lote").replace(/[^\w-]+/g, "_")}.jpg`, { type: "image/jpeg" });
    modal(`<div class="row" style="justify-content:space-between"><h4>Orden N° ${o.numero}</h4>${pillOrden(o.estado)}</div>
      <div id="oImg" class="col" style="gap:4px"><div class="row small muted"><span class="spin"></span> Armando la imagen aérea del lote…</div></div>
      <div class="respuesta" style="font-family:var(--f-body)">${esc(Ordenes.texto(o)).replace(/\*/g, "")}</div>
      ${!tel && o.contratista ? `<div class="small muted">Para mandarla directo al contratista, cargale el teléfono en Insumos y proveedores.</div>` : ""}
      ${o.labor_id ? `<button class="ghost small" id="oVerLab" style="align-self:flex-start">Ver la labor registrada</button>` : ""}
      <div class="pie" style="justify-content:space-between"><span class="row"><button class="primary" id="oWa">Enviar por WhatsApp</button><button id="oImp">Imprimir</button><button id="oBaj" disabled>Descargar imagen</button><button id="oCop">Copiar texto</button></span>
        <span class="row"><button id="oEdit">Editar</button>${o.estado === "realizada" || o.estado === "cancelada" ? "" : '<button class="primary" id="oHecha">Marcar realizada</button>'}</span></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      Imagen.deOrden(o).then((r) => {
        img = r; imgUrl = URL.createObjectURL(r.blob);
        if (!m.isConnected) return;
        $("#oImg").innerHTML = `<img src="${imgUrl}" alt="Vista aérea del lote de la orden" style="width:100%;border-radius:6px;border:1px solid var(--line)">${r.conFondo ? "" : '<span class="small muted">No se pudo bajar la imagen satelital (revisá la conexión); se muestran solo los contornos.</span>'}`;
        $("#oBaj").disabled = false;
      }).catch((e) => { if (m.isConnected) $("#oImg").innerHTML = `<span class="small muted">No se pudo armar la imagen: ${esc(e.message)}</span>`; });
      /* En el teléfono se comparte la imagen con el texto; en la computadora se descarga la imagen y se abre WhatsApp con el texto */
      $("#oWa").onclick = async () => {
        const texto = Ordenes.texto(o);
        if (img && navigator.canShare && navigator.canShare({ files: [archivo()] })) {
          try { await navigator.clipboard?.writeText(texto).catch(() => {}); await navigator.share({ files: [archivo()], text: texto, title: `Orden N° ${o.numero}` }); return; }
          catch (e) { if (e.name === "AbortError") return; }
        }
        if (img) { descargar(archivo().name, img.blob, "image/jpeg"); toast("Se descargó la imagen del lote: adjuntala en el chat de WhatsApp.", 7000); }
        window.open(wa, "_blank", "noopener");
      };
      $("#oBaj").onclick = () => img && descargar(archivo().name, img.blob, "image/jpeg");
      $("#oImp").onclick = () => imprimir(Ordenes.html(o, imgUrl));
      $("#oCop").onclick = async () => { try { await navigator.clipboard.writeText(Ordenes.texto(o)); toast("Texto copiado"); } catch (e) { toast("No se pudo copiar."); } };
      $("#oEdit").onclick = () => { close(); Ordenes.form(o); };
      if ($("#oVerLab")) $("#oVerLab").onclick = () => { close(); Labores.form(S.d.labores.find((l) => l.id === o.labor_id)); };
      if ($("#oHecha")) $("#oHecha").onclick = () => {
        close();
        Labores.form(null, { lote_id: o.lote_id, sub_id: o.sub_id, labor_tipo_id: o.labor_tipo_id, tipo: o.tipo, fecha: hoy(), contratista: o.contratista, superficie_ha: o.superficie_ha, insumos: (o.insumos || []).map((i) => ({ ...i })), orden_id: o.id, origen: "orden", notas: o.indicaciones ? "Indicaciones de la orden: " + o.indicaciones : null });
      };
    });
  },
};

Vistas.ordenes = function () {
  const el = document.getElementById("v-ordenes");
  const f = S.filtroOrd || (S.filtroOrd = { estado: "abiertas" });
  const lista = S.d.ordenes.filter((o) => f.estado === "todas" || (f.estado === "abiertas" ? o.estado === "pendiente" || o.estado === "en_curso" : o.estado === f.estado))
    .sort((a, b) => (a.fecha_prevista || "9999").localeCompare(b.fecha_prevista || "9999") || (b.numero || 0) - (a.numero || 0));
  const abiertas = S.d.ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso");
  const atrasadas = abiertas.filter((o) => o.fecha_prevista && o.fecha_prevista < hoy()).length;
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Órdenes de trabajo</h1><button class="primary" id="bNO">+ Orden de trabajo</button></div>
    <div class="kpis"><div class="kpi"><span>Abiertas</span><b>${abiertas.length}</b></div><div class="kpi ${atrasadas ? "alerta" : ""}"><span>Con fecha vencida</span><b>${atrasadas}</b></div></div>
    <div class="filtros"><div class="field"><label class="lbl" for="oF">Mostrar</label><select id="oF">${opciones([["abiertas", "Abiertas"], ["realizada", "Realizadas"], ["cancelada", "Canceladas"], ["todas", "Todas"]], f.estado)}</select></div></div>
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr><th>N°</th><th>Prevista</th><th>Lote</th><th>Labor</th><th class="hide-m">Insumos</th><th class="right">ha</th><th>Estado</th></tr>
      ${lista.map((o) => `<tr class="click" data-o="${o.id}"><td class="num">${o.numero}</td><td class="num">${fechaAR(o.fecha_prevista)}${o.fecha_prevista && o.fecha_prevista < hoy() && (o.estado === "pendiente" || o.estado === "en_curso") ? ' <span class="pill bad">vencida</span>' : ""}</td><td>${esc(nombreUbic(o.lote_id, o.sub_id))}</td><td>${esc(nombreLabor(o))}${o.contratista ? `<div class="small muted">${esc(o.contratista)}</div>` : ""}</td><td class="small hide-m">${esc(textoInsumos(o)) || "—"}</td><td class="num right">${fmt(o.superficie_ha, 1)}</td><td>${pillOrden(o.estado)}</td></tr>`).join("")}</table></div></div>`
      : `<div class="empty">${f.estado === "abiertas" ? "No hay órdenes abiertas." : "No hay órdenes con ese estado."} Una orden indica qué hacer en un lote, con qué productos y dosis; se imprime o se manda por WhatsApp al contratista, y al marcarla realizada queda registrada como labor.</div>`}
  </div>`;
  el.querySelector("#bNO").onclick = () => Ordenes.form(null);
  el.querySelector("#oF").onchange = (e) => { f.estado = e.target.value; Vistas.ordenes(); };
  el.querySelectorAll("[data-o]").forEach((tr) => (tr.onclick = () => Ordenes.ver(S.d.ordenes.find((o) => o.id === tr.dataset.o))));
};
