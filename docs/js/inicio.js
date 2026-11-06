"use strict";
/* ============ Vistas Mapa y Cargar, y arranque ============ */
Vistas.mapa = function () { badgeOrdenes(); setTimeout(() => Mapa.map && Mapa.map.invalidateSize(), 0); render(); };

Vistas.cargar = function () {
  const el = document.getElementById("v-cargar");
  el.innerHTML = `<div class="page-in">
    <div class="page-head"><h1>Cargar</h1>${DB.modo === "local" ? '<span class="small muted">Modo prueba · los datos quedan en este navegador</span>' : ""}</div>
    ${!S.esquemaOk ? avisoEsquema() : ""}
    <div class="acciones">
      <button class="accion" id="aFoto"><span class="ic">📷</span><span><b>Foto de remito o factura</b><span>Se reconoce el proveedor y cada insumo entra al stock del galpón. Si tiene varias hojas, elegí todas las fotos juntas.</span></span></button>
      <button class="accion" id="aPdf"><span class="ic">📄</span><span><b>Factura digital</b><span>El PDF de la factura electrónica que te mandan por correo o WhatsApp.</span></span></button>
      <button class="accion" id="aLab"><span class="ic">⚒</span><span><b>Labor</b><span>Cualquier labor realizada: siembra, pulverización, fertilización, disco, cosecha… Toma el precio de "Precios de labores".</span></span></button>
      <button class="accion" id="aOrd"><span class="ic">☑</span><span><b>Orden de trabajo</b><span>Para cualquier trabajo a hacer. Se manda por WhatsApp con la foto del lote.</span></span></button>
    </div>
  </div>`;
  const $ = (q) => el.querySelector(q);
  $("#aFoto").onclick = () => document.getElementById("fFoto").click();
  $("#aPdf").onclick = () => document.getElementById("fDoc").click();
  $("#aLab").onclick = () => Labores.form(null, {});
  $("#aOrd").onclick = () => Ordenes.form(null);
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
  try {
    await cargarDatos();
    S.esquemaOk = S.esquemaOk && (await DB.esquemaAlDia());
    /* La primera vez, cargar las labores habituales en el catálogo (sin precio) */
    if (S.esquemaOk && !S.d.labores_tipo.length) {
      const filas = CATALOGO_INICIAL.map(([nombre, categoria]) => ({ id: uid(), nombre, categoria, precios: [], insumos: [], activo: true }));
      await DB.guardarVarios("labores_tipo", filas); S.d.labores_tipo = filas;
    }
  } catch (e) { toast(e.message, 9000); } finally { fin(); }

  const sc = document.getElementById("selCamp");
  try { const c = localStorage.getItem("fc-camp"); if (c && campanas().includes(c)) S.campana = c; } catch (e) {}
  sc.innerHTML = opciones(campanas(), S.campana);
  sc.onchange = () => { S.campana = sc.value; try { localStorage.setItem("fc-camp", S.campana); } catch (e) {} dibujarLotes(); refrescar(); };

  document.getElementById("v-mapa").hidden = false;
  document.getElementById("btnOrdenes").onclick = () => irA("ordenes");
  Mapa.init(); Infra.iniciar(); badgeOrdenes(); dibujarLotes(); encuadrar(); render();
  const inicial = location.hash.slice(1) || (matchMedia("(max-width:820px)").matches ? "cargar" : "mapa");
  mostrarVista(inicial);

  /* Al volver a la app después de un rato, traer lo que cargaron otros */
  let oculto = 0;
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) { oculto = Date.now(); return; }
    if (DB.modo !== "nube" || Date.now() - oculto < 60000 || document.querySelector(".modal-bg") || S.drawing || S.editing) return;
    try { await DB.renovar(); await cargarDatos(); dibujarLotes(); Infra.dibujar(); refrescar(); } catch (e) {}
  });
})();
