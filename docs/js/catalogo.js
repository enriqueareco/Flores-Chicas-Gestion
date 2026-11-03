"use strict";
/* ============ Catálogo de labores: labores fijas con precio por ha ============ */
const simboloMon = (m) => (m === "ARS" ? "$" : "US$");
const textoPrecio = (p) => (p ? `${simboloMon(p.moneda)} ${fmt(p.precio, 2)}/ha` : "Sin precio");

const Catalogo = {
  form(t, onSave, def = {}) {
    const nuevo = !t;
    const x = t ? { ...t } : { nombre: "", categoria: "Pulverización", precios: [], insumos: [], activo: true, ...def };
    const receta = (x.insumos || []).map((i) => ({ ...i }));
    const pv = precioCatalogo(x);
    const usos = t ? S.d.labores.filter((l) => l.labor_tipo_id === t.id).length : 0;
    modal(`<h4>${nuevo ? "Nueva labor del catálogo" : esc(x.nombre)}</h4>
      <div class="row"><div class="field grow" style="min-width:200px"><label class="lbl" for="ctNom">Nombre</label><input id="ctNom" value="${esc(x.nombre)}" placeholder="Ej. Pulverización terrestre"></div>
        <div class="field"><label class="lbl" for="ctCat">Tipo</label><select id="ctCat">${opciones(TIPOS_LABOR, x.categoria)}</select></div></div>
      ${nuevo ? `<div class="row"><div class="field"><label class="lbl" for="ctPre">Precio por ha</label><input id="ctPre" inputmode="decimal" style="width:120px" placeholder="Ej. 7"></div>
        <div class="field"><label class="lbl" for="ctMon">Moneda</label><select id="ctMon">${opciones([["USD", "US$"], ["ARS", "$"]], "USD")}</select></div></div>
        <div class="small muted">Este precio se usa en todas las labores de este tipo hasta que lo cambies.</div>`
      : `<div class="card" style="padding:10px 12px;gap:6px"><div class="row" style="justify-content:space-between"><span><span class="lbl" style="display:block">Precio vigente</span><b class="num" style="font-size:18px">${textoPrecio(pv)}</b>${pv?.desde ? ` <span class="small muted">desde ${fechaAR(pv.desde)}</span>` : ""}</span><button id="ctCambiar" class="primary">${pv ? "Cambiar precio" : "Poner precio"}</button></div>
        ${(x.precios || []).length > 1 ? `<div class="small muted">Historial: ${[...x.precios].sort((a, b) => (b.desde || "").localeCompare(a.desde || "")).map((p) => `${textoPrecio(p)} ${p.desde ? "desde " + fechaAR(p.desde) : "(inicial)"}`).join(" · ")}</div>` : ""}</div>`}
      <div class="row" style="justify-content:space-between"><h2>Insumos que lleva normalmente</h2><button type="button" class="small" id="ctAddI">+ Insumo</button></div>
      <div class="small muted" style="margin-top:-6px">Se proponen al cargar esta labor en un lote. Después se pueden cambiar en cada lote.</div>
      <div id="ctIns" class="col" style="gap:6px"></div>
      <div class="field"><label class="lbl" for="ctNot">Notas</label><input id="ctNot" value="${esc(x.notas || "")}" placeholder="Ej. incluye flete del equipo"></div>
      ${nuevo ? "" : `<label class="row small"><input type="checkbox" id="ctAct" ${x.activo !== false ? "checked" : ""}> Activa (destildá para que no aparezca más en la lista)</label>`}
      <div class="pie">${!nuevo && !usos ? '<button class="ghost danger" id="ctDel" style="margin-right:auto">Eliminar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="ctOk">Guardar</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      const ed = editorInsumos($("#ctIns"), receta, { vacio: "Ninguno. Por ejemplo, una pulverización de barbecho puede llevar glifosato y 2,4-D.", tipoDef: () => tipoProdPorLabor($("#ctCat").value) });
      $("#ctAddI").onclick = () => ed.agregar();
      $("#mNo").onclick = close;
      if ($("#ctCambiar")) $("#ctCambiar").onclick = () => { close(); Catalogo.cambiarPrecio(t, () => Catalogo.form(laborTipoDe(t.id), onSave)); };
      if ($("#ctDel")) $("#ctDel").onclick = async () => { if (await confirmar(`¿Eliminar <b>${esc(t.nombre)}</b> del catálogo?`)) { await borrar("labores_tipo", t.id); close(); refrescar(); } };
      $("#ctOk").onclick = async () => {
        const nombre = $("#ctNom").value.trim(); if (!nombre) { $("#ctNom").focus(); return; }
        if (S.d.labores_tipo.some((y) => y.id !== x.id && norm(y.nombre) === norm(nombre))) { toast("Ya hay una labor con ese nombre en el catálogo."); return; }
        const r = ed.resultado(); if (r.error) { toast(r.error, 6000); return; }
        const n = { ...x, id: x.id || uid(), nombre, categoria: $("#ctCat").value, insumos: r.insumos.map(({ cantidad, ...i }) => i), notas: $("#ctNot").value.trim() || null, activo: $("#ctAct") ? $("#ctAct").checked : true };
        if (nuevo) { const p = num($("#ctPre").value); n.precios = p != null ? [{ desde: null, precio: p, moneda: $("#ctMon").value }] : []; }
        try { await guardar("labores_tipo", n); close(); onSave ? onSave(n) : refrescar(); toast("Labor guardada en el catálogo"); } catch (e) { toast(e.message, 7000); }
      };
    }, "medio");
  },

  /* Cambia el precio desde una fecha. Las labores ya cargadas conservan su precio, salvo que se elija actualizarlas. */
  cambiarPrecio(t, despues) {
    const pv = precioCatalogo(t);
    const primero = !(t.precios || []).some((p) => p.precio != null);
    const afectadas = (desde) => S.d.labores.filter((l) => l.labor_tipo_id === t.id && (primero ? !conPrecio(l) : l.costo_estado === "catalogo" && (l.fecha || "") >= desde));
    modal(`<h4>${primero ? "Poner precio" : "Cambiar precio"} · ${esc(t.nombre)}</h4>
      ${pv ? `<div class="small muted">Precio actual: <b>${textoPrecio(pv)}</b></div>` : ""}
      <div class="row"><div class="field"><label class="lbl" for="cpP">Precio nuevo por ha</label><input id="cpP" inputmode="decimal" style="width:120px" autofocus></div>
        <div class="field"><label class="lbl" for="cpM">Moneda</label><select id="cpM">${opciones([["USD", "US$"], ["ARS", "$"]], pv?.moneda || "USD")}</select></div>
        ${primero ? "" : `<div class="field"><label class="lbl" for="cpD">Rige desde</label><input type="date" id="cpD" value="${hoy()}"></div>`}</div>
      <label class="row small" id="cpAct"><input type="checkbox" id="cpUpd" checked> <span id="cpTxt"></span></label>
      <div class="small muted">${primero ? "Rige para todas las labores de este tipo." : "Las labores anteriores a esa fecha conservan el precio que tenían."}</div>
      <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="cpOk">Guardar precio</button></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      const desde = () => (primero ? null : $("#cpD").value || hoy());
      const txt = () => { const n = afectadas(desde() || "").length; $("#cpAct").hidden = !n; $("#cpTxt").textContent = primero ? `Poner este precio también a las ${n} labores ya cargadas que no tenían precio` : `Actualizar ${n} labor${n > 1 ? "es" : ""} ya cargada${n > 1 ? "s" : ""} desde esa fecha`; };
      txt(); if ($("#cpD")) $("#cpD").onchange = txt;
      $("#mNo").onclick = () => { close(); despues && despues(); };
      $("#cpOk").onclick = async () => {
        const p = num($("#cpP").value); if (p == null) { $("#cpP").focus(); return; }
        const fin = cargando("Guardando…");
        try {
          const d = desde(); const nuevoP = { desde: d, precio: p, moneda: $("#cpM").value };
          t.precios = [...(t.precios || []).filter((x) => x.precio != null && (x.desde || null) !== d), nuevoP];
          await guardar("labores_tipo", t);
          if ($("#cpUpd").checked && !$("#cpAct").hidden) {
            const ls = afectadas(d || "");
            for (const l of ls) { const pc = precioCatalogo(t, l.fecha); if (pc) { l.costo_ha = pc.precio; l.moneda = pc.moneda; l.costo_estado = "catalogo"; } }
            if (ls.length) await DB.guardarVarios("labores", ls);
          }
          close(); toast("Precio actualizado"); despues ? despues() : refrescar();
        } catch (e) { toast(e.message, 7000); } finally { fin(); }
      };
    });
  },
};

Vistas.catalogo = function () {
  const el = document.getElementById("v-catalogo");
  const f = S.filtroCat || (S.filtroCat = { inactivas: false });
  const g = {}; for (const t of S.d.labores_tipo) if (f.inactivas || t.activo !== false) (g[t.categoria || "Otra"] ??= []).push(t);
  const sinPrecio = S.d.labores_tipo.filter((t) => t.activo !== false && !precioCatalogo(t)).length;
  const usosCamp = (id) => S.d.labores.filter((l) => l.labor_tipo_id === id && l.campana === S.campana);
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Catálogo de labores</h1><button class="primary" id="bNC">+ Labor</button></div>
    ${!S.esquemaOk ? avisoEsquema() : ""}
    <div class="small muted" style="max-width:70ch">Cada labor tiene un precio por hectárea que se aplica solo al cargarla en un lote. Cuando cambia la tarifa, tocá la labor y "Cambiar precio": las labores anteriores conservan el precio que tenían.</div>
    ${sinPrecio ? `<div class="aviso">${sinPrecio} labor${sinPrecio > 1 ? "es" : ""} del catálogo sin precio. Tocalas para ponérselo.</div>` : ""}
    <div class="filtros"><label class="row small"><input type="checkbox" id="cInac" ${f.inactivas ? "checked" : ""}> Mostrar también las inactivas</label></div>
    ${Object.keys(g).length ? TIPOS_LABOR.filter((c) => g[c]).map((c) => `<div class="card" style="padding:0"><div style="padding:12px 14px 0"><h2>${esc(c)}</h2></div><div class="tablewrap"><table class="t fija"><tr><th style="width:34%">Labor</th><th class="right" style="width:18%">Precio vigente</th><th class="hide-m" style="width:11%">Desde</th><th class="hide-m" style="width:25%">Insumos que lleva</th><th class="right" style="width:12%">${esc(S.campana)}</th></tr>
      ${g[c].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((t) => { const p = precioCatalogo(t); const u = usosCamp(t.id); return `<tr class="click" data-t="${t.id}"><td><b>${esc(t.nombre)}</b>${t.activo === false ? ' <span class="pill mut">inactiva</span>' : ""}${t.notas ? `<div class="small muted">${esc(t.notas)}</div>` : ""}</td><td class="num right">${p ? textoPrecio(p) : '<span class="pill warn">sin precio</span>'}</td><td class="num small hide-m">${p?.desde ? fechaAR(p.desde) : p ? "inicial" : ""}</td><td class="small hide-m">${(t.insumos || []).map((i) => `${esc(i.nombre)} ${fmt(i.dosis, 2)} ${esc(i.unidad)}`).join("<br>") || "—"}</td><td class="num right">${u.length ? `${u.length} · ${fmt(u.reduce((a, l) => a + (Number(l.superficie_ha) || 0), 0), 0)} ha` : ""}</td></tr>`; }).join("")}</table></div></div>`).join("")
      : `<div class="empty">El catálogo está vacío. Agregá las labores que hacés habitualmente con su precio por hectárea.</div>`}
  </div>`;
  el.querySelector("#bNC").onclick = () => Catalogo.form(null);
  el.querySelector("#cInac").onchange = (e) => { f.inactivas = e.target.checked; Vistas.catalogo(); };
  el.querySelectorAll("[data-t]").forEach((tr) => (tr.onclick = () => Catalogo.form(laborTipoDe(tr.dataset.t))));
};

function avisoEsquema() {
  return `<div class="aviso" style="border-color:var(--danger)"><b>Falta actualizar la base de datos.</b> En Supabase, abrí <b>SQL Editor → New query</b>, pegá el contenido de <code>supabase/migracion_03.sql</code> (está en tu repositorio de GitHub) y tocá <b>Run</b>. Después recargá esta página. Hasta entonces, el catálogo de labores, los nombres alternativos y el control de remitos no se pueden guardar.</div>`;
}
