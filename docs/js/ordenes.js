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

/* ============ Carga de camioneta: total de insumos de las órdenes abiertas que estén prendidas ============ */
const Carga = {
  /* Las órdenes apagadas se guardan en este dispositivo; las nuevas entran prendidas */
  fuera() { try { return new Set(JSON.parse(localStorage.getItem("fc-carga-fuera") || "[]")); } catch (e) { return new Set(); } },
  guardarFuera(s) { try { localStorage.setItem("fc-carga-fuera", JSON.stringify([...s])); } catch (e) {} },
  esAbierta: (o) => o.estado === "pendiente" || o.estado === "en_curso",
  tieneInsumos: (o) => (o.insumos || []).some((i) => i.producto_id || i.nombre),
  candidatas() {
    return S.d.ordenes.filter((o) => Carga.esAbierta(o) && Carga.tieneInsumos(o))
      .sort((a, b) => (a.fecha_prevista || "9999").localeCompare(b.fecha_prevista || "9999") || (a.numero || 0) - (b.numero || 0));
  },
  prendidas() { const f = Carga.fuera(); return Carga.candidatas().filter((o) => !f.has(o.id)); },
  calcular(ordenes) {
    const st = stockProductos(); const tot = {};
    for (const o of ordenes) for (const i of o.insumos || []) {
      const k = i.producto_id || (i.nombre ? "n:" + norm(i.nombre) : null); if (!k) continue;
      const q = Number(i.cantidad != null ? i.cantidad : cantidadInsumo(i, o.superficie_ha).cant) || 0;
      const p = i.producto_id ? productoDe(i.producto_id) : null;
      const a = (tot[k] ??= { id: i.producto_id || null, nombre: p?.nombre || i.nombre, unidad: p?.unidad || dosisABase(1, i.unidad)[1], tipo: p?.tipo || "", total: 0, por: [] });
      a.total += q; a.por.push({ n: o.numero, q });
    }
    return Object.values(tot).map((a) => { const s = a.id ? st[a.id] : null; return { ...a, hay: s ? s.entra - s.sale : null }; })
      .sort((a, b) => (a.tipo || "").localeCompare(b.tipo || "") || a.nombre.localeCompare(b.nombre));
  },
  /* Para cargar se redondea hacia arriba: bolsas y unidades enteras, el resto a un decimal */
  cant(q, u) { const r = u === "u" ? Math.ceil(q - 1e-9) : Math.ceil(q * 10 - 1e-9) / 10; return fmt(r, r % 1 ? 1 : 0); },
  unidad: (u) => (u === "u" ? "bolsas/u" : u),
  lineaOrden: (o) => `N° ${o.numero} · ${nombreUbic(o.lote_id, o.sub_id)} · ${nombreLabor(o)} · ${fmt(o.superficie_ha, 1)} ha`,
  texto(filas, ordenes) {
    return [`*Carga de camioneta · Flores Chicas*`, `Fecha: ${fechaAR(hoy())}`, "",
      ...filas.map((r) => `• ${r.nombre}: ${Carga.cant(r.total, r.unidad)} ${Carga.unidad(r.unidad)}`), "",
      `Para las órdenes:`, ...ordenes.map((o) => `- ${Carga.lineaOrden(o)}`)].join("\n");
  },
  html(filas, ordenes) {
    const td = "padding:7px 4px;border-bottom:1px solid #ccc";
    return `<div style="font:14px/1.5 'Source Sans 3',Arial,sans-serif;color:#000;max-width:720px;margin:0 auto;padding:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:6px"><div style="font:800 22px Archivo,Arial">Carga de camioneta</div><div>Flores Chicas · ${fechaAR(hoy())}</div></div>
      <table style="width:100%;border-collapse:collapse;margin:12px 0"><tr style="border-bottom:1px solid #000"><th style="text-align:left;padding:4px">Producto</th><th style="text-align:right;padding:4px">Total a cargar</th><th style="text-align:left;padding:4px">Por orden</th><th style="padding:4px;width:60px">Cargado</th></tr>
        ${filas.map((r) => `<tr><td style="${td}"><b>${esc(r.nombre)}</b></td><td style="${td};text-align:right;white-space:nowrap"><b>${Carga.cant(r.total, r.unidad)} ${esc(Carga.unidad(r.unidad))}</b></td><td style="${td};font-size:12px">${r.por.map((x) => `N° ${x.n}: ${Carga.cant(x.q, r.unidad)}`).join(" · ")}</td><td style="${td};text-align:center"><span style="display:inline-block;width:16px;height:16px;border:1.5px solid #000"></span></td></tr>`).join("")}</table>
      <p style="margin:14px 0 4px"><b>Órdenes incluidas</b></p>
      ${ordenes.map((o) => `<div>${esc(Carga.lineaOrden(o))}${o.contratista ? ` · ${esc(o.contratista)}` : ""}</div>`).join("")}</div>`;
  },
  /* Tarjeta con el total, dentro de la página de órdenes */
  pintar(el) {
    const cand = Carga.candidatas(); const ords = Carga.prendidas(); const filas = Carga.calcular(ords);
    const ha = ords.reduce((s, o) => s + (Number(o.superficie_ha) || 0), 0);
    el.hidden = !cand.length; if (!cand.length) return;
    el.innerHTML = `<div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="col" style="gap:2px"><h2>🛻 Para cargar en la camioneta</h2><div class="small muted">Suma de las órdenes prendidas: <b>${ords.length} de ${cand.length}</b>${ords.length ? ` · ${fmt(ha, 1)} ha` : ""}. Prendé o apagá cada orden con la llave de la lista.</div></div>
        <span class="row"><button class="small ghost" id="cgTodas">Prender todas</button><button class="small ghost" id="cgNing">Apagar todas</button></span></div>
      ${!ords.length ? `<div class="empty" style="padding:10px">No hay órdenes prendidas. Prendé las que vas a hacer y acá aparece qué cargar.</div>`
        : `<div class="tablewrap"><table class="t"><tr><th>Insumo</th><th class="right">Total a cargar</th><th class="right">Galpón</th></tr>
          ${filas.map((r) => `<tr><td><b>${esc(r.nombre)}</b><div class="small muted">${r.por.map((x) => `N° ${x.n}: ${Carga.cant(x.q, r.unidad)}`).join(" · ")}</div></td>
            <td class="num right" style="white-space:nowrap"><b class="carga-tot">${Carga.cant(r.total, r.unidad)}</b> ${esc(Carga.unidad(r.unidad))}</td>
            <td class="num right">${r.hay == null ? "—" : r.total > r.hay + 1e-6 ? `<span class="pill bad" title="En el galpón hay ${fmt(Math.max(0, r.hay), 1)}">faltan ${Carga.cant(r.total - Math.max(0, r.hay), r.unidad)}</span>` : `<span class="small muted">${fmt(r.hay, 1)}</span>`}</td></tr>`).join("")}</table></div>
          <div class="row"><button id="cgCop">Copiar texto</button><button id="cgWa">Enviar por WhatsApp</button><button id="cgImp">Imprimir</button></div>`}`;
    const $ = (q) => el.querySelector(q);
    const todas = (on) => { const f = Carga.fuera(); for (const o of cand) on ? f.delete(o.id) : f.add(o.id); Carga.guardarFuera(f); Vistas.ordenes(); };
    $("#cgTodas").onclick = () => todas(true); $("#cgNing").onclick = () => todas(false);
    if (!ords.length) return;
    $("#cgCop").onclick = async () => { try { await navigator.clipboard.writeText(Carga.texto(filas, ords)); toast("Texto copiado"); } catch (e) { toast("No se pudo copiar."); } };
    $("#cgImp").onclick = () => imprimir(Carga.html(filas, ords));
    $("#cgWa").onclick = async () => {
      const t = Carga.texto(filas, ords);
      if (navigator.share && matchMedia("(max-width:820px)").matches) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === "AbortError") return; } }
      window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, "_blank", "noopener");
    };
  },
};

Vistas.ordenes = function () {
  const el = document.getElementById("v-ordenes");
  const f = S.filtroOrd || (S.filtroOrd = { estado: "abiertas" });
  const lista = S.d.ordenes.filter((o) => f.estado === "todas" || (f.estado === "abiertas" ? o.estado === "pendiente" || o.estado === "en_curso" : o.estado === f.estado))
    .sort((a, b) => (a.fecha_prevista || "9999").localeCompare(b.fecha_prevista || "9999") || (b.numero || 0) - (a.numero || 0));
  const abiertas = S.d.ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso");
  const atrasadas = abiertas.filter((o) => o.fecha_prevista && o.fecha_prevista < hoy()).length;
  /* Limpia de la lista de apagadas las órdenes que ya no están abiertas */
  const fuera = Carga.fuera(); const vivas = new Set(abiertas.map((o) => o.id)); let cambio = false;
  for (const id of [...fuera]) if (!vivas.has(id)) { fuera.delete(id); cambio = true; }
  if (cambio) Carga.guardarFuera(fuera);
  const conLlave = (o) => Carga.esAbierta(o) && Carga.tieneInsumos(o);
  const verCarga = f.estado === "abiertas" || f.estado === "todas";
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><div class="col" style="gap:4px"><button class="ghost small" id="bVolver" style="align-self:flex-start;padding:2px 6px">← Volver al mapa</button><h1>Órdenes de trabajo</h1></div><div class="row"><button id="bPed">🧾 Pedido de insumos</button><button class="primary" id="bNO">+ Orden de trabajo</button></div></div>
    <div class="kpis"><div class="kpi"><span>Abiertas</span><b>${abiertas.length}</b></div><div class="kpi ${atrasadas ? "alerta" : ""}"><span>Con fecha vencida</span><b>${atrasadas}</b></div></div>
    <div class="filtros"><div class="field"><label class="lbl" for="oF">Mostrar</label><select id="oF">${opciones([["abiertas", "Abiertas"], ["realizada", "Realizadas"], ["cancelada", "Canceladas"], ["todas", "Todas"]], f.estado)}</select></div></div>
    ${lista.length ? `<div class="card" style="padding:0"><div class="tablewrap"><table class="t"><tr>${verCarga ? '<th title="Incluir en la carga de la camioneta">Carga</th>' : ""}<th>N°</th><th>Prevista</th><th>Lote</th><th>Labor</th><th class="hide-m">Insumos</th><th class="right">ha</th><th>Estado</th></tr>
      ${lista.map((o) => `<tr class="click${verCarga && conLlave(o) && fuera.has(o.id) ? " apagada" : ""}" data-o="${o.id}">${verCarga ? `<td class="tgl-td">${conLlave(o) ? `<label class="tgl" title="Incluir en la carga de la camioneta"><input type="checkbox" data-carga="${o.id}" ${fuera.has(o.id) ? "" : "checked"} aria-label="Incluir la orden N° ${o.numero} en la carga"><span></span></label>` : ""}</td>` : ""}<td class="num">${o.numero}</td><td class="num">${fechaAR(o.fecha_prevista)}${o.fecha_prevista && o.fecha_prevista < hoy() && (o.estado === "pendiente" || o.estado === "en_curso") ? ' <span class="pill bad">vencida</span>' : ""}</td><td>${esc(nombreUbic(o.lote_id, o.sub_id))}</td><td>${esc(nombreLabor(o))}${o.contratista ? `<div class="small muted">${esc(o.contratista)}</div>` : ""}</td><td class="small hide-m">${esc(textoInsumos(o)) || "—"}</td><td class="num right">${fmt(o.superficie_ha, 1)}</td><td>${pillOrden(o.estado)}</td></tr>`).join("")}</table></div></div>`
      : `<div class="empty">${f.estado === "abiertas" ? "No hay órdenes abiertas." : "No hay órdenes con ese estado."} Una orden indica qué hacer en un lote, con qué productos y dosis; se imprime o se manda por WhatsApp al contratista, y al marcarla realizada queda registrada como labor.</div>`}
    ${verCarga ? '<div class="card carga" id="cargaCam" hidden></div>' : ""}
  </div>`;
  el.querySelector("#bNO").onclick = () => Ordenes.form(null);
  el.querySelector("#bPed").onclick = () => Pedido.abrir();
  el.querySelector("#bVolver").onclick = () => irA("mapa");
  el.querySelector("#oF").onchange = (e) => { f.estado = e.target.value; Vistas.ordenes(); };
  el.querySelectorAll("tr[data-o]").forEach((tr) => (tr.onclick = () => Ordenes.ver(S.d.ordenes.find((o) => o.id === tr.dataset.o))));
  const tarjeta = el.querySelector("#cargaCam");
  if (tarjeta) Carga.pintar(tarjeta);
  /* La llave prende o apaga la orden en la carga sin abrirla */
  el.querySelectorAll(".tgl-td").forEach((td) => (td.onclick = (e) => e.stopPropagation()));
  el.querySelectorAll("[data-carga]").forEach((ck) => (ck.onchange = () => {
    const fs = Carga.fuera(); ck.checked ? fs.delete(ck.dataset.carga) : fs.add(ck.dataset.carga); Carga.guardarFuera(fs);
    ck.closest("tr").classList.toggle("apagada", !ck.checked); Carga.pintar(tarjeta);
  }));
};
