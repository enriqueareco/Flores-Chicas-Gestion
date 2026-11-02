"use strict";
/* ============ Vistas Mapa y Cargar, y arranque ============ */
Vistas.mapa = function () { setTimeout(() => Mapa.map && Mapa.map.invalidateSize(), 0); render(); };

Vistas.cargar = function () {
  const el = document.getElementById("v-cargar");
  const borr = S.d.comprobantes.filter((c) => c.estado === "borrador");
  const abiertas = S.d.ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").sort((a, b) => (a.fecha_prevista || "9999").localeCompare(b.fecha_prevista || "9999"));
  const aDef = S.d.labores.filter((l) => l.campana === S.campana && l.costo_estado !== "acordado").length;
  const ultimas = [...S.d.labores].sort((a, b) => (b.creado || "").localeCompare(a.creado || "")).slice(0, 5);
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Cargar</h1>${DB.modo === "local" ? '<span class="small muted">Modo prueba · los datos quedan en este navegador</span>' : ""}</div>
    <div class="acciones">
      <button class="accion" id="aFoto"><span class="ic">📷</span><span><b>Foto de factura o remito</b><span>Se lee el proveedor, los productos y las cantidades. Si tiene varias hojas, elegí todas las fotos juntas.</span></span></button>
      <button class="accion" id="aPdf"><span class="ic">📄</span><span><b>Factura digital (PDF)</b><span>La factura electrónica que te mandan por correo o WhatsApp.</span></span></button>
      <button class="accion" id="aDic"><span class="ic">🎤</span><span><b>Dictar una labor</b><span>Contá qué se hizo y en qué lote, con el micrófono del teclado.</span></span></button>
      <button class="accion" id="aPul"><span class="ic">💧</span><span><b>Registrar pulverización</b><span>Productos, dosis, condiciones y receta agronómica.</span></span></button>
      <button class="accion" id="aLab"><span class="ic">⚒</span><span><b>Otra labor</b><span>Siembra, fertilización, cosecha, labranza… El precio se puede definir después.</span></span></button>
      <button class="accion" id="aOrd"><span class="ic">☑</span><span><b>Orden de trabajo</b><span>Para imprimir o mandar por WhatsApp al contratista.</span></span></button>
    </div>
    <div class="kpis">
      <button class="kpi ${borr.length ? "alerta" : ""}" data-ir="comprobantes" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><span>Comprobantes para revisar</span><b>${borr.length}</b></button>
      <button class="kpi" data-ir="ordenes" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><span>Órdenes abiertas</span><b>${abiertas.length}</b></button>
      <button class="kpi ${aDef ? "alerta" : ""}" data-ir="labores" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><span>Labores con precio a definir</span><b>${aDef}</b></button>
    </div>
    ${abiertas.length ? `<div class="card"><h2>Órdenes abiertas</h2>${abiertas.slice(0, 6).map((o) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:6px"><span><b>N° ${o.numero}</b> · ${esc(o.tipo)} · ${esc(nombreUbic(o.lote_id, o.sub_id))}<div class="small muted">Prevista ${fechaAR(o.fecha_prevista)}${o.contratista ? " · " + esc(o.contratista) : ""}</div></span><button data-o="${o.id}">Ver</button></div>`).join("")}</div>` : ""}
    ${ultimas.length ? `<div class="card"><h2>Últimas labores cargadas</h2>${ultimas.map((l) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:6px;cursor:pointer" data-l="${l.id}"><span><b>${esc(l.tipo)}</b> · ${esc(nombreUbic(l.lote_id, l.sub_id))}<div class="small muted">${fechaAR(l.fecha)}${l.insumos?.length ? " · " + esc(textoInsumos(l)) : ""}</div></span><span class="small muted">${esc(l.creado_por && l.creado_por !== "modo prueba" ? l.creado_por.split("@")[0] : "")}</span></div>`).join("")}</div>` : ""}
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#aFoto").onclick = () => document.getElementById("fFoto").click();
  $("#aPdf").onclick = () => document.getElementById("fDoc").click();
  $("#aDic").onclick = () => Labores.dictado();
  $("#aPul").onclick = () => Labores.form(null, { tipo: "Pulverización" });
  $("#aLab").onclick = () => Labores.form(null, { tipo: "Siembra" });
  $("#aOrd").onclick = () => Ordenes.form(null);
  el.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => irA(b.dataset.ir)));
  el.querySelectorAll("[data-o]").forEach((b) => (b.onclick = () => Ordenes.ver(S.d.ordenes.find((o) => o.id === b.dataset.o))));
  el.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => Labores.form(S.d.labores.find((l) => l.id === b.dataset.l))));
};

(async () => {
  await Cache.abrir();
  await DB.iniciar();
  document.getElementById("modoChip").hidden = DB.modo !== "local";
  document.getElementById("btnCuenta").onclick = menuCuenta;
  if (DB.modo === "nube") {
    DB.sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") pedirClaveNueva(); });
    if (!DB.usuario) await pantallaIngreso();
  }
  const fin = cargando("Cargando datos…");
  try { await cargarDatos(); } catch (e) { toast(e.message, 9000); } finally { fin(); }

  const sc = document.getElementById("selCamp");
  try { const c = localStorage.getItem("fc-camp"); if (c && campanas().includes(c)) S.campana = c; } catch (e) {}
  sc.innerHTML = opciones(campanas(), S.campana);
  sc.onchange = () => { S.campana = sc.value; try { localStorage.setItem("fc-camp", S.campana); } catch (e) {} dibujarLotes(); refrescar(); };

  document.getElementById("v-mapa").hidden = false;
  Mapa.init(); dibujarLotes(); encuadrar(); render();
  const inicial = location.hash.slice(1) || (matchMedia("(max-width:820px)").matches ? "cargar" : "mapa");
  mostrarVista(inicial);

  /* Al volver a la app después de un rato, traer lo que cargaron otros */
  let oculto = 0;
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) { oculto = Date.now(); return; }
    if (DB.modo !== "nube" || Date.now() - oculto < 60000 || document.querySelector(".modal-bg") || S.drawing || S.editing) return;
    try { await cargarDatos(); dibujarLotes(); refrescar(); } catch (e) {}
  });
})();
