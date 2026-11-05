"use strict";
/* ============ Imagen aérea de un lote con sus vecinos, para órdenes de trabajo ============ */
const Imagen = {
  TS: 256,
  fuentes: [
    ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Imagen © Esri, Maxar", 18],
    ["https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Imagen © Esri Clarity", 18],
    ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg", "Sentinel-2 cloudless © EOX", 15],
  ],
  px(lon, z) { return ((lon + 180) / 360) * this.TS * 2 ** z; },
  py(lat, z) { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * this.TS * 2 ** z; },
  cargar(url) {
    return new Promise((res) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      const t = setTimeout(() => res(null), 9000);
      im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); };
      im.src = url;
    });
  },
  /* Dibuja el fondo satelital. Devuelve la atribución, o null si no se pudo. */
  async fondo(ctx, z, ox, oy, W, H) {
    /* z puede ser fraccionario: se usan las teselas del zoom entero más cercano, escaladas */
    for (const [plantilla, atrib, zmax] of this.fuentes) {
      const zt = Math.min(Math.round(z), zmax), ts = this.TS * 2 ** (z - zt);
      const x0 = Math.floor(ox / ts), x1 = Math.floor((ox + W) / ts), y0 = Math.floor(oy / ts), y1 = Math.floor((oy + H) / ts);
      const pedidos = [];
      for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) pedidos.push(this.cargar(plantilla.replace("{z}", zt).replace("{x}", tx).replace("{y}", ty) + "?img=1").then((im) => ({ im, tx, ty })));
      const r = await Promise.all(pedidos);
      if (r.filter((x) => x.im).length < r.length * 0.6) continue;
      for (const { im, tx, ty } of r) if (im) ctx.drawImage(im, Math.floor(tx * ts - ox), Math.floor(ty * ts - oy), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      try { ctx.getImageData(0, 0, 1, 1); return atrib; } catch (e) { ctx.clearRect(0, 0, W, H); return null; }
    }
    return null;
  },
  trazar(ctx, geom, z, ox, oy) {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    ctx.beginPath();
    for (const p of polys) for (const ring of p) ring.forEach(([lon, lat], i) => { const X = this.px(lon, z) - ox, Y = this.py(lat, z) - oy; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }), ctx.closePath();
  },
  etiqueta(ctx, txt, X, Y, tam = 15, peso = 700, color = "#fff") {
    ctx.font = `${peso} ${tam}px Archivo, "Arial Narrow", Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, tam / 4); ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.lineJoin = "round"; ctx.strokeText(txt, X, Y);
    ctx.fillStyle = color; ctx.fillText(txt, X, Y);
  },
  /* Genera la imagen (Blob JPEG) de una orden: el lote resaltado, los lotes vecinos, molinos, mangas y caminos */
  async deOrden(o) {
    const l = loteDe(o.lote_id); if (!l) throw new Error("La orden no tiene lote.");
    const sub = subDe(l, o.sub_id);
    const W = 1280, H = 960, BANDA = 92, Hm = H - BANDA;
    /* Se muestra todo el sector del campo (Santa Clara Sur, Santa Clara Norte, Flores Chicas…) con el lote marcado.
       Si el lote no tiene establecimiento cargado, se muestra el lote con sus vecinos. */
    const delSector = l.campo ? S.d.lotes.filter((v) => v.campo === l.campo) : [];
    const porSector = delSector.length > 1;
    const bl = turf.bbox({ type: "Feature", geometry: l.geom });
    const bb = porSector ? turf.bbox({ type: "FeatureCollection", features: delSector.map((v) => ({ type: "Feature", properties: {}, geometry: v.geom })) }) : bl;
    const sx0 = this.px(bb[2], 0) - this.px(bb[0], 0), sy0 = this.py(bb[1], 0) - this.py(bb[3], 0);
    let z = Math.log2(porSector ? Math.min((W * 0.9) / sx0, (Hm * 0.86) / sy0) : Math.min((W * 0.4) / sx0, (Hm * 0.4) / sy0));
    z = Math.max(10, Math.min(17.5, z));
    const cx = (this.px(bb[0], z) + this.px(bb[2], z)) / 2, cy = (this.py(bb[1], z) + this.py(bb[3], z)) / 2;
    const ox = cx - W / 2, oy = cy - Hm / 2;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    ctx.fillStyle = "#2a3328"; ctx.fillRect(0, 0, W, H);
    const atrib = await this.fondo(ctx, z, ox, oy, W, Hm);
    if (!atrib) { ctx.fillStyle = "#2a3328"; ctx.fillRect(0, 0, W, Hm); }
    /* Lotes vecinos */
    const dentro = (g) => { const b = turf.bbox({ type: "Feature", geometry: g }); return this.px(b[2], z) - ox > 0 && this.px(b[0], z) - ox < W && this.py(b[1], z) - oy > 0 && this.py(b[3], z) - oy < Hm; };
    const vecinos = S.d.lotes.filter((v) => v.id !== l.id && dentro(v.geom));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, Hm); ctx.clip();
    for (const v of vecinos) { const propio = !porSector || v.campo === l.campo; this.trazar(ctx, v.geom, z, ox, oy); ctx.fillStyle = propio ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.18)"; ctx.fill("evenodd"); ctx.lineWidth = propio ? 2 : 1; ctx.strokeStyle = propio ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.45)"; ctx.stroke(); }
    /* Lote de la orden (y el sector si corresponde) */
    this.trazar(ctx, l.geom, z, ox, oy);
    ctx.fillStyle = sub ? "rgba(242,193,78,.10)" : "rgba(242,193,78,.28)"; ctx.fill("evenodd");
    ctx.lineWidth = 7; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = "#F2C14E"; ctx.stroke();
    if (sub) { this.trazar(ctx, sub.geom, z, ox, oy); ctx.fillStyle = "rgba(242,193,78,.38)"; ctx.fill("evenodd"); ctx.setLineDash([12, 8]); ctx.lineWidth = 3; ctx.strokeStyle = "#FFF3C4"; ctx.stroke(); ctx.setLineDash([]); }
    /* Caminos y puntos */
    for (const x of S.d.infra.filter((x) => x.geom?.type === "LineString")) {
      const d = INFRA[x.tipo]; if (!d) continue;
      ctx.beginPath(); x.geom.coordinates.forEach(([lon, lat], i) => { const X = this.px(lon, z) - ox, Y = this.py(lat, z) - oy; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash([]); ctx.lineWidth = d.peso + 4; ctx.strokeStyle = "rgba(58,47,29,.9)"; ctx.stroke();
      ctx.setLineDash(d.dash || []); ctx.lineWidth = d.peso + 1; ctx.strokeStyle = d.color; ctx.stroke(); ctx.setLineDash([]);
    }
    for (const x of S.d.infra.filter((x) => x.geom?.type === "Point")) {
      const d = INFRA[x.tipo]; if (!d) continue;
      const X = this.px(x.geom.coordinates[0], z) - ox, Y = this.py(x.geom.coordinates[1], z) - oy; if (X < -20 || Y < -20 || X > W + 20 || Y > Hm + 20) continue;
      ctx.beginPath(); ctx.arc(X, Y, 13, 0, Math.PI * 2); ctx.fillStyle = d.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.font = `800 ${d.letra.length > 1 ? 11 : 13}px Archivo, Arial, sans-serif`; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(d.letra, X, Y + 1);
      if (x.nombre) this.etiqueta(ctx, x.nombre, X, Y + 25, 13, 600);
    }
    /* Nombres de los lotes */
    const centro = (g) => { const p = turf.pointOnFeature({ type: "Feature", geometry: g }).geometry.coordinates; return [this.px(p[0], z) - ox, this.py(p[1], z) - oy]; };
    const tamV = porSector && delSector.length > 25 ? 12 : porSector && delSector.length > 12 ? 13 : 16;
    for (const v of vecinos) { const propio = !porSector || v.campo === l.campo; const [X, Y] = centro(v.geom); if (X > 30 && X < W - 30 && Y > 15 && Y < Hm - 15) this.etiqueta(ctx, v.nombre, X, Y, propio ? tamV : tamV - 2, propio ? 700 : 500, propio ? "#ffffff" : "rgba(255,255,255,.7)"); }
    if (sub) { const [X, Y] = centro(sub.geom); this.etiqueta(ctx, sub.nombre, X, Y + 28, 18, 700, "#FFF3C4"); }
    const [LX, LY] = centro(l.geom);
    const anchoLote = this.px(bl[2], z) - this.px(bl[0], z);
    if (anchoLote < 70) { ctx.beginPath(); ctx.arc(LX, LY, 26, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = "#F2C14E"; ctx.stroke(); }
    this.etiqueta(ctx, l.nombre.toUpperCase(), LX, anchoLote < 70 ? LY - 40 : LY, porSector ? 24 : 30, 800, "#F2C14E");
    if (porSector) { ctx.font = "800 22px Archivo, Arial, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.lineJoin = "round"; ctx.strokeText(l.campo.toUpperCase(), 22, 34); ctx.fillStyle = "#fff"; ctx.fillText(l.campo.toUpperCase(), 22, 34); }
    ctx.restore();
    /* Norte y escala */
    ctx.save(); ctx.translate(W - 46, 52);
    ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(12, 10); ctx.lineTo(0, 4); ctx.lineTo(-12, 10); ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.stroke();
    this.etiqueta(ctx, "N", 0, 26, 16, 800); ctx.restore();
    const lat = (bb[1] + bb[3]) / 2; const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const largo = [100, 200, 250, 500, 1000, 2000, 5000].find((m) => m / mpp >= 110) || 5000; const lp = largo / mpp;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(18, Hm - 44, lp + 24, 30);
    ctx.fillStyle = "#fff"; ctx.fillRect(30, Hm - 24, lp, 5); ctx.fillRect(30, Hm - 30, 2, 11); ctx.fillRect(30 + lp - 2, Hm - 30, 2, 11);
    ctx.font = "600 13px 'IBM Plex Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText(largo >= 1000 ? largo / 1000 + " km" : largo + " m", 30 + lp / 2, Hm - 30);
    /* Banda con los datos de la orden */
    ctx.fillStyle = "#1F2A22"; ctx.fillRect(0, Hm, W, BANDA); ctx.fillStyle = "#F2C14E"; ctx.fillRect(0, Hm, W, 4);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#fff";
    ctx.font = "800 26px Archivo, Arial, sans-serif"; ctx.fillText(`Orden N° ${o.numero} · ${nombreLabor(o)}`, 24, Hm + 40);
    ctx.font = "500 19px 'Source Sans 3', Arial, sans-serif"; ctx.fillStyle = "#E4E9DF";
    ctx.fillText(`${nombreUbic(o.lote_id, o.sub_id)}${l.campo ? " (" + l.campo + ")" : ""} · ${fmt(o.superficie_ha, 1)} ha${o.fecha_prevista ? " · prevista " + fechaAR(o.fecha_prevista) : ""}${o.contratista ? " · " + o.contratista : ""}`, 24, Hm + 72);
    ctx.textAlign = "right"; ctx.font = "500 12px 'Source Sans 3', Arial, sans-serif"; ctx.fillStyle = "#9AA89D"; ctx.fillText(`Flores Chicas${atrib ? " · " + atrib : " · sin imagen satelital"}`, W - 18, Hm + 82);
    const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.88));
    return { blob, conFondo: !!atrib };
  },
};
