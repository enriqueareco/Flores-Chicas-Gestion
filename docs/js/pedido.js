"use strict";
/* ============ Pedido de insumos: lo que piden las órdenes abiertas menos lo que hay en el galpón ============ */
const Pedido = {
  /* Calcula, por insumo, lo que necesitan las órdenes elegidas y lo que hay en el galpón */
  calcular(ordenIds) {
    const st = stockProductos(); const nec = {};
    for (const o of S.d.ordenes) {
      if (!ordenIds.has(o.id)) continue;
      for (const i of o.insumos || []) {
        if (!i.producto_id) continue;
        const q = i.cantidad != null ? Number(i.cantidad) : cantidadInsumo(i, o.superficie_ha).cant;
        const a = (nec[i.producto_id] ??= { necesita: 0, ordenes: new Set() }); a.necesita += q || 0; a.ordenes.add(o.numero);
      }
    }
    return Object.entries(nec).map(([id, a]) => {
      const p = productoDe(id); const s = st[id] || { entra: 0, sale: 0 }; const hay = s.entra - s.sale;
      const falta = Math.max(0, a.necesita - Math.max(0, hay));
      return { id, p, necesita: a.necesita, hay, falta, ordenes: [...a.ordenes].sort((x, y) => x - y) };
    }).filter((r) => r.p).sort((a, b) => (b.falta > 0) - (a.falta > 0) || (a.p.tipo || "").localeCompare(b.p.tipo || "") || a.p.nombre.localeCompare(b.p.nombre));
  },
  /* Redondeo hacia arriba para pedir: enteros, salvo cantidades chicas */
  redondear(q) { return q >= 10 ? Math.ceil(q) : Math.ceil(q * 10) / 10; },
  texto(filas, nota) {
    const lineas = filas.map((r) => {
      const extra = [r.p.principio_activo && norm(r.p.principio_activo) !== norm(r.p.nombre) ? r.p.principio_activo : "", r.p.concentracion || ""].filter(Boolean).join(" ");
      return `• ${r.p.nombre}${extra ? ` (${extra})` : ""}: ${fmt(r.pedir, r.pedir % 1 ? 1 : 0)} ${r.p.unidad === "u" ? "bolsas/unidades" : r.p.unidad}`;
    });
    return [`*Pedido de cotización · Flores Chicas*`, `Fecha: ${fechaAR(hoy())}`, "", ...lineas, "", nota || "Por favor cotizar precio unitario, presentación y plazo de entrega. Gracias."].join("\n");
  },
  abrir() {
    const abiertas = S.d.ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").sort((a, b) => (a.fecha_prevista || "9999").localeCompare(b.fecha_prevista || "9999") || (a.numero || 0) - (b.numero || 0));
    const sel = new Set(abiertas.map((o) => o.id));
    let todos = false; const editado = {}; const excluido = new Set();
    const provs = S.d.proveedores.filter((p) => p.tipo !== "contratista").sort((a, b) => a.nombre.localeCompare(b.nombre));
    modal(`<h4>Pedido de insumos</h4>
      <div class="small muted">Suma los productos de las órdenes de trabajo abiertas y descuenta lo que hay en el galpón. Lo que falta se puede mandar a los proveedores para que coticen.</div>
      ${abiertas.length ? `<h2>Órdenes que se tienen en cuenta</h2>
        <div class="col" style="gap:2px;max-height:170px;overflow:auto">${abiertas.map((o) => `<label class="row small" style="gap:6px"><input type="checkbox" data-o="${o.id}" checked> <b>N° ${o.numero}</b> · ${esc(nombreLabor(o))} · ${esc(nombreUbic(o.lote_id, o.sub_id))}${o.fecha_prevista ? ` · prevista ${fechaAR(o.fecha_prevista)}` : ""}</label>`).join("")}</div>` : `<div class="empty">No hay órdenes de trabajo abiertas. Cargá las órdenes y acá vas a ver qué productos te faltan.</div>`}
      <div class="row" style="justify-content:space-between"><h2>Qué hace falta</h2><label class="row small"><input type="checkbox" id="peTodos"> Mostrar también los que alcanzan</label></div>
      <div id="peTabla"></div>
      <div class="field"><label class="lbl" for="peNota">Mensaje al final</label><input id="peNota" value="Por favor cotizar precio unitario, presentación y plazo de entrega. Gracias."></div>
      <div class="field"><label class="lbl" for="peProv">Mandar a</label><div class="row"><select id="peProv" class="grow"><option value="">Elegir el contacto en WhatsApp</option>${provs.map((p) => `<option value="${p.id}">${esc(p.nombre)}${telWhatsapp(p.telefono) ? "" : " (sin teléfono cargado)"}</option>`).join("")}</select></div>
        <span class="small muted">Si elegís un proveedor con teléfono, se abre directo su chat. Repetí con cada proveedor al que le quieras pedir precio.</span></div>
      <div class="pie" style="justify-content:space-between"><button id="peCop">Copiar texto</button><span class="row"><button id="mNo">Cerrar</button><button class="primary" id="peWa">Enviar por WhatsApp</button></span></div>`, (m, close) => {
      const $ = (q) => m.querySelector(q);
      let filas = [];
      const pintar = () => {
        filas = Pedido.calcular(sel).map((r) => ({ ...r, pedir: editado[r.id] ?? Pedido.redondear(r.falta) }));
        const ver = filas.filter((r) => todos || r.falta > 0.0005);
        $("#peTabla").innerHTML = !sel.size ? `<div class="small muted">Elegí al menos una orden.</div>` : !ver.length ? `<div class="aviso" style="border-color:var(--ok)">Con lo que hay en el galpón alcanza para todas las órdenes elegidas.</div>`
          : `<div class="tablewrap"><table class="t"><tr><th></th><th>Insumo</th><th class="right">Órdenes</th><th class="right">Galpón</th><th class="right">Falta</th><th class="right">Pedir</th></tr>
            ${ver.map((r) => `<tr><td><input type="checkbox" data-inc="${r.id}" ${!excluido.has(r.id) && r.pedir > 0 ? "checked" : ""} aria-label="Incluir en el pedido"></td><td><b>${esc(r.p.nombre)}</b><div class="small muted">N° ${r.ordenes.join(", ")}</div></td><td class="num right">${fmt(r.necesita, 1)}</td><td class="num right">${fmt(Math.max(0, r.hay), 1)}</td><td class="num right">${r.falta > 0.0005 ? `<span class="pill bad">${fmt(r.falta, 1)}</span>` : '<span class="pill ok">alcanza</span>'}</td><td class="right"><span class="row" style="gap:4px;justify-content:flex-end;flex-wrap:nowrap"><input data-ped="${r.id}" inputmode="decimal" value="${r.pedir || ""}" style="width:80px;text-align:right"> <span class="small">${esc(r.p.unidad)}</span></span></td></tr>`).join("")}</table></div>
            <div class="small muted">"Pedir" está redondeado hacia arriba; cambialo si querés pedir por envase completo.</div>`;
        $("#peTabla").querySelectorAll("[data-ped]").forEach((inp) => (inp.oninput = () => { const v = num(inp.value); editado[inp.dataset.ped] = v ?? 0; const f = filas.find((x) => x.id === inp.dataset.ped); if (f) f.pedir = v ?? 0; const ck = $(`[data-inc="${inp.dataset.ped}"]`); if (ck && v > 0 && !excluido.has(inp.dataset.ped)) ck.checked = true; }));
        $("#peTabla").querySelectorAll("[data-inc]").forEach((ck) => (ck.onchange = () => { ck.checked ? excluido.delete(ck.dataset.inc) : excluido.add(ck.dataset.inc); }));
      };
      const elegidas = () => filas.filter((r) => !excluido.has(r.id) && r.pedir > 0 && (todos || r.falta > 0.0005 || editado[r.id] > 0));
      pintar();
      /* Al cambiar las órdenes se recalcula todo (se descartan las cantidades cambiadas a mano) */
      m.querySelectorAll("[data-o]").forEach((ck) => (ck.onchange = () => { ck.checked ? sel.add(ck.dataset.o) : sel.delete(ck.dataset.o); for (const k in editado) delete editado[k]; pintar(); }));
      $("#peTodos").onchange = (e) => { todos = e.target.checked; pintar(); };
      $("#mNo").onclick = close;
      const armar = () => { const f = elegidas(); if (!f.length) { toast("No hay productos para pedir."); return null; } return Pedido.texto(f, $("#peNota").value.trim()); };
      $("#peCop").onclick = async () => { const t = armar(); if (!t) return; try { await navigator.clipboard.writeText(t); toast("Texto copiado"); } catch (e) { toast("No se pudo copiar."); } };
      $("#peWa").onclick = async () => {
        const t = armar(); if (!t) return;
        const p = proveedorDe($("#peProv").value); const tel = telWhatsapp(p?.telefono);
        if (!tel && navigator.share && matchMedia("(max-width:820px)").matches) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === "AbortError") return; } }
        if (p && !tel) toast(`${p.nombre} no tiene teléfono cargado: elegí el chat en WhatsApp.`, 6000);
        window.open(`https://wa.me/${tel || ""}?text=${encodeURIComponent(t)}`, "_blank", "noopener");
      };
    }, "medio");
  },
};
