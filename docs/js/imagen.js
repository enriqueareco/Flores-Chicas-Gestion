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
    const subs = subsDe(l, o.sub_id); const sub = subs.length ? subs : null;
    const W = 1280, H = 960, BANDA = 92, Hm = H - BANDA;
    /* Se muestra todo el sector del campo (Santa Clara Sur, Santa Clara Norte, Flores Chicas…) con el lote marcado.
       Si el lote no tiene establecimiento cargado, se muestra el lote con sus vecinos. */
    const sector = sectorDe(l);
    const delSector = sector ? S.d.lotes.filter((v) => sectorDe(v) === sector) : [];
    const porSector = delSector.length > 1;
    const bl = turf.bbox({ type: "Feature", geometry: l.geom });
    const bb = porSector ? turf.bbox({ type: "FeatureCollection", features: delSector.map((v) => ({ type: "Feature", properties: {}, geometry: v.geom })) }) : bl;
    const sx0 = this.px(bb[2], 0) - this.px(bb[0], 0), sy0 = this.py(bb[1], 0) - this.py(bb[3], 0);
    let z = Math.log2(porSector ? Math.min((W * 0.9) / sx0, (Hm * 0.86) / sy0) : Math.min((W * 0.4) / sx0, (Hm * 0.4) / sy0));
    if (porSector) z += 0.7; /* más cerca que el sector completo */
    z = Math.max(10, Math.min(17.5, z));
    let cx = (this.px(bb[0], z) + this.px(bb[2], z)) / 2, cy = (this.py(bb[1], z) + this.py(bb[3], z)) / 2;
    if (porSector) {
      /* Se corre el centro hacia el lote para que quede bien adentro de la foto */
      const lx0 = this.px(bl[0], z), lx1 = this.px(bl[2], z), ly0 = this.py(bl[3], z), ly1 = this.py(bl[1], z);
      cx = cx * 0.45 + ((lx0 + lx1) / 2) * 0.55; cy = cy * 0.45 + ((ly0 + ly1) / 2) * 0.55;
      const mx = W * 0.18, my = Hm * 0.18;
      if (lx0 - (cx - W / 2) < mx) cx = lx0 - mx + W / 2; if ((cx + W / 2) - lx1 < mx) cx = lx1 + mx - W / 2;
      if (ly0 - (cy - Hm / 2) < my) cy = ly0 - my + Hm / 2; if ((cy + Hm / 2) - ly1 < my) cy = ly1 + my - Hm / 2;
    }
    const ox = cx - W / 2, oy = cy - Hm / 2;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    ctx.fillStyle = "#2a3328"; ctx.fillRect(0, 0, W, H);
    const atrib = await this.fondo(ctx, z, ox, oy, W, Hm);
    if (!atrib) { ctx.fillStyle = "#2a3328"; ctx.fillRect(0, 0, W, Hm); }
    /* Lotes vecinos */
    const dentro = (g) => { const b = turf.bbox({ type: "Feature", geometry: g }); return this.px(b[2], z) - ox > 0 && this.px(b[0], z) - ox < W && this.py(b[1], z) - oy > 0 && this.py(b[3], z) - oy < Hm; };
    const vecinos = S.d.lotes.filter((v) => v.id !== l.id && dentro(v.geom));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, Hm); ctx.clip();
    for (const v of vecinos) { const propio = !porSector || sectorDe(v) === sector; this.trazar(ctx, v.geom, z, ox, oy); ctx.fillStyle = propio ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.18)"; ctx.fill("evenodd"); ctx.lineWidth = propio ? 2 : 1; ctx.strokeStyle = propio ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.45)"; ctx.stroke(); }
    /* Lote de la orden (y el sector si corresponde) */
    this.trazar(ctx, l.geom, z, ox, oy);
    ctx.fillStyle = sub ? "rgba(242,193,78,.14)" : porSector ? "rgba(242,193,78,.45)" : "rgba(242,193,78,.28)"; ctx.fill("evenodd");
    ctx.lineWidth = porSector ? 10 : 7; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.stroke(); ctx.lineWidth = porSector ? 6 : 4; ctx.strokeStyle = "#F2C14E"; ctx.stroke();
    for (const s of sub || []) { this.trazar(ctx, s.geom, z, ox, oy); ctx.fillStyle = "rgba(255,196,0,.62)"; ctx.fill("evenodd"); ctx.lineJoin = "round"; ctx.lineWidth = 9; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.stroke(); ctx.lineWidth = 5; ctx.strokeStyle = "#FFD23F"; ctx.stroke(); }
    if (sub) { const otros = l.subs.filter((s) => !sub.includes(s)); for (const s of otros) { this.trazar(ctx, s.geom, z, ox, oy); ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fill("evenodd"); ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.stroke(); ctx.setLineDash([]); } }
    /* Caminos y puntos */
    for (const x of S.d.infra.filter((x) => x.geom?.type === "LineString")) {
      const d = INFRA[x.tipo]; if (!d) continue;
      ctx.beginPath(); x.geom.coordinates.forEach(([lon, lat], i) => { const X = this.px(lon, z) - ox, Y = this.py(lat, z) - oy; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      const principal = x.tipo === "camino_principal";
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash([]); ctx.lineWidth = principal ? 15 : 11; ctx.strokeStyle = "rgba(20,14,6,.9)"; ctx.stroke();
      ctx.setLineDash(principal ? [] : [20, 13]); ctx.lineWidth = principal ? 9 : 6; ctx.strokeStyle = principal ? "#FFE08A" : "#FFF6DA"; ctx.stroke(); ctx.setLineDash([]);
    }
    const ordenPunto = { molino: 9, manga: 5 };
    for (const x of S.d.infra.filter((x) => x.geom?.type === "Point").sort((a, b) => (ordenPunto[a.tipo] || 0) - (ordenPunto[b.tipo] || 0))) {
      const d = INFRA[x.tipo]; if (!d) continue;
      const X = this.px(x.geom.coordinates[0], z) - ox, Y = this.py(x.geom.coordinates[1], z) - oy; if (X < -20 || Y < -20 || X > W + 20 || Y > Hm + 20) continue;
      ctx.beginPath(); ctx.arc(X, Y, 21, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, 17, 0, Math.PI * 2); ctx.fillStyle = d.color; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.font = `800 ${d.letra.length > 1 ? 14 : 17}px Archivo, Arial, sans-serif`; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(d.letra, X, Y + 1);
      if (x.nombre && !/^(Molino|Manga|Bebida|Tranquera|Casa)[^ ]* \d+$/i.test(x.nombre)) this.etiqueta(ctx, x.nombre, X, Y + 32, 15, 700);
    }
    /* Nombres de los lotes */
    const centro = (g) => { const p = turf.pointOnFeature({ type: "Feature", geometry: g }).geometry.coordinates; return [this.px(p[0], z) - ox, this.py(p[1], z) - oy]; };
    /* En la foto del sector, el nombre del lote va sin el nombre del sector ("12 Santa Clara Sur" → "12") */
    const corto = (v) => { const n = v.nombre.trim(); return porSector && sector && norm(n).endsWith(norm(sector)) ? n.slice(0, n.length - sector.length).trim() || n : n; };
    const tamV = porSector && delSector.length > 25 ? 12 : porSector && delSector.length > 12 ? 13 : 16;
    for (const v of vecinos) { const propio = !porSector || sectorDe(v) === sector; const [X, Y] = centro(v.geom); if (X > 30 && X < W - 30 && Y > 15 && Y < Hm - 15) this.etiqueta(ctx, corto(v), X, Y, propio ? tamV : tamV - 2, propio ? 700 : 500, propio ? "#ffffff" : "rgba(255,255,255,.7)"); }
    for (const s of sub || []) { const [X, Y] = centro(s.geom); this.etiqueta(ctx, s.nombre, X, Y + 30, 20, 800, "#FFFFFF"); }
    const [LX, LY] = centro(l.geom);
    const anchoLote = this.px(bl[2], z) - this.px(bl[0], z);
    /* Si el lote se ve chico dentro del sector, un anillo alrededor para encontrarlo enseguida */
    const chico = anchoLote < 140; const radio = Math.max(34, anchoLote * 0.75);
    if (chico) { ctx.beginPath(); ctx.arc(LX, LY, radio, 0, Math.PI * 2); ctx.lineWidth = 9; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.stroke(); ctx.lineWidth = 5; ctx.strokeStyle = "#F2C14E"; ctx.stroke(); }
    this.etiqueta(ctx, corto(l).toUpperCase(), LX, chico ? LY - radio - 18 : LY, porSector ? 28 : 30, 800, "#F2C14E");
    if (porSector) { ctx.font = "800 22px Archivo, Arial, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.lineJoin = "round"; ctx.strokeText(sector.toUpperCase(), 22, 34); ctx.fillStyle = "#fff"; ctx.fillText(sector.toUpperCase(), 22, 34); }
    ctx.restore();
    /* Leyenda de molinos, mangas y caminos que aparecen */
    const tipos = [...new Set(S.d.infra.filter((x) => { const v = x.geom?.type === "Point" ? [x.geom.coordinates] : x.geom?.coordinates || []; const c = v.length < 2 ? v : v.slice(1).flatMap((p, i) => Array.from({ length: 21 }, (_, k) => [v[i][0] + (p[0] - v[i][0]) * k / 20, v[i][1] + (p[1] - v[i][1]) * k / 20])); return c.some(([lon, lat]) => { const X = this.px(lon, z) - ox, Y = this.py(lat, z) - oy; return X >= 0 && Y >= 0 && X <= W && Y <= Hm; }); }).map((x) => x.tipo))].filter((k) => INFRA[k]);
    if (tipos.length) {
      const lh = 30, bw = 232, bh = 14 + tipos.length * lh, bx = W - bw - 16, by = Hm - bh - 16;
      ctx.fillStyle = "rgba(20,26,22,.82)"; ctx.fillRect(bx, by, bw, bh);
      tipos.forEach((k, i) => {
        const d = INFRA[k], y = by + 22 + i * lh, x0 = bx + 14;
        if (d.geo === "punto") { ctx.beginPath(); ctx.arc(x0 + 16, y, 11, 0, Math.PI * 2); ctx.fillStyle = d.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.font = `800 ${d.letra.length > 1 ? 10 : 12}px Archivo, Arial`; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(d.letra, x0 + 16, y + 1); }
        else { const p = k === "camino_principal"; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 34, y); ctx.lineCap = "round"; ctx.setLineDash([]); ctx.lineWidth = p ? 12 : 9; ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.stroke(); ctx.setLineDash(p ? [] : [9, 7]); ctx.lineWidth = p ? 7 : 5; ctx.strokeStyle = p ? "#FFE08A" : "#FFF6DA"; ctx.stroke(); ctx.setLineDash([]); }
        ctx.font = "600 16px 'Source Sans 3', Arial, sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(d.nombre, x0 + 46, y);
      });
    }
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
    ctx.fillText(`${nombreUbic(o.lote_id, o.sub_id)}${sector && !norm(l.nombre).endsWith(norm(sector)) ? " (" + sector + ")" : ""} · ${fmt(o.superficie_ha, 1)} ha${o.fecha_prevista ? " · prevista " + fechaAR(o.fecha_prevista) : ""}${o.contratista ? " · " + o.contratista : ""}`, 24, Hm + 72);
    ctx.textAlign = "right"; ctx.font = "500 12px 'Source Sans 3', Arial, sans-serif"; ctx.fillStyle = "#9AA89D"; ctx.fillText(`Flores Chicas${atrib ? " · " + atrib : " · sin imagen satelital"}`, W - 18, Hm + 82);
    const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.88));
    return { blob, conFondo: !!atrib };
  },
};
