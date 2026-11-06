"use strict";
/* ============ Mapa de lotes ============ */
const STAC = "https://earth-search.aws.element84.com/v1/search";
const YCOL = ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"];
Object.assign(S, { sel: null, layers: new Map(), subLayers: new Map(), drawing: null, editing: null, overlay: null, ndvi: { items: [], sel: null, series: {} }, rindeVis: null, rindeLote: null, puntosCache: {} });
const feat = (g) => ({ type: "Feature", properties: {}, geometry: g });
const proximoNombre = (l) => { const usados = new Set((l.subs || []).map((s) => s.nombre)); for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!usados.has("Sector " + ch)) return "Sector " + ch; return "Sector " + ((l.subs || []).length + 1); };
const subNom = (l, id) => subsDe(l, id).map((s) => s.nombre).join(" + ") || "Sector borrado";
async function puntosRinde(r) {
  if (S.puntosCache[r.id]) return S.puntosCache[r.id];
  try { const b = await DB.bajar("rindes", r.path || r.id + ".json"); if (!b) return null; const p = JSON.parse(await b.text()); S.puntosCache[r.id] = p; return p; } catch (e) { return null; }
}
async function guardarLote(l) { await guardar("lotes", l); }

let map, bases, lotesGroup, canvasR, rindeLayer = null, baseActual = "sat";
const tileStat = {};
function avisoMapa(html) { let el = document.getElementById("mapAviso"); if (!el) { el = document.createElement("div"); el.id = "mapAviso"; el.style.cssText = "position:absolute;top:52px;left:56px;right:12px;z-index:600;background:var(--panel);color:var(--ink);border:1px solid var(--danger);border-radius:8px;padding:10px 12px;font-size:14px;box-shadow:0 2px 12px rgba(0,0,0,.3);max-width:520px"; document.querySelector(".mapwrap").appendChild(el); } el.innerHTML = html; el.hidden = !html; }
function cambiarBase(k) { Object.values(bases).forEach((b) => map.removeLayer(b)); baseActual = k; bases[k].addTo(map).bringToBack(); try { localStorage.setItem("fc-base", k); } catch (e) {} }

function iniciarMapa() {
  map = L.map("map", { zoomControl: true }).setView([-38.163, -58.782], 12);
  bases = {
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18, attribution: "Imagen © Esri, Maxar" }),
    sat2: L.tileLayer("https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18, attribution: "Imagen © Esri Clarity" }),
    s2: L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg", { maxZoom: 19, maxNativeZoom: 15, attribution: "Sentinel-2 cloudless © EOX (datos Copernicus)" }),
    osm: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }),
  };
  const ORDEN = ["sat", "sat2", "s2"];
  for (const [k, lyr] of Object.entries(bases)) {
    tileStat[k] = { ok: 0, err: 0 };
    lyr.on("tileload", () => { tileStat[k].ok++; if (k === baseActual) avisoMapa(""); });
    lyr.on("tileerror", () => {
      const st = tileStat[k]; st.err++; if (k !== baseActual || st.ok > 0 || st.err < 6) return;
      const i = ORDEN.indexOf(k);
      if (i >= 0 && i < ORDEN.length - 1) { const nx = ORDEN[i + 1]; cambiarBase(nx); document.getElementById("selBase").value = nx; toast("La fuente de imagen no respondió; probando otra."); }
      else avisoMapa("<b>No se cargan las imágenes del mapa.</b><br>Revisá la conexión a internet. Un antivirus o una red con filtro puede estar bloqueando los servidores de mapas.");
    });
  }
  try { const b = localStorage.getItem("fc-base"); if (b && bases[b]) baseActual = b; } catch (e) {}
  document.getElementById("selBase").value = baseActual;
  bases[baseActual].addTo(map);
  lotesGroup = L.featureGroup().addTo(map);
  canvasR = L.canvas({ padding: 0.3 });
  document.getElementById("selBase").onchange = (e) => cambiarBase(e.target.value);
  map.on("mousemove", (e) => (document.getElementById("coord").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`));
  map.on("zoomend", () => { map.getContainer().classList.toggle("hide-labels", map.getZoom() < 13); map.getContainer().classList.toggle("hide-sublabels", map.getZoom() < 15); });
  map.on("click", () => { if (S.sel && !S.editing && !S.drawing) { S.sel = null; limpiarOverlays(); restyle(); render(); } });
  document.getElementById("btnDraw").onclick = () => Dib.iniciar();
  document.getElementById("btnKmz").onclick = () => document.getElementById("fKmz").click();
}

const hueco = (l) => S.sel === l.id && (S.overlay || S.rindeVis);
function estilo(l) { const sel = S.sel === l.id; const c = colorDe(l); const conSubs = (l.subs || []).length > 0; return { color: sel ? "#F2C14E" : conSubs ? "#ffffff" : c, weight: sel ? 3.5 : 2, fillColor: c, fillOpacity: hueco(l) || conSubs ? 0 : 0.32, dashArray: conSubs || siembraDe(l) ? null : "5 4" }; }
function estiloSub(l, sb) { return { color: "#ffffff", weight: 1.2, dashArray: "4 3", fillColor: colorSub(l, sb), fillOpacity: hueco(l) ? 0 : 0.38 }; }
function dibujarLotes() {
  if (!map) return;
  lotesGroup.clearLayers(); S.layers.clear(); S.subLayers.clear();
  const clic = (ev, l) => { L.DomEvent.stopPropagation(ev); if (S.drawing) { S.drawing._click(ev); return; } if (!S.editing) seleccionar(l.id); };
  for (const l of S.d.lotes) {
    for (const sb of l.subs || []) {
      const y = L.geoJSON(sb.geom).getLayers()[0]; if (!y) continue; y.setStyle(estiloSub(l, sb));
      const t = textoCultivos(l, sb.id); y.bindTooltip(`${esc(sb.nombre)}${t ? "<br>" + esc(t) : ""}`, { permanent: true, direction: "center", className: "lote-label sub-label" });
      y.on("click", (ev) => clic(ev, l)); y.addTo(lotesGroup); S.subLayers.set(sb.id, { y, l, sb });
    }
    const lyr = L.geoJSON(l.geom).getLayers()[0]; if (!lyr) continue;
    lyr.setStyle(estilo(l));
    const t = (l.subs || []).length ? "" : textoCultivos(l);
    lyr.bindTooltip(`${esc(l.nombre)}${t ? "<br>" + esc(t) : ""}`, { permanent: true, direction: (l.subs || []).length ? "top" : "center", className: "lote-label" });
    lyr.on("click", (ev) => clic(ev, l)); lyr.addTo(lotesGroup); S.layers.set(l.id, lyr);
    if ((l.subs || []).length) lyr.bringToBack();
  }
  map.getContainer().classList.toggle("hide-labels", map.getZoom() < 13);
  map.getContainer().classList.toggle("hide-sublabels", map.getZoom() < 15);
}
function restyle() { for (const l of S.d.lotes) { const y = S.layers.get(l.id); if (y) y.setStyle(estilo(l)); } for (const { y, l, sb } of S.subLayers.values()) y.setStyle(estiloSub(l, sb)); }
function encuadrar() { if (map && lotesGroup.getLayers().length) map.fitBounds(lotesGroup.getBounds(), { padding: [30, 30] }); }

function camposExistentes() { return [...new Set(S.d.lotes.map((l) => l.campo).filter(Boolean))]; }
function formLote(l, geom) {
  const nuevo = !l;
  modal(`<h4>${nuevo ? "Nuevo lote" : "Datos del lote"}</h4>
    <div class="field"><label class="lbl" for="lNom">Nombre</label><input id="lNom" value="${esc(l?.nombre || "")}" placeholder="Ej. Lote 31"></div>
    <div class="field"><label class="lbl" for="lCampo">Establecimiento</label><input id="lCampo" list="dlCampos" value="${esc(l?.campo || "")}" placeholder="Ej. Santa Clara"><datalist id="dlCampos">${camposExistentes().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
    ${nuevo ? `<div class="muted small">Superficie dibujada: <b class="num">${fmt(haDe(geom))} ha</b></div>` : ""}
    <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
    m.querySelector("#mNo").onclick = close;
    m.querySelector("#mOk").onclick = async () => {
      const nombre = m.querySelector("#lNom").value.trim(); if (!nombre) { m.querySelector("#lNom").focus(); return; }
      const campo = m.querySelector("#lCampo").value.trim();
      try {
        if (nuevo) { const n = await guardar("lotes", { id: uid(), nombre, campo, geom, subs: [], notas: "" }); dibujarLotes(); close(); seleccionar(n.id); }
        else { l.nombre = nombre; l.campo = campo; await guardarLote(l); dibujarLotes(); close(); render(); }
      } catch (e) { toast(e.message, 6000); }
    };
  });
}

/* ============ Dibujo ============ */
/* Dibujo propio: clic agrega punto, arrastrar mueve, Esc borra el último, clic derecho borra ese punto, Enter o clic en el primero cierra */
const Dib={pts:[],mk:[],poly:null,guia:null,ultDrag:0,
  icono(primero){return L.divIcon({className:"",iconSize:[14,14],iconAnchor:[7,7],html:`<div style="width:14px;height:14px;border-radius:${primero?"50%":"2px"};background:${primero?"#F2C14E":"#fff"};border:2px solid #1F2A22;box-shadow:0 0 0 1px #fff;cursor:move"></div>`})},
  opt:{},
  iniciar(opt={}){if(S.drawing){this.cancelar();return}
    this.opt={modo:"poly",titulo:"Dibujando lote",onDone:g=>formLote(null,g),...opt};
    S.drawing=this;this.pts=[];this.mk=[];
    this.poly=(this.opt.modo==="linea"?L.polyline([],{color:"#F2C14E",weight:3,interactive:false}):L.polygon([],{color:"#F2C14E",weight:3,fillOpacity:.18,interactive:false})).addTo(map);
    this.guia=L.polyline([],{color:"#F2C14E",weight:2,dashArray:"6 6",interactive:false}).addTo(map);
    map.doubleClickZoom.disable();map.getContainer().style.cursor="crosshair";
    map.on("click",this._click,this);map.on("mousemove",this._move,this);
    document.addEventListener("keydown",this._key);
    document.getElementById("btnDraw").textContent="✕ Cancelar dibujo";this.barra();},
  _click(e){if(Date.now()-this.ultDrag<350)return;this.agregar(e.latlng)},
  _move(e){if(!this.pts.length){this.guia.setLatLngs([]);return}const a=this.pts[this.pts.length-1];this.guia.setLatLngs(this.pts.length>=2&&this.opt.modo!=="linea"?[a,e.latlng,this.pts[0]]:[a,e.latlng])},
  _key:e=>{if(!S.drawing)return;if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if(e.key==="Escape"){e.preventDefault();Dib.borrarUltimo()}
    else if(e.key==="Enter"){e.preventDefault();Dib.terminar()}
    else if((e.key==="z"||e.key==="Z")&&(e.ctrlKey||e.metaKey)){e.preventDefault();Dib.borrarUltimo()}},
  agregar(ll){const i=this.pts.length;this.pts.push(ll);
    const m=L.marker(ll,{draggable:true,icon:this.icono(i===0&&this.opt.modo!=="linea"),zIndexOffset:1000,keyboard:false}).addTo(map);
    m.on("drag",()=>{const k=this.mk.indexOf(m);this.pts[k]=m.getLatLng();this.redibujar(false)});
    m.on("dragend",()=>{this.ultDrag=Date.now();this.redibujar()});
    m.on("click",ev=>{L.DomEvent.stopPropagation(ev);if(Date.now()-this.ultDrag<350)return;if(this.opt.modo!=="linea"&&this.mk.indexOf(m)===0&&this.pts.length>=3)this.terminar()});
    m.on("contextmenu",ev=>{L.DomEvent.stopPropagation(ev);L.DomEvent.preventDefault(ev);this.borrar(this.mk.indexOf(m))});
    this.mk.push(m);this.redibujar()},
  borrar(k){if(k<0)return;map.removeLayer(this.mk[k]);this.mk.splice(k,1);this.pts.splice(k,1);if(this.mk[0])this.mk[0].setIcon(this.icono(this.opt.modo!=="linea"));this.guia.setLatLngs([]);this.redibujar()},
  borrarUltimo(){if(!this.pts.length){this.cancelar();return}this.borrar(this.pts.length-1)},
  redibujar(barra=true){this.poly.setLatLngs(this.pts);if(barra)this.barra()},
  ha(){if(this.pts.length<3)return 0;const c=this.pts.map(p=>[p.lng,p.lat]);c.push(c[0]);return haDe({type:"Polygon",coordinates:[c]})},
  barra(){let el=document.getElementById("dibBarra");
    if(!el){el=document.createElement("div");el.id="dibBarra";el.style.cssText="position:absolute;top:12px;left:56px;right:12px;z-index:650;background:var(--panel);color:var(--ink);border:2px solid var(--sel);border-radius:8px;padding:10px 12px;box-shadow:0 2px 12px rgba(0,0,0,.3);max-width:560px;display:flex;flex-direction:column;gap:8px";document.querySelector(".mapwrap").appendChild(el)}
    const n=this.pts.length;const lin=this.opt.modo==="linea";const min=lin?2:3;
    el.innerHTML=`<div class="row" style="justify-content:space-between"><b>${esc(this.opt.titulo)}</b><span class="num small">${n} punto${n!==1?"s":""}${!lin&&n>=3?" · "+fmt(this.ha())+" ha":""}</span></div>
      <div class="small muted">${lin?"Trazá una línea que cruce el lote de lado a lado; podés quebrarla con varios puntos. Arrastrá un punto para moverlo · <b>Esc</b> borra el último · clic derecho sobre un punto lo borra · <b>Enter</b> corta":"Clic agrega un punto · arrastrá un punto para moverlo · <b>Esc</b> borra el último · clic derecho sobre un punto lo borra · <b>Enter</b> o clic en el punto amarillo cierra"}</div>
      <div class="row"><button id="dUndo" ${n?"":"disabled"}>↶ Borrar último (Esc)</button><button class="primary" id="dOk" ${n>=min?"":"disabled"}>${lin?"Cortar":"Terminar"} (Enter)</button><button class="ghost" id="dNo">Cancelar</button></div>`;
    el.querySelector("#dUndo").onclick=()=>this.borrarUltimo();el.querySelector("#dOk").onclick=()=>this.terminar();el.querySelector("#dNo").onclick=()=>this.cancelar();
    L.DomEvent.disableClickPropagation(el)},
  salir(){map.off("click",this._click,this);map.off("mousemove",this._move,this);document.removeEventListener("keydown",this._key);
    this.mk.forEach(m=>map.removeLayer(m));map.removeLayer(this.poly);map.removeLayer(this.guia);this.mk=[];
    map.doubleClickZoom.enable();map.getContainer().style.cursor="";document.getElementById("dibBarra")?.remove();
    document.getElementById("btnDraw").textContent="✎ Dibujar lote";setTimeout(()=>{S.drawing=null},50)},
  cancelar(){this.pts=[];this.salir()},
  terminar(){const c=this.pts.map(p=>[p.lng,p.lat]);
    if(this.opt.modo==="linea"){if(c.length<2){toast("La línea necesita al menos 2 puntos.");return}const cb=this.opt.onDone;this.salir();cb({type:"LineString",coordinates:c});return}
    if(this.pts.length<3){toast("Hacen falta al menos 3 puntos.");return}
    c.push(c[0]);const geom={type:"Polygon",coordinates:[c]};
    try{if(turf.kinks({type:"Feature",geometry:geom}).features.length){toast("El contorno se cruza a sí mismo. Mové algún punto antes de terminar.",5000);return}}catch(e){}
    const cb=this.opt.onDone;this.salir();cb(geom)}
};
document.getElementById("btnDraw").onclick=()=>Dib.iniciar();


/* ============ Importar KMZ/KML ============ */
document.getElementById("btnKmz").onclick=()=>document.getElementById("fKmz").click();
document.getElementById("fKmz").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;
  try{let txt;
    if(/\.kmz$/i.test(f.name)){const z=await JSZip.loadAsync(await f.arrayBuffer());const k=Object.keys(z.files).find(n=>/\.kml$/i.test(n));if(!k)throw new Error("El KMZ no contiene un archivo KML.");txt=await z.file(k).async("string")}
    else txt=await f.text();
    const gj=toGeoJSON.kml(new DOMParser().parseFromString(txt,"text/xml"));
    const polys=[];
    for(const ft of gj.features){let g=ft.geometry;if(!g)continue;
      if(g.type==="GeometryCollection"){const p=g.geometries.filter(x=>/Polygon/.test(x.type));if(!p.length)continue;g=p.length===1?p[0]:{type:"MultiPolygon",coordinates:p.flatMap(x=>x.type==="Polygon"?[x.coordinates]:x.coordinates)}}
      if(g.type==="LineString"){const c=g.coordinates;if(c.length>3&&c[0][0]===c[c.length-1][0]&&c[0][1]===c[c.length-1][1])g={type:"Polygon",coordinates:[c]};else continue}
      if(!/Polygon/.test(g.type))continue;
      polys.push({nombre:(ft.properties?.name||`Lote ${polys.length+1}`).toString().trim(),geom:quitarZ(g)})}
    if(!polys.length){toast("No encontré polígonos en el archivo.");return}
    importarPreview(polys,f.name);
  }catch(err){console.error(err);toast("No pude leer el archivo: "+err.message,6000)}
};
function quitarZ(g){const f=a=>typeof a[0]==="number"?[a[0],a[1]]:a.map(f);return {type:g.type,coordinates:f(g.coordinates)}}
function importarPreview(polys,fname){
  const exist=new Set(S.d.lotes.map(l=>l.nombre.toLowerCase()));
  modal(`<h4>Importar ${polys.length} lote${polys.length>1?"s":""}</h4><div class="muted small">${esc(fname)}</div>
    <div class="field"><label class="lbl" for="iCampo">Establecimiento para todos</label><input id="iCampo" list="dlC2" placeholder="Ej. Flores Chicas"><datalist id="dlC2">${camposExistentes().map(c=>`<option value="${esc(c)}">`).join("")}</datalist></div>
    <div style="max-height:300px;overflow:auto"><table class="t"><tr><th></th><th>Nombre</th><th style="text-align:right">ha</th></tr>
    ${polys.map((p,i)=>`<tr><td><input type="checkbox" id="ck${i}" ${exist.has(p.nombre.toLowerCase())?"":"checked"}></td><td><input id="nm${i}" value="${esc(p.nombre)}" style="width:100%">${exist.has(p.nombre.toLowerCase())?'<div class="small muted">Ya existe uno con este nombre</div>':""}</td><td class="num" style="text-align:right">${fmt(haDe(p.geom))}</td></tr>`).join("")}</table></div>
    <div class="row" style="justify-content:flex-end"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Importar seleccionados</button></div>`,(m,close)=>{
    m.querySelector("#mNo").onclick=close;
    m.querySelector("#mOk").onclick=async()=>{const campo=m.querySelector("#iCampo").value.trim();let n=0;const nuevos=[];
      polys.forEach((p,i)=>{if(m.querySelector("#ck"+i).checked){nuevos.push({id:uid(),nombre:m.querySelector("#nm"+i).value.trim()||p.nombre,campo,geom:p.geom,subs:[],notas:""});n++}});
      await DB.guardarVarios("lotes",nuevos);S.d.lotes.push(...nuevos);dibujarLotes();close();if(lotesGroup.getLayers().length)map.fitBounds(lotesGroup.getBounds(),{padding:[30,30]});render();toast(`${n} lote${n!==1?"s":""} importado${n!==1?"s":""}`)};
  });
}


/* ============ Subdivisiones ============ */
const MIN_M2 = 300;
function piezas(f) { if (!f) return []; return turf.flatten(f).features.filter((p) => turf.area(p) >= MIN_M2).map((p) => p.geometry); }
const multi = (ps) => ps.length === 1 ? ps[0] : { type: "MultiPolygon", coordinates: ps.flatMap((p) => p.type === "Polygon" ? [p.coordinates] : p.coordinates) };
async function borrarSiembrasDeSubs(l, ids) { for (const s of S.d.siembras.filter((s) => s.lote_id === l.id && s.sub_id && ids.has(s.sub_id))) await borrar("siembras", s.id); }
async function copiarSiembras(l, deId, aId) { for (const s of S.d.siembras.filter((s) => s.lote_id === l.id && s.sub_id === deId && s.campana === S.campana)) await guardar("siembras", { ...s, id: uid(), sub_id: aId, creado: null }); }
async function dividirConLinea(l, line) {
  let corte; try { corte = turf.buffer(feat(line), 0.15, { units: "meters" }); } catch (e) { toast("No pude usar esa línea."); return; }
  const base = l.subs.length ? l.subs : [{ id: null, nombre: null, geom: l.geom }]; const nuevos = []; const copias = []; let cortados = 0;
  for (const t of base) {
    let d = null; try { d = turf.difference(feat(t.geom), corte); } catch (e) {}
    const ps = piezas(d).sort((a, b) => turf.area(feat(b)) - turf.area(feat(a)));
    if (ps.length < 2) { nuevos.push(t); continue; }
    cortados++;
    ps.forEach((g, i) => { if (i === 0 && t.id) nuevos.push({ ...t, geom: g }); else { const sb = { id: uid(), nombre: "", geom: g }; nuevos.push(sb); if (t.id) copias.push([t.id, sb.id]); } });
  }
  if (!cortados) { toast("La línea tiene que cruzar el lote (o un sector) de lado a lado.", 5000); return; }
  l.subs = nuevos; for (const sb of l.subs) if (!sb.nombre) sb.nombre = proximoNombre(l);
  await guardarLote(l); for (const [a, b] of copias) await copiarSiembras(l, a, b);
  dibujarLotes(); render(); toast(`Quedan ${l.subs.length} sectores.`);
}
async function agregarSector(l, poly) {
  let g = null; try { g = turf.intersect(feat(l.geom), feat(poly)); } catch (e) {}
  const ps = piezas(g); if (!ps.length) { toast("El sector tiene que quedar dentro del lote."); return; }
  const sgeom = multi(ps); const nuevo = { id: uid(), nombre: "", geom: sgeom };
  const base = l.subs.length ? l.subs : [{ id: null, nombre: "Resto", geom: l.geom }]; const nuevos = [];
  for (const t of base) {
    let d = null; try { d = turf.difference(feat(t.geom), feat(sgeom)); } catch (e) {}
    const r = piezas(d); if (!r.length) continue;
    if (t.id) nuevos.push({ ...t, geom: multi(r) }); else nuevos.push({ id: uid(), nombre: "Resto", geom: multi(r) });
  }
  nuevos.push(nuevo); const borrados = new Set(base.filter((t) => t.id && !nuevos.some((n) => n.id === t.id)).map((t) => t.id));
  l.subs = nuevos; nuevo.nombre = proximoNombre(l);
  await guardarLote(l); await borrarSiembrasDeSubs(l, borrados); dibujarLotes(); render(); formSub(l, nuevo);
}
function formSub(l, sb) {
  modal(`<h4>Nombre del sector</h4><div class="muted small">${esc(l.nombre)} · ${fmt(haDe(sb.geom))} ha</div>
  <div class="field"><label class="lbl" for="sbNom">Nombre</label><input id="sbNom" value="${esc(sb.nombre)}"></div>
  <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
    m.querySelector("#mNo").onclick = close;
    m.querySelector("#mOk").onclick = async () => { const v = m.querySelector("#sbNom").value.trim(); if (v) sb.nombre = v; await guardarLote(l); close(); dibujarLotes(); render(); };
    m.querySelector("#sbNom").onkeydown = (e) => { if (e.key === "Enter") m.querySelector("#mOk").click(); };
  });
}
function borrarSub(l, sb) {
  const otros = l.subs.filter((x) => x.id !== sb.id);
  if (otros.length <= 1) {
    modal(`<h4>Quitar sector</h4><p>Si quitás <b>${esc(sb.nombre)}</b> el lote queda sin subdivisiones. Los cultivos cargados por sector se borran; los del lote completo se mantienen.</p><div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Quitar subdivisiones</button></div>`, (m, close) => {
      m.querySelector("#mNo").onclick = close;
      m.querySelector("#mOk").onclick = async () => { const ids = new Set(l.subs.map((s) => s.id)); l.subs = []; await guardarLote(l); await borrarSiembrasDeSubs(l, ids); close(); dibujarLotes(); render(); };
    });
    return;
  }
  modal(`<h4>Quitar ${esc(sb.nombre)}</h4><p class="small">Su superficie (${fmt(haDe(sb.geom))} ha) se suma a otro sector. Los cultivos cargados solo para ${esc(sb.nombre)} se borran.</p>
    <div class="field"><label class="lbl" for="sbDest">Sumar a</label><select id="sbDest">${otros.map((o) => `<option value="${o.id}">${esc(o.nombre)} · ${fmt(haDe(o.geom))} ha</option>`).join("")}</select></div>
    <div class="pie"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Quitar y unir</button></div>`, (m, close) => {
    m.querySelector("#mNo").onclick = close;
    m.querySelector("#mOk").onclick = async () => {
      const dst = otros.find((o) => o.id === m.querySelector("#sbDest").value);
      try { const u = turf.union(turf.buffer(feat(dst.geom), 0.2, { units: "meters" }), turf.buffer(feat(sb.geom), 0.2, { units: "meters" })); const ui = turf.intersect(u, feat(l.geom)); dst.geom = (ui || u).geometry; } catch (e) { toast("No pude unir los sectores."); return; }
      l.subs = otros; await guardarLote(l); await borrarSiembrasDeSubs(l, new Set([sb.id])); close(); dibujarLotes(); render();
    };
  });
}
function ajustarSubsAContorno(l) {
  if (!l.subs.length) return new Set();
  const out = [];
  for (const sb of l.subs) { let g = null; try { g = turf.intersect(feat(sb.geom), feat(l.geom)); } catch (e) {} const ps = piezas(g); if (ps.length) out.push({ ...sb, geom: multi(ps) }); }
  let resto = feat(l.geom); for (const sb of out) { try { resto = turf.difference(resto, feat(sb.geom)); } catch (e) {} if (!resto) break; }
  for (const g of piezas(resto)) out.push({ id: uid(), nombre: "", geom: g });
  const ids = new Set(out.map((s) => s.id)); const quitados = new Set(l.subs.filter((s) => !ids.has(s.id)).map((s) => s.id));
  l.subs = out; for (const sb of l.subs) if (!sb.nombre) sb.nombre = proximoNombre(l);
  return quitados;
}
function editarContorno(l) {
  const y = S.layers.get(l.id); if (!y || !y.editing) { toast("Este contorno no se puede editar."); return; }
  S.editing = y; y.editing.enable();
  document.getElementById("panel").insertAdjacentHTML("afterbegin", `<section class="blk" id="editBar" style="background:var(--sel);color:#1F2A22"><b>Editando contorno</b><span class="small">Arrastrá los vértices. Los puntos intermedios agregan vértices nuevos.</span><div class="row"><button class="primary" id="eOk">Guardar contorno</button><button id="eNo">Cancelar</button></div></section>`);
  document.getElementById("eOk").onclick = async () => { y.editing.disable(); l.geom = y.toGeoJSON().geometry; S.editing = null; const q = ajustarSubsAContorno(l); await guardarLote(l); await borrarSiembrasDeSubs(l, q); dibujarLotes(); render(); toast(`Contorno guardado: ${fmt(haDe(l.geom))} ha`); };
  document.getElementById("eNo").onclick = () => { y.editing.disable(); S.editing = null; dibujarLotes(); render(); };
}

/* ============ Cultivos por campaña ============ */
function formSiembra(l, sid, def = {}) {
  const x = sid ? S.d.siembras.find((s) => s.id === sid) : null;
  const d = x || def;
  modal(`<h4>${x ? "Editar" : "Agregar"} cultivo · ${esc(l.nombre)}</h4>
    <div class="row"><div class="field"><label class="lbl" for="sCamp">Campaña</label><select id="sCamp">${opciones(campanas(), x?.campana || S.campana)}</select></div>
    <div class="field grow"><label class="lbl" for="sCult">Cultivo</label><select id="sCult">${opcionesCultivos(x?.cultivo)}</select></div></div>
    ${l.subs.length ? `<div class="field"><label class="lbl" for="sSub">Dónde</label><select id="sSub">${opcionesSubs(l, d?.sub_id).replace("Lote completo", "Lote completo · " + fmt(haDe(l.geom)) + " ha")}</select></div>` : ""}
    <div class="row"><div class="field grow"><label class="lbl" for="sHib">Híbrido / variedad</label><input id="sHib" value="${esc(x?.hibrido || "")}"></div><div class="field"><label class="lbl" for="sFec">Fecha de siembra</label><input type="date" id="sFec" value="${esc(x?.fecha || "")}"></div></div>
    <div class="field"><label class="lbl" for="sNot">Notas</label><input id="sNot" value="${esc(x?.notas || "")}" placeholder="Densidad, fertilización, antecesor…"></div>
    <div class="small muted" id="sPer"></div>
    <div class="pie">${x ? '<button class="danger ghost" id="mDel" style="margin-right:auto">Quitar</button>' : ""}<button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`, (m, close) => {
    const $ = (q) => m.querySelector(q); $("#mNo").onclick = close;
    const per = () => { $("#sPer").textContent = PERENNES.has($("#sCult").value) ? "Este cultivo se mantiene en las campañas siguientes hasta que cargues otro." : ""; };
    $("#sCult").onchange = per; per(); selectCultivo($("#sCult"), per);
    if ($("#mDel")) $("#mDel").onclick = async () => { await borrar("siembras", x.id); close(); dibujarLotes(); render(); };
    $("#mOk").onclick = async () => {
      const n = { ...(x || {}), id: x?.id || uid(), lote_id: l.id, campana: $("#sCamp").value, cultivo: $("#sCult").value, hibrido: $("#sHib").value.trim(), fecha: $("#sFec").value || null, notas: $("#sNot").value.trim(), sub_id: $("#sSub")?.value || null };
      try { await guardar("siembras", n); close(); dibujarLotes(); render(); } catch (e) { toast(e.message, 6000); }
    };
  });
}

/* ============ Panel lateral ============ */
function seleccionar(id) { S.sel = id; limpiarOverlays(); S.ndvi = { items: [], sel: null, series: {} }; restyle(); render(); const y = S.layers.get(id); if (y) map.fitBounds(y.getBounds(), { padding: [40, 40], maxZoom: 16 }); }
function render() {
  const p = document.getElementById("panel"); if (!p) return;
  if (S.sel) { const l = loteDe(S.sel); if (l) { p.innerHTML = htmlLote(l); bindLote(l); return; } }
  p.innerHTML = htmlResumen(); bindResumen();
}
function htmlResumen() {
  if (!S.d.lotes.length) return `<section class="blk"><h2>Empezá por los lotes</h2>
    <div class="empty">Todavía no hay lotes cargados.<br><br><b>Dibujar lote</b>: marcás los vértices sobre la imagen satelital.<br><b>Importar KMZ</b>: traés los contornos que tengas en Google Earth.<br><br>Si ya tenías lotes en el mapa anterior, exportalos desde ahí (Proyecto → Exportar proyecto completo) e importalos desde ☰ → Importar datos.</div></section>`;
  const tot = S.d.lotes.reduce((a, l) => a + haDe(l.geom), 0);
  const porC = {}; let doble = false;
  for (const l of S.d.lotes) {
    const units = l.subs.length ? l.subs.map((s) => ({ id: s.id, g: s.geom })) : [{ id: undefined, g: l.geom }];
    for (const u of units) { const ha = haDe(u.g); const ns = [...new Set(cultivosDe(l, u.id).map((s) => s.cultivo))]; if (ns.length > 1) doble = true; if (!ns.length) porC["Sin asignar"] = (porC["Sin asignar"] || 0) + ha; else for (const n of ns) porC[n] = (porC[n] || 0) + ha; }
  }
  const orden = Object.entries(porC).sort((a, b) => b[1] - a[1]); const maxC = Math.max(...orden.map((o) => o[1]), 1);
  const grupos = {}; for (const l of S.d.lotes) (grupos[l.campo || "Sin establecimiento"] ??= []).push(l);
  const pend = S.d.ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").length;
  return `<section class="blk"><h2>Campaña ${esc(S.campana)}</h2>
    <div class="row" style="gap:18px"><div><div class="big">${fmt(tot, 0)}</div><div class="small muted">hectáreas en ${S.d.lotes.length} lotes</div></div>
    ${pend ? `<button class="ghost" data-ir="ordenes" style="margin-left:auto"><span class="pill warn">${pend} orden${pend > 1 ? "es" : ""} abierta${pend > 1 ? "s" : ""}</span></button>` : ""}</div>
    <div class="col" style="gap:6px">${orden.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / maxC) * 100}%;background:${k === "Sin asignar" ? SIN : colorCult(k)}"></div></div><span class="num right">${fmt(v, 0)} ha</span></div>`).join("")}</div>
    ${doble ? '<div class="small muted">Los lotes con más de un cultivo en la campaña suman sus hectáreas en cada cultivo.</div>' : ""}</section>
    <section class="blk"><div class="row" style="justify-content:space-between"><h2>Lotes</h2><input id="q" placeholder="Buscar…" style="width:150px"></div>
    <div id="lista">${Object.entries(grupos).sort().map(([g, ls]) => `<div class="grp">${esc(g)} · ${fmt(ls.reduce((a, l) => a + haDe(l.geom), 0), 0)} ha</div>` + ls.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })).map((l) => { const t = textoCultivos(l); return `<div class="lote-item" data-id="${l.id}" data-n="${esc(l.nombre.toLowerCase())}" tabindex="0"><span class="sw" style="background:${colorDe(l)}"></span><span><b>${esc(l.nombre)}</b>${l.subs.length ? ` <span class="small muted">· ${l.subs.length} sectores</span>` : ""}<br><span class="small muted">${t ? esc(t) : "Sin cultivo cargado"}</span></span><span class="num small">${fmt(haDe(l.geom))} ha</span></div>`; }).join("")).join("")}</div></section>`;
}
function bindResumen() {
  document.querySelectorAll(".lote-item").forEach((el) => { el.onclick = () => seleccionar(el.dataset.id); el.onkeydown = (e) => { if (e.key === "Enter") seleccionar(el.dataset.id); }; });
  document.querySelectorAll("#panel [data-ir]").forEach((b) => (b.onclick = () => irA(b.dataset.ir)));
  const q = document.getElementById("q"); if (q) q.oninput = () => { const v = q.value.toLowerCase(); document.querySelectorAll(".lote-item").forEach((el) => (el.hidden = !el.dataset.n.includes(v))); };
}
function htmlLote(l) {
  const ha = haDe(l.geom); const s = siembraDe(l); const tc = textoCultivos(l);
  const unidades = l.subs.length ? l.subs.map((x) => x.id) : [undefined];
  const heredados = cultivosCargados(l, undefined, S.campana).length && !l.subs.length ? [] : unidades.filter((u) => !cultivosCargados(l, u, S.campana).length).map((u) => { const h = cultivoHeredado(l, u, S.campana); return h ? { ...h, sub_id: u ?? h.sub_id } : null; }).filter(Boolean);
  const sb = [...heredados, ...S.d.siembras.filter((x) => x.lote_id === l.id).sort((a, b) => b.campana.localeCompare(a.campana) || ordenSiembras(a, b))];
  const rs = S.d.rindes.filter((r) => r.lote_id === l.id).sort((a, b) => (b.campana || "").localeCompare(a.campana || ""));
  const labs = S.d.labores.filter((x) => x.lote_id === l.id && x.campana === S.campana).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  const ords = S.d.ordenes.filter((o) => o.lote_id === l.id && (o.estado === "pendiente" || o.estado === "en_curso"));
  const precios = preciosProductos(); let cIns = 0, cLab = { USD: 0, ARS: 0 }, aDef = 0, sinP = 0;
  for (const x of labs) { const c = costoLabor(x, precios); cIns += c.insumosUSD; sinP += c.insumosSinPrecio; if (c.labor != null) cLab[c.moneda] += c.labor; else if (!conPrecio(x)) aDef++; }
  const hoyS = hoy(); const hace = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  return `<section class="blk">
    <button class="ghost small" id="bBack" style="align-self:flex-start;padding:2px 6px">← Todos los lotes</button>
    <div><h3>${esc(l.nombre)}</h3><div class="muted">${esc(l.campo || "Sin establecimiento")}</div></div>
    <div class="row" style="gap:22px"><div><div class="big">${fmt(ha)}</div><div class="small muted">hectáreas</div></div>
      <div class="grow"><div style="font:700 18px var(--f-disp)">${tc ? esc(tc) : "—"}</div><div class="small muted">${s ? "campaña " + esc(S.campana) : "sin cultivo en " + esc(S.campana)}</div></div></div>
    <div class="row"><button id="bEdit">Renombrar</button><button id="bGeo">Editar contorno</button><button class="danger" id="bDel">Eliminar</button></div>
  </section>
  <section class="blk"><div class="row" style="justify-content:space-between"><h2>Labores ${esc(S.campana)}</h2><span class="row"><button id="bLab" class="primary">+ Labor</button><button id="bOrd">+ Orden</button></span></div>
    ${ords.length ? ords.map((o) => `<div class="row small"><span class="pill warn">Orden N° ${o.numero}</span> ${esc(nombreLabor(o))} · prevista ${fechaAR(o.fecha_prevista)} <button class="ghost small" data-ord="${o.id}">Ver</button></div>`).join("") : ""}
    ${labs.length ? `<div class="tablewrap"><table class="t"><tr><th>Fecha</th><th>Labor</th><th>Insumos</th><th class="right">Costo</th></tr>${labs.map((x) => { const c = costoLabor(x, precios); return `<tr class="click" data-lab="${x.id}"><td class="num">${fechaAR(x.fecha)}</td><td>${esc(nombreLabor(x))}${x.sub_id ? `<div class="small muted">${esc(subNom(l, x.sub_id))}</div>` : ""}${x.contratista ? `<div class="small muted">${esc(x.contratista)}</div>` : ""}</td><td class="small">${(x.insumos || []).map((i) => `${esc(i.nombre)} ${fmt(i.dosis, 2)} ${esc(i.unidad)}`).join("<br>") || "—"}</td><td class="right small">${c.labor != null ? fmtM(c.labor, c.moneda) : '<span class="pill warn">a definir</span>'}</td></tr>`; }).join("")}</table></div>` : `<div class="empty">Sin labores cargadas en ${esc(S.campana)}.</div>`}
    ${labs.length ? (() => {
      /* Hectáreas sembradas: los sectores (o el lote) con un cultivo en la campaña, sin contar campo natural ni barbecho */
      const unidades = l.subs.length ? l.subs.map((s) => ({ id: s.id, ha: haDe(s.geom) })) : [{ id: undefined, ha }];
      const haSemb = unidades.filter((u) => cultivosDe(l, u.id).some((c) => c.cultivo !== "Campo natural" && c.cultivo !== "Barbecho")).reduce((a, u) => a + u.ha, 0);
      const base = haSemb || ha; const total = cIns + cLab.USD;
      return `<div class="costo-lote"><span class="lbl">Gasto total ${esc(S.campana)}</span><div class="row" style="gap:16px;align-items:baseline"><b class="grande">${fmtM(total / base, "USD")}/ha</b><span class="small muted">${haSemb ? `por ha sembrada (${fmt(haSemb, 1)} ha)` : `por ha del lote (sin cultivo cargado)`}</span></div>
        <span class="small">Total <b class="num">${fmtM(total, "USD")}</b>: insumos ${fmtM(cIns, "USD")} + labores ${fmtM(cLab.USD, "USD")}${cLab.ARS ? ` · además ${fmtM(cLab.ARS, "ARS")} en labores en pesos` : ""}</span>
        ${sinP || aDef ? `<span class="small muted">No incluye ${[sinP ? sinP + " insumo" + (sinP > 1 ? "s" : "") + " sin precio" : "", aDef ? aDef + " labor" + (aDef > 1 ? "es" : "") + " con precio a definir" : ""].filter(Boolean).join(" ni ")}.</span>` : ""}</div>`;
    })() : ""}
    ${labs.length ? `<div class="stats" hidden><div><span>Insumos</span><b class="num">${fmtM(cIns, "USD")}</b>${sinP ? `<em class="small muted" style="display:block;font-style:normal">${sinP} sin precio</em>` : ""}</div><div><span>Labores</span><b class="num">${cLab.USD ? fmtM(cLab.USD, "USD") : ""}${cLab.ARS ? (cLab.USD ? "<br>" : "") + fmtM(cLab.ARS, "ARS") : ""}${!cLab.USD && !cLab.ARS ? "—" : ""}</b>${aDef ? `<em class="small muted" style="display:block;font-style:normal">${aDef} a definir</em>` : ""}</div><div><span>Insumos / ha</span><b class="num">${fmtM(cIns / ha, "USD")}</b></div></div>` : ""}
  </section>
  <section class="blk"><h2>Preguntar sobre este lote</h2>
    <div class="row"><input id="qLote" class="grow" placeholder="Ej. ¿Qué herbicidas se aplicaron en el último año?"><button id="bPreg">Preguntar</button></div>
    <div id="rLote"></div></section>
  <section class="blk"><div class="row" style="justify-content:space-between"><h2>Subdivisiones</h2><span class="row"><button id="bLinea" title="Trazá una línea que corte el lote en partes">Dividir con línea</button><button id="bSector" title="Dibujá un sector dentro del lote">Dibujar sector</button></span></div>
    ${l.subs.length ? `<table class="t"><tr><th>Sector</th><th class="right">ha</th><th>${esc(S.campana)}</th><th></th></tr>${l.subs.map((x) => `<tr><td><span class="chip"><i style="background:${colorSub(l, x)}"></i>${esc(x.nombre)}</span></td><td class="num right">${fmt(haDe(x.geom))}</td><td class="small">${esc(textoCultivos(l, x.id)) || '<span class="muted">—</span>'}</td><td style="white-space:nowrap"><button class="ghost small" data-sbn="${x.id}">Renombrar</button><button class="ghost small danger" data-sbd="${x.id}" title="Quitar sector">✕</button></td></tr>`).join("")}</table>` : `<div class="empty">Dividí el lote si tiene partes con cultivos distintos: con una línea que lo cruce, o dibujando un sector adentro (un bajo, una franja).</div>`}
  </section>
  <section class="blk"><div class="row" style="justify-content:space-between"><h2>Cultivos por campaña</h2><button id="bAddS">+ Agregar cultivo</button></div>
    ${sb.length ? `<table class="t"><tr><th>Campaña</th><th>Cultivo</th><th>Detalle</th><th></th></tr>${sb.map((x) => `<tr><td class="num">${esc(x.campana)}</td><td><span class="chip"><i style="background:${colorCult(x.cultivo)}"></i>${esc(x.cultivo)}</span>${l.subs.length ? `<div class="small muted" style="margin-top:3px">${x.sub_id ? esc(subNom(l, x.sub_id)) : "Lote completo"}</div>` : ""}</td><td class="small">${x.heredado ? `<span class="pill mut">continúa desde ${esc(x.desde_campana)}</span>` : `${esc(x.hibrido || "")}${x.fecha ? `<br><span class="muted">${fechaAR(x.fecha)}</span>` : ""}${x.notas ? `<br><span class="muted">${esc(x.notas)}</span>` : ""}`}</td><td>${x.heredado ? `<button class="ghost small" data-cambiar="${esc(x.sub_id || "")}">Cambiar</button>` : `<button class="ghost small" data-es="${x.id}">Editar</button>`}</td></tr>`).join("")}</table>` : `<div class="empty">Cargá qué tuvo sembrado este lote en cada campaña. Podés agregar varios cultivos por campaña (por ejemplo trigo y soja de 2da).</div>`}
  </section>
  <section class="blk"><div class="row" style="justify-content:space-between"><h2>Mapas de rinde</h2><button id="bAddR">+ Cargar shapefile</button></div>
    ${rs.length ? rs.map((r) => `<div style="border:1px solid var(--line);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:6px">
      <div class="row" style="justify-content:space-between"><b>${esc(r.campana)} · ${esc(r.cultivo)}</b><span class="row"><button class="small ${S.rindeVis === r.id ? "primary" : ""}" data-rv="${r.id}">${S.rindeVis === r.id ? "Ocultar" : "Ver en mapa"}</button><button class="ghost small danger" data-rd="${r.id}" title="Eliminar mapa">✕</button></span></div>
      <div class="stats"><div><span>Media</span><b class="num">${fmt(r.stats.mean, r.stats.mean < 30 ? 2 : 0)}</b> <span style="display:inline;text-transform:none">${esc(r.unidad)}</span></div><div><span>P10–P90</span><b class="num">${fmt(r.stats.p10, r.stats.mean < 30 ? 1 : 0)}–${fmt(r.stats.p90, r.stats.mean < 30 ? 1 : 0)}</b></div><div><span>CV</span><b class="num">${fmt(r.stats.cv, 0)}%</b></div></div>
      <div class="small muted">${(r.n || 0).toLocaleString("es-AR")} puntos · campo «${esc(r.campo)}» · ${esc(r.archivo || "")}</div></div>`).join("") : `<div class="empty">Subí el .zip del shapefile del monitor de cosecha, o los archivos .shp, .dbf y .prj juntos.</div>`}
  </section>
  <section class="blk"><h2>NDVI satelital · Sentinel-2</h2>
    <div class="row"><div class="field"><label class="lbl" for="nDesde">Desde</label><input type="date" id="nDesde" value="${hace}"></div><div class="field"><label class="lbl" for="nHasta">Hasta</label><input type="date" id="nHasta" value="${hoyS}"></div><div class="field"><label class="lbl" for="nNub">Nubes escena</label><select id="nNub"><option value="20">&lt; 20%</option><option value="40" selected>&lt; 40%</option><option value="70">&lt; 70%</option><option value="101">Todas</option></select></div></div>
    <div class="row"><button class="primary" id="bBuscar">Buscar imágenes</button><button id="bSerie" ${S.ndvi.items.length ? "" : "disabled"}>Calcular serie</button>${S.overlay ? '<button id="bQuitarN" class="ghost">Quitar capa</button>' : ""}</div>
    <div class="progress" id="nProg" hidden><div></div></div>
    <div id="nVisBox" class="col">${htmlVis()}</div>
    <div id="nInfo"></div><div id="nSerie"></div><div id="nDates"></div>
  </section>
  <section class="blk"><h2>Notas del lote</h2><textarea id="lNotas" placeholder="Aptitud, problemas de malezas, anegamiento, aguadas…">${esc(l.notas || "")}</textarea></section>`;
}
function bindLote(l) {
  const $ = (id) => document.getElementById(id);
  $("bBack").onclick = () => { S.sel = null; limpiarOverlays(); restyle(); render(); };
  $("bEdit").onclick = () => formLote(l);
  $("bDel").onclick = async () => {
    if (!(await confirmar(`¿Eliminar el lote <b>${esc(l.nombre)}</b> con sus cultivos y mapas de rinde? Las labores y órdenes quedan registradas sin lote.`))) return;
    try {
      for (const r of S.d.rindes.filter((r) => r.lote_id === l.id)) { await DB.borrarArchivo("rindes", r.path || r.id + ".json").catch(() => {}); await borrar("rindes", r.id); }
      for (const s of S.d.siembras.filter((s) => s.lote_id === l.id)) await borrar("siembras", s.id);
      for (const x of S.d.labores.filter((x) => x.lote_id === l.id)) { x.lote_id = null; await guardar("labores", x); }
      for (const x of S.d.ordenes.filter((x) => x.lote_id === l.id)) { x.lote_id = null; await guardar("ordenes", x); }
      await borrar("lotes", l.id); S.sel = null; limpiarOverlays(); dibujarLotes(); render(); toast("Lote eliminado");
    } catch (e) { toast(e.message, 6000); }
  };
  $("bGeo").onclick = () => editarContorno(l);
  $("bLab").onclick = () => Labores.form(null, { lote_id: l.id });
  $("bOrd").onclick = () => Ordenes.form(null, { lote_id: l.id });
  document.querySelectorAll("[data-lab]").forEach((tr) => (tr.onclick = () => Labores.form(S.d.labores.find((x) => x.id === tr.dataset.lab))));
  document.querySelectorAll("[data-ord]").forEach((b) => (b.onclick = () => Ordenes.ver(S.d.ordenes.find((x) => x.id === b.dataset.ord))));
  const preguntar = async () => {
    const q = $("qLote").value.trim(); if (!q) return; const out = $("rLote");
    out.innerHTML = '<div class="row small muted"><span class="spin"></span> Consultando…</div>';
    try { const r = await DB.ia("consulta", { pregunta: q, contexto: contextoLote(l) }); out.innerHTML = `<div class="respuesta">${esc(r.texto)}</div>`; }
    catch (e) { out.innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
  };
  $("bPreg").onclick = preguntar; $("qLote").onkeydown = (e) => { if (e.key === "Enter") preguntar(); };
  $("bAddS").onclick = () => formSiembra(l);
  document.querySelectorAll("[data-es]").forEach((b) => (b.onclick = () => formSiembra(l, b.dataset.es)));
  document.querySelectorAll("[data-cambiar]").forEach((b) => (b.onclick = () => formSiembra(l, null, { sub_id: b.dataset.cambiar || null })));
  $("bLinea").onclick = () => Dib.iniciar({ modo: "linea", titulo: "Dividir " + l.nombre, onDone: (g) => dividirConLinea(l, g) });
  $("bSector").onclick = () => Dib.iniciar({ titulo: "Sector en " + l.nombre, onDone: (g) => agregarSector(l, g) });
  document.querySelectorAll("[data-sbn]").forEach((b) => (b.onclick = () => formSub(l, l.subs.find((x) => x.id === b.dataset.sbn))));
  document.querySelectorAll("[data-sbd]").forEach((b) => (b.onclick = () => borrarSub(l, l.subs.find((x) => x.id === b.dataset.sbd))));
  $("bAddR").onclick = () => { S.rindeLote = l; document.getElementById("fRinde").click(); };
  document.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => toggleRinde(b.dataset.rv)));
  document.querySelectorAll("[data-rd]").forEach((b) => (b.onclick = async () => {
    const r = S.d.rindes.find((x) => x.id === b.dataset.rd);
    if (await confirmar(`¿Eliminar el mapa de rinde ${esc(r.campana)} · ${esc(r.cultivo)}?`)) { await DB.borrarArchivo("rindes", r.path || r.id + ".json").catch(() => {}); await borrar("rindes", r.id); if (S.rindeVis === r.id) limpiarOverlays(); render(); }
  }));
  let tN; $("lNotas").oninput = (e) => { clearTimeout(tN); tN = setTimeout(async () => { l.notas = e.target.value; await guardarLote(l); }, 700); };
  $("bBuscar").onclick = () => buscarNDVI(l);
  $("bSerie").onclick = () => serieNDVI(l);
  if ($("bQuitarN")) $("bQuitarN").onclick = () => { limpiarOverlays(); restyle(); render(); };
  pintarFechas(l); bindVis();
}
/* Datos del lote que se mandan a la consulta */
function contextoLote(l) {
  const sub = (id) => (id ? subNom(l, id) : null);
  return {
    lote: l.nombre, establecimiento: l.campo, ha: +haDe(l.geom).toFixed(1), notas: l.notas,
    sectores: l.subs.map((s) => ({ nombre: s.nombre, ha: +haDe(s.geom).toFixed(1) })),
    cultivos: S.d.siembras.filter((s) => s.lote_id === l.id).map((s) => ({ campana: s.campana, cultivo: s.cultivo, hibrido: s.hibrido, fecha: s.fecha, sector: sub(s.sub_id), notas: s.notas })),
    labores: S.d.labores.filter((x) => x.lote_id === l.id).map((x) => ({ fecha: x.fecha, campana: x.campana, labor: nombreLabor(x), sector: sub(x.sub_id), contratista: x.contratista, ha: x.superficie_ha, costo_ha: conPrecio(x) ? x.costo_ha : "a definir", moneda: x.moneda, insumos: x.insumos, condiciones: x.condiciones, notas: x.notas })),
    ordenes_abiertas: S.d.ordenes.filter((o) => o.lote_id === l.id && (o.estado === "pendiente" || o.estado === "en_curso")).map((o) => ({ numero: o.numero, labor: nombreLabor(o), fecha_prevista: o.fecha_prevista, insumos: o.insumos })),
    rindes: S.d.rindes.filter((r) => r.lote_id === l.id).map((r) => ({ campana: r.campana, cultivo: r.cultivo, unidad: r.unidad, media: r.stats?.mean, p10: r.stats?.p10, p90: r.stats?.p90, cv: r.stats?.cv })),
  };
}

/* ============ Mapas de rinde ============ */
function pip(x,y,rings){let ins=false;for(const ring of rings){for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))ins=!ins}}return ins}
function polysDe(g){return g.type==="Polygon"?[g.coordinates]:g.coordinates}
function dentro(x,y,g){return polysDe(g).some(p=>pip(x,y,p))}
function cuantil(sorted,q){if(!sorted.length)return NaN;const i=(sorted.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo)}
function estad(vals){const s=Float64Array.from(vals).sort();const n=s.length;const mean=s.reduce((a,b)=>a+b,0)/n;const sd=Math.sqrt(s.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,n-1));
  return {n,mean,sd,cv:sd/mean*100,p10:cuantil(s,.1),p50:cuantil(s,.5),p90:cuantil(s,.9),q:[.2,.4,.6,.8].map(q=>cuantil(s,q)),min:s[0],max:s[n-1]}}

document.getElementById("fRinde").onchange=async e=>{const files=[...e.target.files];e.target.value="";const l=S.rindeLote;if(!files.length||!l)return;
  toast("Leyendo shapefile…",20000);
  try{let gj;const zip=files.find(f=>/\.zip$/i.test(f.name));
    if(zip){gj=await shp(await zip.arrayBuffer());if(Array.isArray(gj))gj=gj.sort((a,b)=>b.features.length-a.features.length)[0]}
    else{const g=ext=>files.find(f=>f.name.toLowerCase().endsWith(ext));const fs=g(".shp"),fd=g(".dbf"),fp=g(".prj"),fc=g(".cpg");
      if(!fs||!fd)throw new Error("Necesito al menos el .shp y el .dbf (mejor también el .prj).");
      gj=shp.combine([shp.parseShp(await fs.arrayBuffer(),fp?await fp.text():undefined),shp.parseDbf(await fd.arrayBuffer(),fc?await fc.arrayBuffer():undefined)])}
    const feats=gj.features.filter(f=>f.geometry);
    if(!feats.length)throw new Error("El shapefile no tiene geometrías.");
    const pts=[];for(const f of feats){const g=f.geometry;let c;
      if(g.type==="Point")c=g.coordinates;else if(g.type==="MultiPoint")c=g.coordinates[0];
      else{const ring=g.type==="Polygon"?g.coordinates[0]:g.type==="MultiPolygon"?g.coordinates[0][0]:g.coordinates;let sx=0,sy=0;for(const p of ring){sx+=p[0];sy+=p[1]}c=[sx/ring.length,sy/ring.length]}
      pts.push([c[0],c[1],f.properties||{}])}
    const muestra=pts.slice(0,300);const keys=Object.keys(muestra[0][2]);
    const num=keys.filter(k=>muestra.filter(p=>typeof p[2][k]==="number"||(p[2][k]!==""&&!isNaN(+p[2][k]))).length>muestra.length*.8);
    if(!num.length)throw new Error("No encontré columnas numéricas en la tabla del shapefile.");
    const rank=k=>(/dr|dry|seco/i.test(k)?3:0)+(/yld|yield|rind|rend|mass|masa/i.test(k)?5:0)+(/vol/i.test(k)?1:0)-(/moist|hum|speed|vel|width|ancho|elev|dist|time|head/i.test(k)?6:0);
    num.sort((a,b)=>rank(b)-rank(a));
    const [lo,la]=[pts[0][0],pts[0][1]];
    if(Math.abs(lo)>180||Math.abs(la)>90)throw new Error("Las coordenadas no están en grados. Falta el archivo .prj para reproyectar.");
    document.querySelectorAll(".toast").forEach(t=>t.remove());
    formRinde(l,pts,num,files.map(f=>f.name).find(n=>/\.(zip|shp)$/i.test(n)));
  }catch(err){console.error(err);toast("No pude leer el mapa de rinde: "+err.message,7000)}
};
function formRinde(l,pts,num,archivo){
  const s=siembraDe(l);
  const med=k=>{const v=pts.slice(0,2000).map(p=>+p[2][k]).filter(v=>v>0).sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
  modal(`<h4>Mapa de rinde · ${esc(l.nombre)}</h4><div class="muted small">${pts.length.toLocaleString("es-AR")} registros en ${esc(archivo||"")}</div>
    <div class="field"><label class="lbl" for="rCampo">Columna de rinde</label><select id="rCampo">${num.map(k=>`<option value="${esc(k)}">${esc(k)} (mediana ${fmt(med(k),2)})</option>`).join("")}</select></div>
    <div class="row"><div class="field"><label class="lbl" for="rUni">Unidad del dato</label><select id="rUni"><option value="t/ha">t/ha</option><option value="kg/ha">kg/ha</option><option value="qq/ha">qq/ha</option><option value="bu/ac">bu/ac</option></select></div>
    <div class="field"><label class="lbl" for="rMostrar">Mostrar en</label><select id="rMostrar"><option value="qq/ha">qq/ha</option><option value="t/ha">t/ha</option><option value="kg/ha">kg/ha</option></select></div></div>
    <div class="row"><div class="field"><label class="lbl" for="rCamp">Campaña</label><select id="rCamp">${campanas().map(c=>`<option ${c===S.campana?"selected":""}>${c}</option>`).join("")}</select></div>
    <div class="field" style="flex:1"><label class="lbl" for="rCult">Cultivo</label><select id="rCult">${listaCultivos().map(c=>`<option ${c===(s?.cultivo||"Maíz")?"selected":""}>${esc(c)}</option>`).join("")}</select></div></div>
    <label class="row small"><input type="checkbox" id="rClip" checked> Recortar al contorno del lote</label>
    <label class="row small"><input type="checkbox" id="rFilt" checked> Descartar ceros y valores extremos (fuera de P2–P98)</label>
    <div id="rPrev" class="small muted"></div>
    <div class="row" style="justify-content:flex-end"><button id="mNo">Cancelar</button><button class="primary" id="mOk">Guardar mapa</button></div>`,(m,close)=>{
    const $=q=>m.querySelector(q);
    const guessUnit=()=>{const v=med($("#rCampo").value);$("#rUni").value=v>1000?"kg/ha":v>25&&v<=200?(v>90?"bu/ac":"qq/ha"):"t/ha";prev()};
    const bu=()=>({"Maíz":25.4,"Sorgo":25.4,"Soja":27.2,"Soja 2da":27.2,"Trigo":27.2})[$("#rCult").value]||25.4;
    const conv=()=>{const a=$("#rUni").value,b=$("#rMostrar").value;const toKg={"t/ha":1000,"kg/ha":1,"qq/ha":100,"bu/ac":bu()/0.404686}[a];return toKg/{"t/ha":1000,"kg/ha":1,"qq/ha":100}[b]};
    const procesar=()=>{const k=$("#rCampo").value,f=conv();let arr=[];
      for(const p of pts){const v=+p[2][k];if(!isFinite(v))continue;if($("#rClip").checked&&!dentro(p[0],p[1],l.geom))continue;arr.push([+p[1].toFixed(6),+p[0].toFixed(6),v*f])}
      if($("#rFilt").checked){arr=arr.filter(a=>a[2]>0);if(arr.length>20){const s=arr.map(a=>a[2]).sort((a,b)=>a-b);const lo=cuantil(s,.02),hi=cuantil(s,.98);arr=arr.filter(a=>a[2]>=lo&&a[2]<=hi)}}
      return arr};
    const prev=()=>{const a=procesar();if(!a.length){$("#rPrev").textContent="Ningún punto cae dentro del lote. Revisá que el mapa corresponda a este lote o destildá el recorte.";return}const st=estad(a.map(x=>x[2]));$("#rPrev").innerHTML=`Quedan <b>${a.length.toLocaleString("es-AR")}</b> puntos · media <b class="num">${fmt(st.mean,st.mean<30?2:1)} ${$("#rMostrar").value}</b> · CV ${fmt(st.cv,0)}%`};
    ["#rCampo"].forEach(q=>$(q).onchange=guessUnit);["#rUni","#rMostrar","#rClip","#rFilt","#rCult"].forEach(q=>$(q).onchange=prev);guessUnit();
    $("#mNo").onclick=close;
    $("#mOk").onclick=async()=>{const a=procesar();if(!a.length){toast("No hay puntos para guardar.");return}
      const r={id:uid(),lote_id:l.id,campana:$("#rCamp").value,cultivo:$("#rCult").value,campo:$("#rCampo").value,unidad:$("#rMostrar").value,archivo,n:a.length,stats:estad(a.map(x=>x[2])),creado:new Date().toISOString()};
      try{r.path=r.id+".json";await DB.subir("rindes",r.path,new Blob([JSON.stringify(a)],{type:"application/json"}));await guardar("rindes",r);S.puntosCache[r.id]=a;close();render();toggleRinde(r.id)}catch(err){toast("No se pudo guardar: "+err.message,6000)}};
  });
}
async function toggleRinde(id){
  if(S.rindeVis===id){limpiarOverlays();restyle();render();return}
  limpiarOverlays();const r=S.d.rindes.find(x=>x.id===id);const pts=await puntosRinde(r);if(!pts){toast("No encontré los puntos de este mapa.");return}
  const q=r.stats.q;const cls=v=>v<q[0]?0:v<q[1]?1:v<q[2]?2:v<q[3]?3:4;
  rindeLayer=L.layerGroup();const step=Math.max(1,Math.ceil(pts.length/60000));
  for(let i=0;i<pts.length;i+=step){const p=pts[i];L.circleMarker([p[0],p[1]],{renderer:canvasR,radius:3,stroke:false,fillOpacity:.95,fillColor:YCOL[cls(p[2])],interactive:false}).addTo(rindeLayer)}
  rindeLayer.addTo(map);S.rindeVis=id;
  const d=r.stats.mean<30?1:0;const lim=[r.stats.min,...q,r.stats.max];
  leyenda(`<b>Rinde ${esc(r.campana)} · ${esc(r.cultivo)}</b>${YCOL.slice().reverse().map((c,i)=>{const k=4-i;return `<div class="cls"><i style="background:${c}"></i><span class="num">${fmt(lim[k],d)} – ${fmt(lim[k+1],d)} ${esc(r.unidad)}</span></div>`}).join("")}<span class="muted">Quintiles · media ${fmt(r.stats.mean,d)}</span>`);
  restyle();render();
}
function leyenda(html){const el=document.getElementById("legend");el.innerHTML=html;el.hidden=false}
function limpiarOverlays(){if(rindeLayer){map.removeLayer(rindeLayer);rindeLayer=null}if(S.overlay){map.removeLayer(S.overlay);S.overlay=null}S.rindeVis=null;if(S.ndvi){S.ndvi.sel=null;S.ndvi.cur=null}document.getElementById("legend").hidden=true}

/* ============ NDVI Sentinel-2 ============ */
function bboxDe(g){let a=[180,90,-180,-90];for(const p of polysDe(g))for(const r of p)for(const c of r){a[0]=Math.min(a[0],c[0]);a[1]=Math.min(a[1],c[1]);a[2]=Math.max(a[2],c[0]);a[3]=Math.max(a[3],c[1])}return a}
function satNom(p){return (p||"").replace(/sentinel-2([abc])/i,(m,x)=>"Sentinel-2"+x.toUpperCase())}
async function buscarNDVI(l){
  const info=document.getElementById("nInfo");const desde=document.getElementById("nDesde").value,hasta=document.getElementById("nHasta").value,nub=+document.getElementById("nNub").value;
  info.innerHTML='<span class="muted small">Buscando escenas en el catálogo de Sentinel-2…</span>';
  const bb=bboxDe(l.geom);
  let body={collections:["sentinel-2-l2a"],intersects:l.geom,datetime:`${desde}T00:00:00Z/${hasta}T23:59:59Z`,limit:100,sortby:[{field:"properties.datetime",direction:"desc"}]};
  if(nub<=100)body.query={"eo:cloud_cover":{lt:nub}};
  try{let items=[],url=STAC,method="POST",pages=0;
    while(url&&pages<6){const r=await fetch(url,method==="POST"?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
      if(!r.ok)throw new Error("El catálogo respondió "+r.status);const j=await r.json();items.push(...j.features);pages++;
      const nx=(j.links||[]).find(x=>x.rel==="next");if(!nx)break;url=nx.href;method=nx.method||"GET";if(nx.body)body={...body,...nx.body}}
    const cont=items.filter(it=>it.bbox&&it.bbox[0]<=bb[0]&&it.bbox[1]<=bb[1]&&it.bbox[2]>=bb[2]&&it.bbox[3]>=bb[3]);
    const use=cont.length?cont:items;const porDia=new Map();
    for(const it of use){const d=it.properties.datetime.slice(0,10);const prev=porDia.get(d);if(!prev||it.properties["eo:cloud_cover"]<prev.properties["eo:cloud_cover"])porDia.set(d,it)}
    S.ndvi.items=[...porDia.values()].sort((a,b)=>b.properties.datetime.localeCompare(a.properties.datetime));
    const cache=await Cache.get("ndvi:"+l.id)||{};S.ndvi.series=cache;
    info.innerHTML=S.ndvi.items.length?`<span class="small muted">${S.ndvi.items.length} fechas disponibles. Elegí una para ver el NDVI del lote.</span>`:`<span class="small">No hay imágenes con esos filtros. Probá ampliar el rango o el % de nubes.</span>`;
    document.getElementById("bSerie").disabled=!S.ndvi.items.length;pintarFechas(l);pintarSerie(l);
  }catch(err){console.error(err);info.innerHTML=`<div class="empty">No pude consultar el catálogo satelital (${esc(err.message)}). Revisá la conexión a internet.</div>`}
}
function pintarFechas(l){const el=document.getElementById("nDates");if(!el)return;if(!S.ndvi.items.length){el.innerHTML="";return}
  el.innerHTML=`<div class="dates">${S.ndvi.items.map(it=>{const d=it.properties.datetime.slice(0,10);const c=S.ndvi.series[it.id];
    return `<div class="date ${S.ndvi.sel===it.id?"on":""}" data-it="${it.id}" tabindex="0"><span class="num">${new Date(d+"T12:00").toLocaleDateString("es-AR")}</span><span class="small">${esc(satNom(it.properties.platform))} · ${fmt(it.properties["eo:cloud_cover"],0)}% nubes</span><span class="num small">${c?(c.mean!=null?"NDVI "+fmt(c.mean,2):"nublado"):""}</span></div>`}).join("")}</div>`;
  el.querySelectorAll("[data-it]").forEach(d=>{d.onclick=()=>verNDVI(l,d.dataset.it);d.onkeydown=e=>{if(e.key==="Enter")verNDVI(l,d.dataset.it)}});
}
function utmDef(epsg){const z=epsg%100;const sur=Math.floor(epsg/100)===327;return `+proj=utm +zone=${z}${sur?" +south":""} +datum=WGS84 +units=m +no_defs`}
function epsgDe(it){const p=it.properties;if(p["proj:epsg"])return p["proj:epsg"];if(p["proj:code"])return +p["proj:code"].split(":")[1];const a=it.assets.red||it.assets.B04;if(a?.["proj:epsg"])return a["proj:epsg"];if(a?.["proj:code"])return +a["proj:code"].split(":")[1];
  const z=p["mgrs:utm_zone"];if(z)return (p["mgrs:latitude_band"]<"N"?32700:32600)+z;throw new Error("La escena no informa su proyección")}
async function ventana(href,utmBB){const tiff=await GeoTIFF.fromUrl(href,{allowFullFile:false});const img=await tiff.getImage();
  const [ox,oy]=img.getOrigin(),[rx,ry]=img.getResolution();const W=img.getWidth(),H=img.getHeight();
  const x0=Math.max(0,Math.floor((utmBB[0]-ox)/rx)-1),x1=Math.min(W,Math.ceil((utmBB[2]-ox)/rx)+1),y0=Math.max(0,Math.floor((utmBB[3]-oy)/ry)-1),y1=Math.min(H,Math.ceil((utmBB[1]-oy)/ry)+1);
  if(x1<=x0||y1<=y0)throw new Error("El lote queda fuera de la escena");
  const [data]=await img.readRasters({window:[x0,y0,x1,y1],samples:[0]});return {data,ox,oy,rx,ry,x0,y0,w:x1-x0,h:y1-y0}}
/* --- Visualización NDVI: paleta, escala y clases --- */
const PALETAS={
  rdylgn:{nom:"Rojo · amarillo · verde",c:["#a50026","#d73027","#f46d43","#fdae61","#fee08b","#ffffbf","#d9ef8b","#a6d96a","#66bd63","#1a9850","#006837"]},
  espectral:{nom:"Espectral (máximo contraste)",c:["#9e0142","#d53e4f","#f46d43","#fdae61","#fee08b","#ffffbf","#e6f598","#abdda4","#66c2a5","#3288bd","#5e4fa2"]},
  agro:{nom:"Suelo a vegetación",c:["#8c510a","#bf812d","#dfc27d","#f6e8c3","#c7eae5","#80cdc1","#35978f","#01665e","#003c30"]}
};
const PAL_RGB={};for(const [k,p] of Object.entries(PALETAS))PAL_RGB[k]=p.c.map(h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)));
const NUBE=-9;
S.ndviVis={paleta:"rdylgn",escala:"auto",min:0.3,max:0.9,clases:0};
try{Object.assign(S.ndviVis,JSON.parse(localStorage.getItem("fc-ndvivis")||"{}"))}catch(e){}
function guardarVis(){try{localStorage.setItem("fc-ndvivis",JSON.stringify(S.ndviVis))}catch(e){}}
function rangoNDVI(r){const v=S.ndviVis;let lo,hi;
  if(v.escala==="auto"){lo=r.p2;hi=r.p98}else if(v.escala==="todo"){lo=0;hi=1}else{lo=+v.min;hi=+v.max}
  if(!(hi>lo)){const m=isFinite(lo)?lo:0.5;lo=m-0.05;hi=m+0.05}return [lo,hi]}
function colorT(t){const v=S.ndviVis;const st=PAL_RGB[v.paleta]||PAL_RGB.rdylgn;t=Math.max(0,Math.min(1,t));
  const n=+v.clases;if(n>1)t=n===1?0.5:Math.min(n-1,Math.floor(t*n))/(n-1);
  const x=t*(st.length-1),i=Math.min(st.length-2,Math.floor(x)),f=x-i;return [0,1,2].map(k=>Math.round(st[i][k]+(st[i+1][k]-st[i][k])*f))}
function pintarNDVI(r){const [lo,hi]=rangoNDVI(r);const cv=document.createElement("canvas");cv.width=r.W;cv.height=r.H;
  const ctx=cv.getContext("2d");const im=ctx.createImageData(r.W,r.H);const d=im.data;const raw=r.raw;
  for(let k=0;k<raw.length;k++){const v=raw[k];if(v!==v)continue;const o=k*4;
    if(v===NUBE){d[o]=215;d[o+1]=218;d[o+2]=224;d[o+3]=170;continue}
    const c=colorT((v-lo)/(hi-lo));d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255}
  ctx.putImageData(im,0,0);return cv.toDataURL("image/png")}
function gradCSS(){const v=S.ndviVis;const n=+v.clases;
  if(n>1){const p=[];for(let i=0;i<n;i++){const c=colorT(i/(n-1));const a=i/n*100,b=(i+1)/n*100;p.push(`rgb(${c}) ${a}%`,`rgb(${c}) ${b}%`)}return `linear-gradient(90deg,${p.join(",")})`}
  return `linear-gradient(90deg,${PALETAS[v.paleta].c.join(",")})`}
function leyendaNDVI(r){const [lo,hi]=rangoNDVI(r);const v=S.ndviVis;const n=+v.clases;
  const ticks=n>1?Array.from({length:n+1},(_,i)=>lo+(hi-lo)*i/n):[lo,(lo+hi)/2,hi];
  const ex=v.escala==="auto"?"Escala ajustada a esta imagen (P2–P98)":v.escala==="todo"?"Escala completa 0 a 1":"Escala fija elegida";
  leyenda(`<b>NDVI ${new Date(r.fecha+"T12:00").toLocaleDateString("es-AR")}</b><span class="muted">${esc(r.sat)} · ${ex}</span>
    <div class="ramp" style="height:12px;background:${gradCSS()}"></div>
    <div class="ends small">${(n>1&&n>6?ticks.filter((_,i)=>i%2===0||i===n):ticks).map(t=>`<span>${fmt(t,2)}</span>`).join("")}</div>
    <div class="cls"><i style="background:rgb(215,218,224)"></i><span>Nube o sombra</span></div>`)}
function aplicarVis(){if(S.overlay&&S.ndvi.cur){S.overlay.setUrl(pintarNDVI(S.ndvi.cur));leyendaNDVI(S.ndvi.cur)}}
function htmlVis(){const v=S.ndviVis;return `<div class="row" style="align-items:flex-end">
  <div class="field" style="flex:1;min-width:150px"><label class="lbl" for="vPal">Colores</label><select id="vPal">${Object.entries(PALETAS).map(([k,p])=>`<option value="${k}" ${k===v.paleta?"selected":""}>${p.nom}</option>`).join("")}</select></div>
  <div class="field"><label class="lbl" for="vCls">Tonos</label><select id="vCls">${[[0,"Continuo"],[5,"5 clases"],[7,"7 clases"],[10,"10 clases"]].map(([k,t])=>`<option value="${k}" ${+v.clases===k?"selected":""}>${t}</option>`).join("")}</select></div></div>
  <div class="row" style="align-items:flex-end">
  <div class="field" style="flex:1;min-width:150px"><label class="lbl" for="vEsc">Escala</label><select id="vEsc"><option value="auto" ${v.escala==="auto"?"selected":""}>Ajustada a la imagen</option><option value="fija" ${v.escala==="fija"?"selected":""}>Fija (para comparar fechas)</option><option value="todo" ${v.escala==="todo"?"selected":""}>Completa 0 a 1</option></select></div>
  <div class="field" ${v.escala==="fija"?"":"hidden"} id="vRng"><label class="lbl" for="vMin">Rango</label><span class="row" style="gap:4px"><input type="number" id="vMin" step="0.05" min="-1" max="1" value="${v.min}" style="width:70px"> a <input type="number" id="vMax" step="0.05" min="-1" max="1" value="${v.max}" style="width:70px"></span></div></div>`}
function bindVis(){const $=id=>document.getElementById(id);if(!$("vPal"))return;const v=S.ndviVis;
  const ch=()=>{v.paleta=$("vPal").value;v.clases=+$("vCls").value;v.escala=$("vEsc").value;v.min=+$("vMin").value;v.max=+$("vMax").value;
    if(v.escala==="fija"&&S.ndvi.cur&&$("vRng").hidden){const [lo,hi]=[S.ndvi.cur.p2,S.ndvi.cur.p98];v.min=Math.floor(lo*20)/20;v.max=Math.ceil(hi*20)/20;$("vMin").value=v.min;$("vMax").value=v.max}
    $("vRng").hidden=v.escala!=="fija";guardarVis();aplicarVis()};
  ["vPal","vCls","vEsc"].forEach(i=>$(i).onchange=ch);["vMin","vMax"].forEach(i=>$(i).oninput=ch)}
function histNDVI(r){const [lo,hi]=rangoNDVI(r);const B=30;const h=new Array(B).fill(0);let n=0;
  const a=Math.min(lo,r.p2)-0.02,b=Math.max(hi,r.p98)+0.02;
  for(const v of r.raw){if(v!==v||v===NUBE)continue;const k=Math.floor((v-a)/(b-a)*B);if(k>=0&&k<B){h[k]++;n++}}
  if(!n)return "";const mx=Math.max(...h);const Wd=360,Hd=70,ml=4,mb=16;const bw=(Wd-ml*2)/B;
  return `<svg class="ts" viewBox="0 0 ${Wd} ${Hd}" width="100%" role="img" aria-label="Distribución de valores de NDVI en el lote">
    ${h.map((c,i)=>{const v=a+(b-a)*(i+.5)/B;const col=colorT((v-lo)/(hi-lo));const bh=c/mx*(Hd-mb-4);return `<rect x="${(ml+i*bw).toFixed(1)}" y="${(Hd-mb-bh).toFixed(1)}" width="${(bw-1).toFixed(1)}" height="${bh.toFixed(1)}" fill="rgb(${col})"/>`}).join("")}
    <line x1="${ml}" x2="${Wd-ml}" y1="${Hd-mb}" y2="${Hd-mb}" stroke="var(--line)"/>
    ${[a,(a+b)/2,b].map((v,i)=>`<text x="${i===0?ml:i===2?Wd-ml:Wd/2}" y="${Hd-3}" text-anchor="${i===0?"start":i===2?"end":"middle"}">${fmt(v,2)}</text>`).join("")}
  </svg><div class="small muted">Distribución de píxeles del lote. Los colores siguen la escala elegida.</div>`}

async function calcNDVI(l,it){
  const epsg=epsgDe(it);const P=proj4("EPSG:4326",utmDef(epsg));
  const bb=bboxDe(l.geom);const cs=[[bb[0],bb[1]],[bb[2],bb[1]],[bb[2],bb[3]],[bb[0],bb[3]]].map(c=>P.forward(c));
  const ubb=[Math.min(...cs.map(c=>c[0])),Math.min(...cs.map(c=>c[1])),Math.max(...cs.map(c=>c[0])),Math.max(...cs.map(c=>c[1]))];
  const A=it.assets;const red=A.red||A.B04,nir=A.nir||A.B08,scl=A.scl||A.SCL;if(!red||!nir)throw new Error("La escena no trae las bandas roja e infrarroja");
  const [R,N,C]=await Promise.all([ventana(red.href,ubb),ventana(nir.href,ubb),scl?ventana(scl.href,ubb).catch(()=>null):null]);
  const band=a=>a?.["raster:bands"]?.[0]||{};const bl=parseFloat(it.properties["s2:processing_baseline"]||"0");
  const offApplied=it.properties["earthsearch:boa_offset_applied"]===true;
  const sc=b=>band(b).scale??0.0001,of=b=>band(b).offset??(!offApplied&&bl>=4?-0.1:0);
  const sR=sc(red),oR=of(red),sN=sc(nir),oN=of(nir);
  const lat0=(bb[1]+bb[3])/2;const dLat=10/111320,dLon=10/(111320*Math.cos(lat0*Math.PI/180));
  const W=Math.max(1,Math.ceil((bb[2]-bb[0])/dLon)),H=Math.max(1,Math.ceil((bb[3]-bb[1])/dLat));
  const raw=new Float32Array(W*H).fill(NaN);const vals=[];let tot=0,nubes=0;const BAD=new Set([0,1,3,8,9,10,11]);
  for(let j=0;j<H;j++){const lat=bb[3]-(j+.5)*dLat;for(let i=0;i<W;i++){const lon=bb[0]+(i+.5)*dLon;if(!dentro(lon,lat,l.geom))continue;tot++;
    const [E,Nn]=P.forward([lon,lat]);const k=j*W+i;
    if(C){const cx=Math.floor((E-C.ox)/C.rx)-C.x0,cy=Math.floor((Nn-C.oy)/C.ry)-C.y0;const s=(cx>=0&&cy>=0&&cx<C.w&&cy<C.h)?C.data[cy*C.w+cx]:0;if(BAD.has(s)){nubes++;raw[k]=NUBE;continue}}
    const px=Math.floor((E-R.ox)/R.rx)-R.x0,py=Math.floor((Nn-R.oy)/R.ry)-R.y0;if(px<0||py<0||px>=R.w||py>=R.h)continue;
    const dr=R.data[py*R.w+px],dn=N.data[py*N.w+px];if(!dr||!dn)continue;
    const r=dr*sR+oR,n=dn*sN+oN;if(n+r<=0)continue;const v=(n-r)/(n+r);raw[k]=v;vals.push(v)}}
  const res={fecha:it.properties.datetime.slice(0,10),sat:satNom(it.properties.platform),W,H,raw,valido:tot?vals.length/tot*100:0,nubes:tot?nubes/tot*100:0,bounds:[[bb[3]-H*dLat,bb[0]],[bb[3],bb[0]+W*dLon]]};
  if(vals.length>tot*.25){const s=Float32Array.from(vals).sort();res.mean=vals.reduce((a,b)=>a+b,0)/vals.length;res.p2=cuantil(s,.02);res.p10=cuantil(s,.1);res.p50=cuantil(s,.5);res.p90=cuantil(s,.9);res.p98=cuantil(s,.98)}
  else{res.mean=null;if(vals.length){const s=Float32Array.from(vals).sort();res.p2=cuantil(s,.02);res.p98=cuantil(s,.98)}}
  return res;
}
async function obtenerNDVI(l,it,conRaw){const c=S.ndvi.series[it.id];if(c&&c.W&&(!conRaw||c.raw))return c;
  const r=await calcNDVI(l,it);const cache=await Cache.get("ndvi:"+l.id)||{};
  for(const k of Object.keys(cache)){if(cache[k].img!==undefined)delete cache[k].img;if(!cache[k].W)delete cache[k]}
  cache[it.id]=conRaw?r:{...r,raw:null};
  const conDatos=Object.keys(cache).filter(k=>k!==it.id&&cache[k].raw);if(conDatos.length>15)for(const k of conDatos.slice(0,conDatos.length-15))cache[k].raw=null;
  await Cache.set("ndvi:"+l.id,cache);S.ndvi.series=cache;return r}
async function verNDVI(l,id){const it=S.ndvi.items.find(x=>x.id===id);if(!it)return;const info=document.getElementById("nInfo");
  info.innerHTML='<span class="small muted">Descargando bandas y calculando NDVI del lote…</span>';
  try{let r=S.ndvi.series[id];if(!r||!r.raw||!r.W)r=await obtenerNDVI(l,it,true);
    limpiarOverlays();S.ndvi.sel=id;S.ndvi.cur=r;
    S.overlay=L.imageOverlay(pintarNDVI(r),r.bounds,{opacity:1,interactive:false,className:"ndvi-img"}).addTo(map);restyle();
    const y=S.layers.get(l.id);if(y)y.bringToFront();
    leyendaNDVI(r);render();
    document.getElementById("nInfo").innerHTML=`<div class="stats"><div><span>NDVI medio</span><b class="num">${fmt(r.mean,2)}</b></div><div><span>P10–P90</span><b class="num">${fmt(r.p10,2)}–${fmt(r.p90,2)}</b></div><div><span>Nubes lote</span><b class="num">${fmt(r.nubes,0)}%</b></div></div>${histNDVI(r)}`;
    pintarSerie(l);
  }catch(err){console.error(err);info.innerHTML=`<div class="empty">No pude calcular el NDVI de esa fecha (${esc(err.message)}).</div>`}}
async function serieNDVI(l){const prog=document.getElementById("nProg");prog.hidden=false;const bar=prog.firstElementChild;const items=S.ndvi.items;let k=0,fall=0;
  document.getElementById("bSerie").disabled=true;
  for(const it of items){try{await obtenerNDVI(l,it,false)}catch(e){fall++;console.warn(e)}k++;bar.style.width=(k/items.length*100)+"%";if(k%3===0){pintarFechas(l);pintarSerie(l)}}
  prog.hidden=true;document.getElementById("bSerie").disabled=false;pintarFechas(l);pintarSerie(l);if(fall)toast(`${fall} fecha${fall>1?"s":""} no se pudieron leer.`)}
function pintarSerie(l){const el=document.getElementById("nSerie");if(!el)return;
  const pts=S.ndvi.items.map(it=>({it,r:S.ndvi.series[it.id]})).filter(x=>x.r&&x.r.mean!=null).map(x=>({id:x.it.id,t:new Date(x.r.fecha+"T12:00").getTime(),v:x.r.mean,f:x.r.fecha})).sort((a,b)=>a.t-b.t);
  if(pts.length<2){el.innerHTML="";return}
  const Wd=360,Hd=150,m={l:30,r:8,t:10,b:22};const t0=pts[0].t,t1=pts[pts.length-1].t;const X=t=>m.l+(t-t0)/(t1-t0||1)*(Wd-m.l-m.r),Y=v=>m.t+(1-v)*(Hd-m.t-m.b);
  const meses=[];const d=new Date(t0);d.setDate(1);d.setMonth(d.getMonth()+1);while(d.getTime()<=t1){meses.push(new Date(d));d.setMonth(d.getMonth()+(t1-t0>200*864e5?2:1))}
  const path=pts.map((p,i)=>(i?"L":"M")+X(p.t).toFixed(1)+","+Y(p.v).toFixed(1)).join("");
  const area=path+`L${X(t1).toFixed(1)},${Y(0)}L${X(t0).toFixed(1)},${Y(0)}Z`;
  el.innerHTML=`<svg class="ts" viewBox="0 0 ${Wd} ${Hd}" width="100%" role="img" aria-label="Serie de NDVI medio del lote">
    ${[0,.25,.5,.75,1].map(v=>`<line x1="${m.l}" x2="${Wd-m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${m.l-4}" y="${Y(v)+3}" text-anchor="end">${String(v).replace(".",",")}</text>`).join("")}
    ${meses.map(mm=>`<text x="${X(mm.getTime())}" y="${Hd-6}" text-anchor="middle">${mm.toLocaleDateString("es-AR",{month:"short"}).replace(".","")}${mm.getMonth()===0?" "+String(mm.getFullYear()).slice(2):""}</text>`).join("")}
    <path d="${area}" fill="#31a354" fill-opacity=".15"/><path d="${path}" fill="none" stroke="#2F7A3E" stroke-width="2"/>
    ${pts.map(p=>`<circle cx="${X(p.t)}" cy="${Y(p.v)}" r="${S.ndvi.sel===p.id?5:3.2}" fill="${S.ndvi.sel===p.id?"#F2C14E":"#2F7A3E"}" stroke="var(--panel)" stroke-width="1" data-pid="${p.id}" style="cursor:pointer"><title>${new Date(p.f+"T12:00").toLocaleDateString("es-AR")}: ${fmt(p.v,2)}</title></circle>`).join("")}
  </svg><div class="small muted">NDVI medio del lote por fecha (sin píxeles nublados). Clic en un punto para verlo en el mapa.</div>`;
  el.querySelectorAll("[data-pid]").forEach(c=>c.onclick=()=>verNDVI(l,c.dataset.pid));
}


const Mapa = { init: iniciarMapa, redibujar: dibujarLotes, encuadrar, render, get map() { return map; } };
