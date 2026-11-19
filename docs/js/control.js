"use strict";
/* ============ Control de remitos contra facturas ============
   Por proveedor y por insumo: lo que llegó con remitos contra lo facturado (facturas y notas de débito,
   menos notas de crédito). Diferencia positiva = facturado de más; negativa = falta facturar. */
const Control = {
  calcular(desde) {
    const ok = (c) => c.estado === "confirmado" && c.tipo !== "ajuste" && (!desde || !c.fecha || c.fecha >= desde);
    const comps = S.d.comprobantes.filter(ok); const fact = remitosFacturados(); const precios = preciosDetalle();
    const porProv = new Map();
    const P = (c) => { const k = c.proveedor_id || "n:" + claveEmpresa(c.proveedor_nombre || "sin proveedor"); if (!porProv.has(k)) porProv.set(k, { id: c.proveedor_id, nombre: proveedorDe(c.proveedor_id)?.nombre || c.proveedor_nombre || "Sin proveedor", ins: {}, remitosSinFactura: [], dobles: [], sinInsumo: 0 }); return porProv.get(k); };
    for (const c of comps) {
      const p = P(c); const sg = c.tipo === "nota_credito" ? -1 : 1;
      for (const it of c.items || []) {
        if (it.ignorar) continue;
        if (!it.producto_id) { if (c.tipo === "remito" || esFactura(c)) p.sinInsumo++; continue; }
        const a = (p.ins[it.producto_id] ??= { remitos: 0, facturado: 0, nRem: new Set(), nFac: new Set() }); const q = Number(it.cantidad) || 0;
        if (c.tipo === "remito") { a.remitos += q; a.nRem.add(c.id); } else if (esFactura(c)) { a.facturado += sg * q; a.nFac.add(c.id); }
      }
      if (c.tipo === "remito" && !fact.has(c.id) && (c.items || []).some((i) => i.producto_id)) p.remitosSinFactura.push(c);
      /* Factura que además sumó al galpón: si la mercadería ya entró con remito, se contó dos veces */
      if (esFactura(c) && c.tipo !== "nota_credito" && c.mueve_stock && (c.items || []).some((i) => i.producto_id && p.ins[i.producto_id]?.remitos > 0)) p.dobles.push(c);
    }
    /* Las facturas que sumaron stock se revisan al final, cuando ya están todos los remitos */
    for (const p of porProv.values()) {
      p.dobles = comps.filter((c) => (c.proveedor_id ? c.proveedor_id === p.id : !p.id && (proveedorDe(c.proveedor_id)?.nombre || c.proveedor_nombre || "Sin proveedor") === p.nombre) && esFactura(c) && c.tipo !== "nota_credito" && c.mueve_stock && (c.items || []).some((i) => i.producto_id && p.ins[i.producto_id]?.remitos > 0));
      p.filas = Object.entries(p.ins).map(([id, a]) => { const pr = productoDe(id); const dif = a.facturado - a.remitos; const usd = precios[id]?.usd;
        return { id, nombre: pr?.nombre || "Insumo borrado", unidad: pr?.unidad || "", remitos: a.remitos, facturado: a.facturado, dif, usd: usd != null ? dif * usd : null, nRem: a.nRem.size, nFac: a.nFac.size }; })
        .sort((x, y) => (Math.abs(y.dif) > 0.001) - (Math.abs(x.dif) > 0.001) || x.nombre.localeCompare(y.nombre));
      p.falta = p.filas.filter((f) => f.dif < -0.001); p.demas = p.filas.filter((f) => f.dif > 0.001);
    }
    return [...porProv.values()].filter((p) => p.filas.length).sort((a, b) => (b.falta.length + b.demas.length + b.dobles.length) - (a.falta.length + a.demas.length + a.dobles.length) || a.nombre.localeCompare(b.nombre));
  },
  estado(f) {
    if (Math.abs(f.dif) <= 0.001) return '<span class="pill ok">Coincide</span>';
    if (f.dif < 0) return `<span class="pill warn">Falta facturar ${fmt(-f.dif, 1)} ${esc(f.unidad)}</span>`;
    return `<span class="pill bad">Facturado de más ${fmt(f.dif, 1)} ${esc(f.unidad)}</span>`;
  },
  abrir() {
    const st = (Control.filtro ??= { desde: "" });
    const provs = Control.calcular(st.desde);
    const nFalta = provs.reduce((s, p) => s + p.falta.length, 0), nDemas = provs.reduce((s, p) => s + p.demas.length, 0);
    const nRem = provs.reduce((s, p) => s + p.remitosSinFactura.length, 0), nDob = provs.reduce((s, p) => s + p.dobles.length, 0);
    const usdFalta = provs.reduce((s, p) => s + p.falta.reduce((t, f) => t + (f.usd ? -f.usd : 0), 0), 0), usdDemas = provs.reduce((s, p) => s + p.demas.reduce((t, f) => t + (f.usd || 0), 0), 0);
    modal(`<h4>Remitos contra facturas</h4>
      <div class="small muted">Por proveedor y por insumo: lo que llegó con remitos contra lo que te facturaron (facturas y notas de débito, menos notas de crédito). Se comparan cantidades, no importa en qué factura vino cada remito.</div>
      <div class="row" style="align-items:flex-end"><div class="field"><label class="lbl" for="ctDesde">Desde</label><input type="date" id="ctDesde" value="${esc(st.desde)}"></div><span class="small muted">${st.desde ? "" : "Todas las fechas."}</span></div>
      <div class="kpis"><div class="kpi ${nFalta ? "alerta" : ""}"><span>Falta facturar</span><b>${nFalta} insumo${nFalta === 1 ? "" : "s"}</b>${usdFalta ? `<div class="small muted">≈ ${fmtM(usdFalta, "USD")}</div>` : ""}</div>
        <div class="kpi ${nDemas ? "alerta" : ""}"><span>Facturado de más</span><b>${nDemas} insumo${nDemas === 1 ? "" : "s"}</b>${usdDemas ? `<div class="small muted">≈ ${fmtM(usdDemas, "USD")}</div>` : ""}</div>
        <div class="kpi"><span>Remitos sin factura asociada</span><b>${nRem}</b></div>
        ${nDob ? `<div class="kpi alerta"><span>Facturas que sumaron al galpón</span><b>${nDob}</b></div>` : ""}</div>
      ${!provs.length ? '<div class="empty">No hay remitos ni facturas de insumos confirmados en ese período.</div>' : provs.map((p) => `
        <section class="ctl-prov"><div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="margin:0">${esc(p.nombre)}</h2>
          <span class="row" style="gap:4px">${p.falta.length ? `<span class="pill warn">${p.falta.length} falta facturar</span>` : ""}${p.demas.length ? `<span class="pill bad">${p.demas.length} de más</span>` : ""}${!p.falta.length && !p.demas.length ? '<span class="pill ok">Todo coincide</span>' : ""}</span></div>
          <div class="tablewrap"><table class="t"><tr><th>Insumo</th><th class="right">Remitos</th><th class="right">Facturado</th><th>Estado</th><th class="right">Valor</th></tr>
            ${p.filas.map((f) => `<tr><td><b>${esc(f.nombre)}</b><div class="small muted">${f.nRem} remito${f.nRem === 1 ? "" : "s"} · ${f.nFac} factura${f.nFac === 1 ? "" : "s"}</div></td><td class="num right">${fmt(f.remitos, 1)} ${esc(f.unidad)}</td><td class="num right">${fmt(f.facturado, 1)} ${esc(f.unidad)}</td><td>${Control.estado(f)}</td><td class="num right">${f.usd && Math.abs(f.dif) > 0.001 ? "≈ " + fmtM(Math.abs(f.usd), "USD") : ""}</td></tr>`).join("")}</table></div>
          ${p.dobles.length ? `<div class="aviso"><b>Ojo:</b> ${p.dobles.length === 1 ? "esta factura también sumó" : "estas facturas también sumaron"} la mercadería al galpón, y esos insumos ya habían entrado con remito: en el stock se contaron dos veces.
            ${p.dobles.map((c) => `<div class="row small" style="justify-content:space-between;margin-top:4px"><span>${fechaAR(c.fecha)} · Factura ${esc(c.letra || "")} <span class="num">${esc(c.numero || "s/n")}</span></span><span class="row" style="gap:4px"><button class="small" data-ver="${c.id}">Ver</button><button class="small primary" data-nostock="${c.id}">Que no sume al stock</button></span></div>`).join("")}</div>` : ""}
          ${p.remitosSinFactura.length ? `<details class="small"><summary>${p.remitosSinFactura.length} remito${p.remitosSinFactura.length === 1 ? "" : "s"} sin factura asociada</summary>
            <div class="small muted" style="margin:4px 0">No es un error: solo indica que al confirmar la factura no se tildó ese remito. Lo que importa son las cantidades de arriba.</div>
            ${p.remitosSinFactura.map((r) => `<div class="row" style="justify-content:space-between"><span>${fechaAR(r.fecha)} · Remito <span class="num">${esc(r.numero || "s/n")}</span> · ${(r.items || []).filter((i) => i.producto_id).map((i) => `${esc(productoDe(i.producto_id)?.nombre || "")} ${fmt(i.cantidad, 1)}`).join(", ")}</span><button class="ghost small" data-ver="${r.id}">Ver</button></div>`).join("")}</details>` : ""}
          ${p.sinInsumo ? `<div class="small muted">${p.sinInsumo} renglón${p.sinInsumo === 1 ? "" : "es"} sin insumo asignado no entran en la cuenta.</div>` : ""}
        </section>`).join("")}
      <div class="pie"><button id="mNo">Cerrar</button></div>`, (m, close) => {
      m.querySelector("#mNo").onclick = close;
      m.querySelector("#ctDesde").onchange = (e) => { st.desde = e.target.value; close(); Control.abrir(); };
      m.querySelectorAll("[data-ver]").forEach((b) => (b.onclick = () => { close(); Comprobantes.revisar(S.d.comprobantes.find((c) => c.id === b.dataset.ver)); }));
      m.querySelectorAll("[data-nostock]").forEach((b) => (b.onclick = async () => {
        const c = S.d.comprobantes.find((x) => x.id === b.dataset.nostock); if (!c) return;
        if (!(await confirmar(`La factura ${esc(c.numero || "")} deja de sumar al stock del galpón (la mercadería ya entró con el remito). ¿Seguir?`, "Que no sume"))) return;
        try { await guardar("comprobantes", { ...c, mueve_stock: false }); toast("Listo: esa factura ya no suma al stock."); close(); refrescar(); Control.abrir(); } catch (e) { toast("No se pudo guardar: " + e.message, 6000); }
      }));
    }, "ancho");
  },
};
