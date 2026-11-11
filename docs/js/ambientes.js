"use strict";
/* ============ Ambientación de lotes y prescripción de siembra variable (monitor Precision Planting 20|20) ============
   Las capas (fechas de NDVI y mapas de rinde) se llevan a la misma grilla de 10 m del NDVI del lote,
   se promedian píxel por píxel, se clasifican en ambientes y cada ambiente lleva su dosis de semilla y fertilizante.
   Las franjas de ensayo pisan los ambientes con su propia dosis. Se guarda en Storage: rindes/ambientes/<lote>.json */
const AMB = {
  MAX_NDVI: 6, BOLSA: 80000, PAD: 2,
  COL: { 2: ["#d7301f", "#1a9850"], 3: ["#d7301f", "#fee08b", "#1a9850"], 4: ["#d7301f", "#fc8d59", "#91cf60", "#1a9850"], 5: ["#d7301f", "#fc8d59", "#fee08b", "#91cf60", "#1a9850"], 6: ["#a50026", "#f46d43", "#fdae61", "#d9ef8b", "#66bd63", "#006837"] },
  NOMBRES: { 2: ["Bajo", "Alto"], 3: ["Bajo", "Medio", "Alto"], 4: ["Bajo", "Medio bajo", "Medio alto", "Alto"], 5: ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"], 6: ["Muy bajo", "Bajo", "Medio bajo", "Medio alto", "Alto", "Muy alto"] },
  SUAV: [["0", "Sin suavizar"], ["1", "Leve (30 m)"], ["2", "Fuerte (50 m)"]],
  METODOS: [["natural", "Cortes naturales"], ["cuantiles", "Igual superficie"]],

  /* ---------- Grilla de 10 m del lote (la misma que usa el NDVI) ---------- */
  gridDe(l) { const bb = bboxDe(l.geom); const lat0 = (bb[1] + bb[3]) / 2; const dLat = 10 / 111320, dLon = 10 / (111320 * Math.cos(lat0 * Math.PI / 180)); return { bb, W: Math.max(1, Math.ceil((bb[2] - bb[0]) / dLon)), H: Math.max(1, Math.ceil((bb[3] - bb[1]) / dLat)), dLat, dLon, lat0 }; },
  celdaHa(g) { return (g.dLat * 111320) * (g.dLon * 111320 * Math.cos(g.lat0 * Math.PI / 180)) / 1e4; },
  limites(g) { return [[g.bb[3] - g.H * g.dLat, g.bb[0]], [g.bb[3], g.bb[0] + g.W * g.dLon]]; },
  mascara(l, g) { const m = new Uint8Array(g.W * g.H); for (let j = 0; j < g.H; j++) { const lat = g.bb[3] - (j + 0.5) * g.dLat; for (let i = 0; i < g.W; i++) if (dentro(g.bb[0] + (i + 0.5) * g.dLon, lat, l.geom)) m[j * g.W + i] = 1; } return m; },
  celdaDe(g, lon, lat) { const i = Math.floor((lon - g.bb[0]) / g.dLon), j = Math.floor((g.bb[3] - lat) / g.dLat); return i < 0 || j < 0 || i >= g.W || j >= g.H ? -1 : j * g.W + i; },

  /* Raster guardado como enteros de 16 bits en base64 (valor × 10.000) */
  enc(f) { const a = new Int16Array(f.length); for (let k = 0; k < f.length; k++) { const v = f[k]; a[k] = v === v ? Math.max(-32767, Math.min(32767, Math.round(v * 10000))) : -32768; } const u = new Uint8Array(a.buffer); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  dec(b64, n) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); const a = new Int16Array(u.buffer); const f = new Float32Array(n); for (let k = 0; k < n; k++) f[k] = a[k] === -32768 ? NaN : a[k] / 10000; return f; },

  /* Escena de Sentinel-2 reducida a lo necesario para volver a calcular su NDVI */
  itemMin(it) {
    const A = it.assets || {}; const P = it.properties || {};
    const pick = (a) => a ? { href: a.href, "raster:bands": a["raster:bands"], "proj:epsg": a["proj:epsg"], "proj:code": a["proj:code"] } : undefined;
    const keys = ["datetime", "platform", "eo:cloud_cover", "proj:epsg", "proj:code", "mgrs:utm_zone", "mgrs:latitude_band", "s2:processing_baseline", "earthsearch:boa_offset_applied"];
    return { id: it.id, bbox: it.bbox, properties: Object.fromEntries(keys.filter((k) => P[k] !== undefined).map((k) => [k, P[k]])), assets: { red: pick(A.red || A.B04), nir: pick(A.nir || A.B08), scl: pick(A.scl || A.SCL) } };
  },

  /* ---------- Operaciones sobre la grilla ---------- */
  /* Completa celdas vacías dentro del lote con el promedio de sus vecinas */
  rellenar(v, g, mask, max = 300) {
    const { W, H } = g; let cur = v;
    for (let it = 0; it < max; it++) {
      let falta = 0, cambio = false; const nx = Float32Array.from(cur);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i; if (!mask[k] || cur[k] === cur[k]) continue;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= W || b >= H) continue; const x = cur[b * W + a]; if (x === x) { s += x; n++; } }
        if (n) { nx[k] = s / n; cambio = true; } else falta++;
      }
      cur = nx; if (!falta || !cambio) break;
    }
    return cur;
  },
  /* Promedio móvil de (2r+1)×(2r+1) celdas, solo con celdas del lote */
  suavizar(v, g, mask, r) {
    if (!r) return v; const { W, H } = g; const out = new Float32Array(W * H).fill(NaN);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; if (!mask[k]) continue; let s = 0, n = 0;
      for (let b = Math.max(0, j - r); b <= Math.min(H - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(W - 1, i + r); a++) { const x = v[b * W + a]; if (x === x && mask[b * W + a]) { s += x; n++; } }
      out[k] = n ? s / n : v[k];
    }
    return out;
  },
  /* Puntos del mapa de rinde a la grilla: promedio por celda, huecos rellenados y un suavizado leve */
  rasterRinde(pts, g, mask) {
    const N = g.W * g.H; const sum = new Float64Array(N), cnt = new Uint32Array(N);
    for (const p of pts) { const k = AMB.celdaDe(g, p[1], p[0]); if (k >= 0) { sum[k] += p[2]; cnt[k]++; } }
    const v = new Float32Array(N).fill(NaN); let hay = 0;
    for (let k = 0; k < N; k++) if (mask[k] && cnt[k]) { v[k] = sum[k] / cnt[k]; hay++; }
    if (!hay) return null;
    return AMB.suavizar(AMB.rellenar(v, g, mask), g, mask, 1);
  },
  /* Cortes naturales en una dimensión (k-medias sobre los valores ordenados) */
  kmeans(s, n) {
    const m = s.length; if (m < n * 2) return Array.from({ length: n - 1 }, (_, i) => cuantil(s, (i + 1) / n));
    const pre = new Float64Array(m + 1); for (let i = 0; i < m; i++) pre[i + 1] = pre[i] + s[i];
    const desde = (x) => { let lo = 0, hi = m; while (lo < hi) { const md = (lo + hi) >> 1; if (s[md] < x) lo = md + 1; else hi = md; } return lo; };
    let c = Array.from({ length: n }, (_, i) => cuantil(s, (i + 0.5) / n));
    for (let it = 0; it < 200; it++) {
      const cut = [0, ...c.slice(0, -1).map((x, i) => desde((x + c[i + 1]) / 2)), m];
      const nc = c.map((x, i) => cut[i + 1] > cut[i] ? (pre[cut[i + 1]] - pre[cut[i]]) / (cut[i + 1] - cut[i]) : x);
      const listo = nc.every((x, i) => Math.abs(x - c[i]) < 1e-7); c = nc; if (listo) break;
    }
    return c.slice(0, -1).map((x, i) => (x + c[i + 1]) / 2);
  },
  /* Manchones más chicos que el mínimo pasan al ambiente vecino con más borde en común */
  manchones(cls, g, minC) {
    const { W, H } = g, N = W * H; const lab = new Int32Array(N); const q = new Int32Array(N);
    for (let pass = 0; pass < 10; pass++) {
      lab.fill(-1); let cambio = false, L = 0;
      for (let k0 = 0; k0 < N; k0++) {
        if (cls[k0] === 255 || lab[k0] >= 0) continue;
        const c = cls[k0]; let h = 0, t = 0; q[t++] = k0; lab[k0] = L; const vec = {};
        while (h < t) {
          const k = q[h++]; const i = k % W, j = (k - i) / W;
          for (let d = 0; d < 4; d++) {
            const a = i + (d === 0 ? 1 : d === 1 ? -1 : 0), b = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (a < 0 || b < 0 || a >= W || b >= H) continue; const kk = b * W + a; const cc = cls[kk]; if (cc === 255) continue;
            if (cc === c) { if (lab[kk] < 0) { lab[kk] = L; q[t++] = kk; } } else vec[cc] = (vec[cc] || 0) + 1;
          }
        }
        if (t < minC) { let best = -1, bn = 0; for (const [cc, nn] of Object.entries(vec)) if (nn > bn) { bn = nn; best = +cc; } if (best >= 0) { for (let x = 0; x < t; x++) cls[q[x]] = best; cambio = true; } }
        L++;
      }
      if (!cambio) break;
    }
  },

  /* ---------- Capas e índice ---------- */
  async capasDatos(l, a, prog) {
    const g = a.grid, N = g.W * g.H; const mask = AMB.mascara(l, g); let nm = 0; for (const x of mask) nm += x;
    if (!Object.keys(S.ndvi.series || {}).length) S.ndvi.series = (await Cache.get("ndvi2:" + l.id)) || {};
    const out = []; let i = 0;
    for (const c of a.capas) {
      i++; prog?.(`Preparando capa ${i} de ${a.capas.length}${c.tipo === "ndvi" ? ": NDVI del " + fechaAR(c.fecha) : ": rinde " + c.campana}…`);
      try {
        if (c.tipo === "ndvi") {
          let r = await obtenerNDVI(l, c.item, true); if (!r.raw || r.W !== g.W || r.H !== g.H) r = await calcNDVI(l, c.item);
          const v = new Float32Array(N).fill(NaN); const vals = [];
          for (let k = 0; k < N; k++) { const x = r.raw[k]; if (mask[k] && x === x && x !== NUBE) { v[k] = x; vals.push(x); } }
          if (vals.length < nm * 0.25) { out.push({ c, ok: false, error: "casi todo el lote con nubes" }); continue; }
          const s = Float32Array.from(vals).sort();
          out.push({ c, v, ok: true, mean: vals.reduce((p, q) => p + q, 0) / vals.length, p90: cuantil(s, 0.9), valido: vals.length / nm });
        } else {
          const r = S.d.rindes.find((x) => x.id === c.id); const pts = r ? await puntosRinde(r) : null;
          const v = pts ? AMB.rasterRinde(pts, g, mask) : null; if (!v) { out.push({ c, ok: false, error: "sin puntos dentro del lote" }); continue; }
          let s = 0, n = 0; for (let k = 0; k < N; k++) if (v[k] === v[k]) { s += v[k]; n++; }
          out.push({ c, v, ok: true, mean: s / n, valido: n / nm, unidad: r.unidad });
        }
      } catch (e) { console.warn(e); out.push({ c, ok: false, error: e.message }); }
    }
    return { mask, capas: out };
  },
  /* Promedio ponderado píxel por píxel. Relativo: cada capa dividida por su media en el lote.
     Crudo: el NDVI tal cual; el rinde entra relativo, llevado a la escala del NDVI promedio. */
  indice(a, D) {
    const g = a.grid, N = g.W * g.H; const idx = new Float32Array(N).fill(NaN);
    const ok = D.capas.filter((x) => x.ok && (+x.c.peso || 0) > 0);
    const nd = ok.filter((x) => x.c.tipo === "ndvi"); const escN = nd.length ? nd.reduce((s, x) => s + x.mean, 0) / nd.length : 1;
    for (let k = 0; k < N; k++) {
      if (!D.mask[k]) continue; let s = 0, w = 0;
      for (const x of ok) { const v = x.v[k]; if (v !== v) continue; const p = +x.c.peso; s += p * (a.modo === "crudo" ? (x.c.tipo === "ndvi" ? v : (v / x.mean) * escN) : v / x.mean); w += p; }
      if (w) idx[k] = s / w;
    }
    return AMB.rellenar(idx, g, D.mask);
  },
  rango(v) { const s = []; for (const x of v) if (x === x) s.push(x); const a = Float32Array.from(s).sort(); return [cuantil(a, 0.02), cuantil(a, 0.98)]; },
  clasificar(a) {
    const g = a.grid, N = g.W * g.H; const idx = a._idx; const mask = new Uint8Array(N); for (let k = 0; k < N; k++) mask[k] = idx[k] === idx[k] ? 1 : 0;
    const sm = AMB.suavizar(idx, g, mask, +a.suavizado || 0);
    const vals = []; for (let k = 0; k < N; k++) if (mask[k]) vals.push(sm[k]);
    /* Los extremos (bordes, alambrados, aguadas) se recortan al P1–P99 para que no se queden con un ambiente */
    const s0 = Float64Array.from(vals).sort(); const lo = cuantil(s0, 0.01), hi = cuantil(s0, 0.99);
    const s = s0.map((x) => Math.min(hi, Math.max(lo, x))); const n = +a.n;
    const cortes = a.metodo === "cuantiles" ? Array.from({ length: n - 1 }, (_, i) => cuantil(s, (i + 1) / n)) : AMB.kmeans(s, n);
    const cls = new Uint8Array(N).fill(255);
    for (let k = 0; k < N; k++) if (mask[k]) { let c = 0; while (c < n - 1 && sm[k] >= cortes[c]) c++; cls[k] = c; }
    if ((+a.minHa || 0) > 0) AMB.manchones(cls, g, Math.max(1, Math.round(+a.minHa / AMB.celdaHa(g))));
    a._cls = cls; a._cortes = cortes; a._rango = AMB.rango(idx); a._frZ = {}; a._rz = null;
  },
  stats(a) {
    const n = +a.n, g = a.grid, N = g.W * g.H, ch = AMB.celdaHa(g); const z = Array.from({ length: n }, () => ({ c: 0, s: 0 }));
    for (let k = 0; k < N; k++) { const c = a._cls[k]; if (c === 255) continue; z[c].c++; z[c].s += a._idx[k]; }
    return z.map((x) => ({ ha: x.c * ch, media: x.c ? x.s / x.c : NaN }));
  },
  /* Rinde medio de cada ambiente según los mapas de rinde del lote */
  async rindesPorZona(l, a) {
    const n = +a.n, g = a.grid; const out = [];
    for (const r of S.d.rindes.filter((x) => x.lote_id === l.id).sort((x, y) => (y.campana || "").localeCompare(x.campana || "")).slice(0, 4)) {
      const pts = await puntosRinde(r); if (!pts) continue; const s = new Float64Array(n), c = new Uint32Array(n);
      for (const p of pts) { const k = AMB.celdaDe(g, p[1], p[0]); if (k < 0) continue; const z = a._cls[k]; if (z === 255) continue; s[z] += p[2]; c[z]++; }
      out.push({ etq: `${r.campana} ${r.cultivo}`, unidad: r.unidad, med: Array.from(s, (x, i) => (c[i] > 20 ? x / c[i] : NaN)) });
    }
    return out;
  },

  /* ---------- Franjas de ensayo ---------- */
  ancho(sb) { return (+sb.surcos || 0) * (+sb.dist || 0) / 100; },
  franjaGeom(l, line, ancho) {
    const f = feat(line); let poly;
    try {
      const a = turf.lineOffset(f, ancho / 2, { units: "meters" }), b = turf.lineOffset(f, -ancho / 2, { units: "meters" });
      const c = [...a.geometry.coordinates, ...b.geometry.coordinates.slice().reverse()]; c.push(c[0]); poly = { type: "Polygon", coordinates: [c] };
      if (turf.kinks(feat(poly)).features.length) throw new Error("quiebre");
    } catch (e) { poly = turf.buffer(f, ancho / 2, { units: "meters", steps: 2 }).geometry; }
    let r = null; try { r = geoOp("intersect", feat(l.geom), feat(poly)); } catch (e) {}
    const ps = piezas(r); return ps.length ? multi(ps) : null;
  },
  /* Hectáreas de cada ambiente que quedan debajo de una franja (muestreo cada 2 m) */
  franjaPorZona(a, fr) {
    const n = +a.n, g = a.grid; const out = new Array(n).fill(0); const bb = bboxDe(fr.geom);
    const st = 2, dLat = st / 111320, dLon = st / (111320 * Math.cos(g.lat0 * Math.PI / 180)); const ha = (st * st) / 1e4;
    for (let lat = bb[1] + dLat / 2; lat < bb[3]; lat += dLat) for (let lon = bb[0] + dLon / 2; lon < bb[2]; lon += dLon) {
      if (!dentro(lon, lat, fr.geom)) continue; const k = AMB.celdaDe(g, lon, lat); if (k < 0) continue; const z = a._cls[k]; if (z !== 255) out[z] += ha;
    }
    return out;
  },

  /* ---------- Dosis y totales ---------- */
  dosis(a) { const n = +a.n; a.dosisN ??= {}; const d = (a.dosisN[n] ??= []); while (d.length < n) d.push({ sem: null, fert: null }); d.length = n; return d; },
  totales(a, st) {
    const d = AMB.dosis(a); let sem = 0, fert = 0, haSem = 0;
    st.forEach((z, k) => { if (d[k].sem) { sem += z.ha * d[k].sem; haSem += z.ha; } if (d[k].fert) fert += z.ha * d[k].fert; });
    for (const fr of a.franjas) {
      const pz = (a._frZ[fr.id] ??= AMB.franjaPorZona(a, fr)); const ha = haDe(fr.geom);
      pz.forEach((h, k) => { sem -= h * (d[k].sem || 0); fert -= h * (d[k].fert || 0); });
      sem += ha * (fr.sem || 0); fert += ha * (fr.fert || 0);
    }
    return { sem, fert, bolsas: sem / AMB.BOLSA, haSem };
  },
  semNum(v) { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[.\s]/g, "").replace(",", ".")); return isFinite(n) && n > 0 ? Math.round(n) : null; },

  /* ---------- Imagen sobre el mapa ---------- */
  rampa(t) { const st = PAL_RGB.rdylgn; t = Math.max(0, Math.min(1, t)); const x = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)), f = x - i; return st[i].map((c, k) => Math.round(c + (st[i + 1][k] - c) * f)); },
  hex(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); },
  imagen(a) {
    const g = a.grid; const cv = document.createElement("canvas"); cv.width = g.W; cv.height = g.H; const ctx = cv.getContext("2d"); const im = ctx.createImageData(g.W, g.H); const d = im.data;
    const vista = a._vista || "ambientes";
    if (vista === "ambientes") {
      const col = AMB.COL[+a.n].map(AMB.hex);
      for (let k = 0; k < g.W * g.H; k++) { const c = a._cls[k]; if (c === 255) continue; const o = k * 4; d[o] = col[c][0]; d[o + 1] = col[c][1]; d[o + 2] = col[c][2]; d[o + 3] = 225; }
    } else {
      const capa = vista.startsWith("capa:") ? a._D?.capas[+vista.slice(5)] : null; const v = capa ? capa.v : a._idx;
      const [lo, hi] = capa ? AMB.rango(v) : a._rango;
      for (let k = 0; k < g.W * g.H; k++) { const x = v[k]; if (x !== x) continue; const c = AMB.rampa((x - lo) / (hi - lo || 1)); const o = k * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 235; }
    }
    ctx.putImageData(im, 0, 0); return cv.toDataURL();
  },
  leyenda(a) {
    const vista = a._vista || "ambientes";
    if (vista === "ambientes") {
      const n = +a.n, st = AMB.stats(a), d = AMB.dosis(a);
      return `<b>${esc(a.nombre)}</b>${AMB.COL[n].map((c, k) => k).reverse().map((k) => `<div class="cls"><i style="background:${AMB.COL[n][k]}"></i><span>A${k + 1} ${AMB.NOMBRES[n][k]} · ${fmt(st[k].ha, 1)} ha${d[k].sem ? ` · <b class="num">${fmt(d[k].sem, 0)}</b> sem/ha` : ""}</span></div>`).join("")}${a.franjas.length ? `<div class="cls"><i style="background:#fff;border:2px dashed #111"></i><span>Franjas de ensayo (${a.franjas.length})</span></div>` : ""}`;
    }
    const capa = vista.startsWith("capa:") ? a.capas[+vista.slice(5)] : null; const D = capa ? a._D?.capas[+vista.slice(5)] : null;
    const [lo, hi] = D ? AMB.rango(D.v) : a._rango; const dec = capa?.tipo === "rinde" ? 1 : 2;
    const tit = capa ? (capa.tipo === "ndvi" ? `NDVI ${fechaAR(capa.fecha)}` : `Rinde ${esc(capa.campana)} · ${esc(capa.cultivo)}`) : a.modo === "crudo" ? "NDVI promedio" : "Índice promedio (1 = media del lote)";
    return `<b>${tit}</b><div class="ramp" style="background:linear-gradient(90deg,${PALETAS.rdylgn.c.join(",")})"></div><div class="ends"><span>${fmt(lo, dec)}</span><span>${fmt(hi, dec)}</span></div><span class="muted">${capa ? "Capa sola" : `Promedio de ${a.capas.filter((c) => +c.peso > 0).length} capa${a.capas.length > 1 ? "s" : ""}`} · escala P2–P98</span>`;
  },
  pintarMapa(a) {
    if (S.overlay) map.removeLayer(S.overlay); if (rindeLayer) { map.removeLayer(rindeLayer); rindeLayer = null; S.rindeVis = null; }
    S.overlay = L.imageOverlay(AMB.imagen(a), AMB.limites(a.grid), { opacity: 1, interactive: false, className: "ndvi-img" }).addTo(map);
    if (S.ambFr) map.removeLayer(S.ambFr);
    S.ambFr = L.layerGroup();
    for (const fr of a.franjas) {
      L.geoJSON(fr.geom, { style: { color: "#111", weight: 2, fillColor: "#ffffff", fillOpacity: 0.4, dashArray: "6 4" }, interactive: false }).addTo(S.ambFr);
      try { let c = null; try { const ln = feat({ type: "LineString", coordinates: fr.linea }); const q = turf.along(ln, turf.length(ln) * 0.22).geometry.coordinates; if (dentro(q[0], q[1], fr.geom)) c = q; } catch (e) {} c ??= turf.pointOnFeature(feat(fr.geom)).geometry.coordinates; L.marker([c[1], c[0]], { interactive: false, keyboard: false, icon: L.divIcon({ className: "franja-lbl", iconSize: null, html: `<div>${esc(fr.nombre)}${fr.sem ? " · " + fmt(fr.sem / 1000, 0) + " mil" : ""}</div>` }) }).addTo(S.ambFr); } catch (e) {}
    }
    S.ambFr.addTo(map); leyenda(AMB.leyenda(a)); restyle();
  },
  quitarMapa() { if (S.ambFr) { map.removeLayer(S.ambFr); S.ambFr = null; } },

  /* ---------- Guardar en Storage ---------- */
  ruta: (loteId) => `ambientes/${loteId}.json`,
  async lista(l) {
    if (S.ambLista[l.id]) return S.ambLista[l.id];
    let lista = [];
    try { const b = await DB.bajar("rindes", AMB.ruta(l.id)); if (b) lista = JSON.parse(await b.text()).lista || []; } catch (e) {}
    return (S.ambLista[l.id] = lista);
  },
  limpio(a) { const o = {}; for (const [k, v] of Object.entries(a)) if (!k.startsWith("_")) o[k] = v; return o; },
  async subirLista(l) { await DB.subir("rindes", AMB.ruta(l.id), new Blob([JSON.stringify({ v: 1, lista: S.ambLista[l.id] })], { type: "application/json" })); },
  async guardar(a) {
    const l = loteDe(a.lote_id); if (!l) return; clearTimeout(a._t);
    a.actualizado = new Date().toISOString(); const lista = await AMB.lista(l);
    const i = lista.findIndex((x) => x.id === a.id); const o = AMB.limpio(a); if (i >= 0) lista[i] = o; else lista.unshift(o);
    AMB.estado(a, "Guardando…");
    try { await AMB.subirLista(l); a._sucio = false; AMB.estado(a, "Guardado ✓"); }
    catch (e) { AMB.estado(a, "No se pudo guardar: " + e.message, true); throw e; }
  },
  cambio(a) { a._sucio = true; AMB.estado(a, "Cambios sin guardar…"); clearTimeout(a._t); a._t = setTimeout(() => AMB.guardar(a).catch(() => {}), 1500); },
  estado(a, txt, mal) { const el = document.getElementById("aEst"); if (el && S.ambEd === a) { el.textContent = txt; el.style.color = mal ? "var(--danger)" : ""; } },

  /* ---------- Sección en la ficha del lote ---------- */
  sel(l) { if (S.ambSel?.lote !== l.id) S.ambSel = { lote: l.id, nd: [], rd: [], para: null }; return S.ambSel; },
  tildar(l, it, on) {
    const s = AMB.sel(l); const i = s.nd.findIndex((x) => x.id === it.id);
    if (on && i < 0) { if (s.nd.length >= AMB.MAX_NDVI) { toast(`Se pueden usar hasta ${AMB.MAX_NDVI} imágenes de NDVI.`); return false; } s.nd.push(AMB.itemMin(it)); s.nd.sort((a, b) => a.properties.datetime.localeCompare(b.properties.datetime)); }
    if (!on && i >= 0) s.nd.splice(i, 1);
    AMB.pintarSeccion(l); return true;
  },
  htmlSeccion(l) {
    const s = AMB.sel(l); const lista = S.ambLista[l.id]; const rs = S.d.rindes.filter((r) => r.lote_id === l.id).sort((a, b) => (b.campana || "").localeCompare(a.campana || ""));
    const para = s.para && lista?.find((x) => x.id === s.para);
    const listaHtml = !lista ? '<div class="small muted"><span class="spin"></span> Buscando ambientaciones guardadas…</div>'
      : lista.length ? lista.map((x) => `<div class="amb-item"><div><b>${esc(x.nombre)}</b><div class="small muted">${x.n} ambientes · ${x.capas.length} capa${x.capas.length > 1 ? "s" : ""}${x.franjas?.length ? ` · ${x.franjas.length} franja${x.franjas.length > 1 ? "s" : ""}` : ""} · ${fechaAR((x.actualizado || x.creado || "").slice(0, 10))}</div></div><button class="small" data-aab="${x.id}">Abrir</button></div>`).join("") : "";
    return `<h2>Ambientación y prescripción</h2>${listaHtml}
      <div class="amb-nueva"><b class="small">${para ? `Cambiar las capas de «${esc(para.nombre)}»` : "Nueva ambientación"}</b>
        <div class="small">${s.nd.length ? `NDVI elegidas (${s.nd.length} de ${AMB.MAX_NDVI}):` : `Buscá imágenes en <b>NDVI satelital</b> y tildá ☑ las fechas que te parezcan representativas (hasta ${AMB.MAX_NDVI}). Conviene usar cultivos de verano de distintos años, cerca del pico.`}</div>
        ${s.nd.length ? `<div class="row" style="gap:4px">${s.nd.map((it) => `<span class="chip-x">${fechaAR(it.properties.datetime.slice(0, 10))}<button class="ghost small" data-aq="${it.id}" aria-label="Sacar esta fecha">✕</button></span>`).join("")}</div>` : ""}
        ${rs.length ? `<div class="small">Mapas de rinde como capa:</div>${rs.map((r) => `<label class="row small" style="gap:6px"><input type="checkbox" data-ar="${r.id}" ${s.rd.includes(r.id) ? "checked" : ""}> ${esc(r.campana)} · ${esc(r.cultivo)} <span class="muted">(${(r.n || 0).toLocaleString("es-AR")} puntos)</span></label>`).join("")}` : '<div class="small muted">Si cargás mapas de rinde del lote, también los podés usar como capa.</div>'}
        <div id="aProg" class="small muted"></div>
        <div class="row"><button class="primary" id="aCalc" ${s.nd.length + s.rd.length ? "" : "disabled"}>${para ? "Recalcular con estas capas" : "Calcular ambientación"}</button>${para ? '<button class="ghost" id="aCancPara">Cancelar</button>' : ""}</div></div>`;
  },
  pintarSeccion(l) { const el = document.getElementById("ambBlk"); if (!el) return; el.innerHTML = AMB.htmlSeccion(l); AMB.bindSeccion(l); },
  bindSeccion(l) {
    const el = document.getElementById("ambBlk"); if (!el) return; const s = AMB.sel(l);
    if (!S.ambLista[l.id]) AMB.lista(l).then(() => { if (S.sel === l.id && !S.ambEd) AMB.pintarSeccion(l); });
    el.querySelectorAll("[data-aab]").forEach((b) => (b.onclick = () => AMB.abrir(l, b.dataset.aab)));
    el.querySelectorAll("[data-aq]").forEach((b) => (b.onclick = () => { s.nd = s.nd.filter((x) => x.id !== b.dataset.aq); AMB.pintarSeccion(l); pintarFechas(l); }));
    el.querySelectorAll("[data-ar]").forEach((ck) => (ck.onchange = () => { s.rd = ck.checked ? [...new Set([...s.rd, ck.dataset.ar])] : s.rd.filter((x) => x !== ck.dataset.ar); AMB.pintarSeccion(l); }));
    if (el.querySelector("#aCancPara")) el.querySelector("#aCancPara").onclick = () => { S.ambSel = null; AMB.abrir(l, s.para); };
    el.querySelector("#aCalc").onclick = () => AMB.calcular(l);
  },

  /* ---------- Calcular, abrir y cerrar ---------- */
  sembradora() { try { return JSON.parse(localStorage.getItem("fc-sembradora")) || { surcos: 16, dist: 52.5 }; } catch (e) { return { surcos: 16, dist: 52.5 }; } },
  async calcular(l) {
    const s = AMB.sel(l); const lista = await AMB.lista(l); const prev = s.para ? lista.find((x) => x.id === s.para) : null;
    const viejas = new Map((prev?.capas || []).map((c) => [c.id, c.peso]));
    const capas = [
      ...s.nd.map((it) => ({ tipo: "ndvi", id: it.id, fecha: it.properties.datetime.slice(0, 10), sat: satNom(it.properties.platform), peso: viejas.get(it.id) ?? 1, item: it })),
      ...s.rd.map((id) => { const r = S.d.rindes.find((x) => x.id === id); return { tipo: "rinde", id, campana: r?.campana, cultivo: r?.cultivo, peso: viejas.get(id) ?? 1 }; }),
    ];
    const a = prev ? { ...JSON.parse(JSON.stringify(prev)), capas } : { id: uid(), lote_id: l.id, nombre: `Maíz ${S.campana}`, campana: S.campana, creado: new Date().toISOString(), capas, modo: "relativo", n: 3, metodo: "natural", suavizado: 1, minHa: 0.5, dosisN: {}, fert_id: null, sembradora: AMB.sembradora(), franjas: [] };
    a.grid = AMB.gridDe(l);
    const prog = (t) => { const el = document.getElementById("aProg"); if (el) el.innerHTML = `<span class="spin"></span> ${esc(t)}`; };
    const btn = document.getElementById("aCalc"); if (btn) btn.disabled = true;
    try {
      const D = await AMB.capasDatos(l, a, prog);
      const ok = D.capas.filter((x) => x.ok);
      if (!ok.length) throw new Error("ninguna capa tiene datos sobre el lote (" + D.capas.map((x) => x.error).filter(Boolean).join("; ") + ")");
      a._D = D; a._idx = AMB.indice(a, D); a.indice = AMB.enc(a._idx); AMB.clasificar(a);
      a._vista = "indice"; S.ambSel = null; S.ambEd = a;
      render(); document.getElementById("panel").scrollTop = 0; await AMB.guardar(a).catch(() => {});
      const malas = D.capas.filter((x) => !x.ok); if (malas.length) toast(`${malas.length} capa${malas.length > 1 ? "s" : ""} sin datos útiles quedaron afuera del promedio.`, 6000);
    } catch (e) { console.error(e); prog(""); const el = document.getElementById("aProg"); if (el) el.innerHTML = `<div class="aviso">No pude calcular la ambientación: ${esc(e.message)}</div>`; if (btn) btn.disabled = false; }
  },
  async abrir(l, id) {
    const lista = await AMB.lista(l); const x = lista.find((y) => y.id === id); if (!x) return;
    const a = JSON.parse(JSON.stringify(x)); a._idx = AMB.dec(a.indice, a.grid.W * a.grid.H); AMB.clasificar(a); a._vista = "ambientes";
    S.ambEd = a; render(); document.getElementById("panel").scrollTop = 0;
  },
  async cerrar() {
    const a = S.ambEd; if (!a) return;
    S.ambEd = null; AMB.quitarMapa(); limpiarOverlays(); restyle();
    if (a._sucio) { clearTimeout(a._t); await AMB.guardar(a).catch(() => {}); }
  },
  async asegurarDatos(l, a) {
    if (a._D) return true;
    AMB.estado(a, "Descargando las capas para recalcular…");
    const D = await AMB.capasDatos(l, a, (t) => AMB.estado(a, t));
    if (!D.capas.some((x) => x.ok)) { AMB.estado(a, "No pude descargar las capas.", true); return false; }
    a._D = D; AMB.estado(a, ""); return true;
  },
  async recalcular(l, a) { if (!(await AMB.asegurarDatos(l, a))) return; a._idx = AMB.indice(a, a._D); a.indice = AMB.enc(a._idx); AMB.clasificar(a); AMB.cambio(a); AMB.repintar(l, a); },
  repintar(l, a) { const p = document.getElementById("panel"); const y = p.scrollTop; render(); p.scrollTop = y; },

  /* ---------- Panel de trabajo ---------- */
  html(l, a) {
    const n = +a.n, st = AMB.stats(a), d = AMB.dosis(a), col = AMB.COL[n], nom = AMB.NOMBRES[n]; const haT = st.reduce((s, z) => s + z.ha, 0);
    const vista = a._vista || "ambientes"; const ancho = AMB.ancho(a.sembradora);
    const ferts = S.d.productos.filter((p) => /fertil/i.test(p.tipo || "")).sort((x, y) => x.nombre.localeCompare(y.nombre));
    const capas = a.capas.map((c, i) => {
      const x = a._D?.capas[i];
      const avisos = [];
      if (x && !x.ok) avisos.push(`<span class="pill bad" title="${esc(x.error || "")}">sin datos</span>`);
      if (x?.p90 >= 0.88) avisos.push('<span class="pill warn" title="El NDVI está cerca del máximo y diferencia poco entre zonas">saturada</span>');
      if (x?.ok && x.valido < 0.7) avisos.push(`<span class="pill warn">${fmt(x.valido * 100, 0)}% del lote con dato</span>`);
      return `<tr><td><button class="ghost small ${vista === "capa:" + i ? "on" : ""}" data-av="capa:${i}" title="Ver esta capa sola" aria-label="Ver esta capa sola">👁</button></td>
        <td>${c.tipo === "ndvi" ? `NDVI ${fechaAR(c.fecha)} <span class="small muted">${esc(c.sat || "")}</span>` : `Rinde ${esc(c.campana)} · ${esc(c.cultivo)}`}${x?.ok ? `<div class="small muted">media ${fmt(x.mean, c.tipo === "ndvi" ? 2 : 1)}${c.tipo === "rinde" ? " " + esc(x.unidad || "") : ""}</div>` : ""}${avisos.length ? `<div>${avisos.join(" ")}</div>` : ""}</td>
        <td class="right"><input data-ap="${i}" inputmode="decimal" value="${c.peso}" style="width:52px;text-align:right" aria-label="Peso de la capa"></td></tr>`;
    }).join("");
    const rz = a._rz || [];
    const filas = st.map((z, k) => `<tr><td><span class="amb-sw" style="background:${col[k]}"></span><b>A${k + 1}</b> ${nom[k]}<div class="small muted">índice ${fmt(z.media, 2)}${rz.map((r) => r.med[k] === r.med[k] ? ` · ${esc(r.etq)}: ${fmt(r.med[k], r.med[k] < 30 ? 1 : 0)}` : "").join("")}</div></td>
      <td class="num right">${fmt(z.ha, 1)}<div class="small muted">${fmt(haT ? (z.ha / haT) * 100 : 0, 0)}%</div></td>
      <td class="right"><input data-ds="${k}" inputmode="numeric" placeholder="semillas" value="${d[k].sem ?? ""}" style="width:84px;text-align:right" aria-label="Semillas por hectárea en A${k + 1}"></td>
      <td class="right"><input data-df="${k}" inputmode="decimal" placeholder="kg" value="${d[k].fert ?? ""}" style="width:60px;text-align:right" aria-label="Fertilizante kg por hectárea en A${k + 1}"></td></tr>`).join("");
    const franjas = a.franjas.map((f, i) => `<tr><td><b>${esc(f.nombre)}</b><div class="small muted">${fmt(f.ancho, 1)} m · ${fmt(haDe(f.geom), 2)} ha</div></td>
      <td class="right"><input data-fs="${i}" inputmode="numeric" placeholder="semillas" value="${f.sem ?? ""}" style="width:84px;text-align:right" aria-label="Semillas por hectárea en ${esc(f.nombre)}"></td>
      <td class="right"><input data-ff="${i}" inputmode="decimal" placeholder="kg" value="${f.fert ?? ""}" style="width:60px;text-align:right" aria-label="Fertilizante en ${esc(f.nombre)}"></td>
      <td><button class="ghost small danger" data-fd="${i}" aria-label="Borrar ${esc(f.nombre)}">✕</button></td></tr>`).join("");
    return `<section class="blk"><div class="row" style="justify-content:space-between"><button class="ghost small" id="aBack">← ${esc(l.nombre)}</button><span id="aEst" class="small muted">${a._sucio ? "Cambios sin guardar…" : ""}</span></div>
        <div class="field"><label class="lbl" for="aNom">Ambientación</label><input id="aNom" value="${esc(a.nombre)}"></div>
        <div class="seg" role="group" aria-label="Qué ver en el mapa"><button data-av="indice" class="${vista === "indice" ? "on" : ""}">${a.modo === "crudo" ? "NDVI promedio" : "Índice promedio"}</button><button data-av="ambientes" class="${vista === "ambientes" ? "on" : ""}">Ambientes</button></div></section>
      <section class="blk"><h2>1 · Capas promediadas</h2>
        <table class="t"><tr><th></th><th>Capa</th><th class="right">Peso</th></tr>${capas}</table>
        <div class="field"><label class="lbl" for="aModo">Cómo se promedian</label><select id="aModo">${opciones([["relativo", "Relativo: cada capa ÷ su media en el lote"], ["crudo", "NDVI crudo: promedio directo de los valores"]], a.modo)}</select></div>
        <div class="small muted">${a.modo === "crudo" ? "Pesan más las fechas con NDVI alto. Los mapas de rinde entran relativos, llevados a la escala del NDVI." : "Todas las fechas pesan igual, salvo el peso que les pongas. 1,10 quiere decir 10% por encima del promedio del lote."} Peso 0 deja la capa afuera.</div>
        <button class="small" id="aCapas">Agregar o sacar capas</button></section>
      <section class="blk"><h2>2 · Ambientes y dosis</h2>
        <div class="row"><div class="field"><label class="lbl" for="aN">Ambientes</label><select id="aN">${[2, 3, 4, 5, 6].map((x) => `<option ${x === n ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="field"><label class="lbl" for="aMet">Cortes</label><select id="aMet">${opciones(AMB.METODOS, a.metodo)}</select></div>
          <div class="field"><label class="lbl" for="aSuav">Suavizado</label><select id="aSuav">${opciones(AMB.SUAV, String(a.suavizado))}</select></div>
          <div class="field"><label class="lbl" for="aMin">Manchón mín. (ha)</label><input id="aMin" inputmode="decimal" value="${a.minHa}" style="width:70px"></div></div>
        <div class="tablewrap"><table class="t amb-t"><tr><th>Ambiente</th><th class="right">ha</th><th class="right">Semillas/ha</th><th class="right">Fert. kg/ha</th></tr>${filas}</table></div>
        <div class="field"><label class="lbl" for="aFert">Fertilizante (granular)</label><select id="aFert"><option value="">Sin elegir</option>${ferts.map((p) => `<option value="${p.id}" ${a.fert_id === p.id ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></div>
        <div id="aTot" class="amb-tot"></div></section>
      <section class="blk"><h2>3 · Franjas de ensayo</h2>
        <div class="row" style="align-items:flex-end"><div class="field"><label class="lbl" for="aSur">Surcos</label><input id="aSur" inputmode="numeric" value="${a.sembradora.surcos}" style="width:60px"></div>
          <div class="field"><label class="lbl" for="aDist">Entre surcos (cm)</label><input id="aDist" inputmode="decimal" value="${String(a.sembradora.dist).replace(".", ",")}" style="width:70px"></div>
          <div class="field"><span class="lbl">Ancho de franja</span><b class="num" id="aAncho">${fmt(ancho, 1)} m</b></div></div>
        ${a.franjas.length ? `<div class="tablewrap"><table class="t amb-t"><tr><th>Franja</th><th class="right">Semillas/ha</th><th class="right">Fert. kg/ha</th><th></th></tr>${franjas}</table></div>` : ""}
        <button id="aFr" ${ancho > 0 ? "" : "disabled"}>+ Dibujar franja</button>
        <div class="small muted">Trazá una línea en el sentido de siembra, de cabecera a cabecera. La franja toma el ancho de la sembradora y se recorta al lote. Conviene que crucen todos los ambientes, con dosis fija y al menos 2 repeticiones; después, con el mapa de rinde, se compara cada franja contra el resto de su mismo ambiente.</div></section>
      <section class="blk"><h2>4 · Prescripción para el 20|20</h2>
        <div class="row"><button class="primary" id="aExp">⬇ Descargar prescripción (.zip)</button><button class="ghost danger" id="aDel" style="margin-left:auto">Eliminar</button></div>
        <details class="small"><summary>Cómo cargarla en el monitor</summary><ol class="amb-pasos">
          <li>Descomprimí el .zip en la raíz del pendrive: queda la carpeta <b>SendTo2020</b> con el shapefile.</li>
          <li>En el 20|20: Setup → Data → Import → Prescriptions → <b>Seeding</b>, tocá el archivo e Import. Repetí con <b>Granular</b> para el fertilizante.</li>
          <li>En Setup → Fields elegí el lote, asigná la prescripción y elegí la columna: <b>SEM_HA</b> para la semilla y <b>FERT_KGHA</b> para el fertilizante (con el monitor en unidades imperiales: SEM_AC y FERT_LBAC).</li>
          <li>La prescripción se extiende unos 20 m fuera del contorno para cubrir las cabeceras. Revisá en el monitor la dosis que usa fuera de la prescripción.</li></ol></details></section>`;
  },
  bind(l, a) {
    const p = document.getElementById("panel"); const $ = (q) => p.querySelector(q);
    AMB.pintarMapa(a);
    const tot = () => {
      const t = AMB.totales(a, AMB.stats(a)); const fp = productoDe(a.fert_id);
      $("#aTot").innerHTML = `<div><span>Semilla</span><b class="num">${t.sem ? fmt(t.bolsas, 1) + " bolsas" : "—"}</b><span class="small muted">${t.sem ? fmt(t.sem, 0) + " semillas (bolsa de 80.000)" : "cargá las semillas por ambiente"}</span></div>
        <div><span>Fertilizante</span><b class="num">${t.fert ? fmt(t.fert, 0) + " kg" : "—"}</b><span class="small muted">${t.fert ? esc(fp?.nombre || "") : "opcional"}</span></div>`;
      if (S.overlay && (a._vista || "ambientes") === "ambientes") leyenda(AMB.leyenda(a));
    };
    tot();
    if (!a._rz) AMB.rindesPorZona(l, a).then((r) => { a._rz = r; if (S.ambEd === a && r.length) AMB.repintar(l, a); });
    $("#aBack").onclick = async () => { await AMB.cerrar(); render(); };
    $("#aNom").onchange = (e) => { a.nombre = e.target.value.trim() || a.nombre; AMB.cambio(a); };
    p.querySelectorAll("[data-av]").forEach((b) => (b.onclick = () => { a._vista = b.dataset.av === a._vista && b.dataset.av.startsWith("capa:") ? "indice" : b.dataset.av; if (a._vista.startsWith("capa:") && !a._D) { AMB.asegurarDatos(l, a).then((ok) => { if (!ok) a._vista = "indice"; AMB.repintar(l, a); }); return; } AMB.repintar(l, a); }));
    p.querySelectorAll("[data-ap]").forEach((inp) => (inp.onchange = () => { const v = num(inp.value); a.capas[+inp.dataset.ap].peso = v == null || v < 0 ? 0 : v; if (!a.capas.some((c) => +c.peso > 0)) { toast("Al menos una capa tiene que tener peso."); a.capas[+inp.dataset.ap].peso = 1; } a._vista = "indice"; AMB.recalcular(l, a); }));
    $("#aModo").onchange = (e) => { a.modo = e.target.value; a._vista = "indice"; AMB.recalcular(l, a); };
    $("#aCapas").onclick = async () => {
      S.ambSel = { lote: l.id, para: a.id, nd: a.capas.filter((c) => c.tipo === "ndvi").map((c) => c.item), rd: a.capas.filter((c) => c.tipo === "rinde").map((c) => c.id) };
      await AMB.cerrar(); render(); document.getElementById("ambBlk")?.scrollIntoView({ block: "start" });
    };
    const reclas = () => { AMB.clasificar(a); a._vista = "ambientes"; AMB.cambio(a); AMB.repintar(l, a); };
    $("#aN").onchange = (e) => { a.n = +e.target.value; reclas(); };
    $("#aMet").onchange = (e) => { a.metodo = e.target.value; reclas(); };
    $("#aSuav").onchange = (e) => { a.suavizado = +e.target.value; reclas(); };
    $("#aMin").onchange = (e) => { a.minHa = Math.max(0, num(e.target.value) || 0); reclas(); };
    const d = AMB.dosis(a);
    p.querySelectorAll("[data-ds]").forEach((inp) => (inp.oninput = () => { d[+inp.dataset.ds].sem = AMB.semNum(inp.value); tot(); AMB.cambio(a); }));
    p.querySelectorAll("[data-df]").forEach((inp) => (inp.oninput = () => { const v = num(inp.value); d[+inp.dataset.df].fert = v != null && v >= 0 ? v : null; tot(); AMB.cambio(a); }));
    $("#aFert").onchange = (e) => { a.fert_id = e.target.value || null; tot(); AMB.cambio(a); };
    const sembr = () => { a.sembradora = { surcos: Math.round(num($("#aSur").value) || 0), dist: num($("#aDist").value) || 0 }; $("#aAncho").textContent = fmt(AMB.ancho(a.sembradora), 1) + " m"; $("#aFr").disabled = !(AMB.ancho(a.sembradora) > 0); try { localStorage.setItem("fc-sembradora", JSON.stringify(a.sembradora)); } catch (e) {} AMB.cambio(a); };
    $("#aSur").oninput = sembr; $("#aDist").oninput = sembr;
    p.querySelectorAll("[data-fs]").forEach((inp) => (inp.oninput = () => { a.franjas[+inp.dataset.fs].sem = AMB.semNum(inp.value); tot(); AMB.cambio(a); }));
    p.querySelectorAll("[data-ff]").forEach((inp) => (inp.oninput = () => { const v = num(inp.value); a.franjas[+inp.dataset.ff].fert = v != null && v >= 0 ? v : null; tot(); AMB.cambio(a); }));
    p.querySelectorAll("[data-fs],[data-ff]").forEach((inp) => inp.addEventListener("change", () => AMB.pintarMapa(a)));
    p.querySelectorAll("[data-fd]").forEach((b) => (b.onclick = async () => { const f = a.franjas[+b.dataset.fd]; if (!(await confirmar(`¿Borrar la franja ${esc(f.nombre)}?`, "Borrar"))) return; a.franjas.splice(+b.dataset.fd, 1); AMB.cambio(a); AMB.repintar(l, a); }));
    $("#aFr").onclick = () => {
      const ancho = AMB.ancho(a.sembradora);
      Dib.iniciar({ modo: "linea", titulo: `Franja de ensayo · ${fmt(ancho, 1)} m de ancho`, boton: "Crear franja",
        ayuda: "Trazá la línea en el sentido de siembra, de cabecera a cabecera; la franja se recorta al lote. Arrastrá un punto para moverlo · <b>Esc</b> borra el último · <b>Enter</b> crea la franja",
        info: (pts) => { if (pts.length < 2) return ""; let m = 0; for (let i = 1; i < pts.length; i++) m += pts[i - 1].distanceTo(pts[i]); return `<div class="small">Largo <b class="num">${fmt(m, 0)} m</b> · ≈ <b class="num">${fmt((m * ancho) / 1e4, 2)} ha</b></div>`; },
        onDone: (line) => {
          const g = AMB.franjaGeom(l, line, ancho); if (!g) { toast("La franja no cae dentro del lote.", 5000); return; }
          const usados = new Set(a.franjas.map((f) => f.nombre)); let k = 1; while (usados.has("F" + k)) k++;
          const ult = a.franjas[a.franjas.length - 1];
          a.franjas.push({ id: uid(), nombre: "F" + k, linea: line.coordinates, ancho, geom: g, sem: ult?.sem ?? null, fert: ult?.fert ?? null });
          a._vista = "ambientes"; AMB.cambio(a); AMB.repintar(l, a);
          toast(`Franja F${k}: ${fmt(haDe(g), 2)} ha. Cargale la dosis en la lista.`, 5000);
        } });
    };
    $("#aExp").onclick = () => AMB.exportar(l, a);
    $("#aDel").onclick = async () => {
      if (!(await confirmar(`¿Eliminar la ambientación <b>${esc(a.nombre)}</b> con sus dosis y franjas?`))) return;
      const lista = await AMB.lista(l); S.ambLista[l.id] = lista.filter((x) => x.id !== a.id);
      try { await AMB.subirLista(l); } catch (e) { toast("No se pudo borrar: " + e.message, 6000); return; }
      a._sucio = false; clearTimeout(a._t); await AMB.cerrar(); render();
    };
  },

  /* ---------- Vectorizar los ambientes ---------- */
  /* Recorre los bordes de las celdas de cada ambiente y arma polígonos (con huecos) en grados */
  poligonos(a) {
    const g = a.grid, p = AMB.PAD, W = g.W + 2 * p, H = g.H + 2 * p, n = +a.n;
    let G = new Uint8Array(W * H).fill(255);
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) G[(j + p) * W + i + p] = a._cls[j * g.W + i];
    /* Se extiende p celdas hacia afuera del lote con el ambiente vecino, para cubrir las cabeceras */
    for (let it = 0; it < p; it++) {
      const nx = G.slice();
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i; if (G[k] !== 255) continue; const cnt = {}; let best = 255, bn = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= W || y >= H) continue; const c = G[y * W + x]; if (c === 255) continue; cnt[c] = (cnt[c] || 0) + 1; if (cnt[c] > bn) { bn = cnt[c]; best = c; } }
        nx[k] = best;
      }
      G = nx;
    }
    const VW = W + 1; const geo = ([x, y]) => [+(g.bb[0] + (x - p) * g.dLon).toFixed(7), +(g.bb[3] - (y - p) * g.dLat).toFixed(7)];
    const out = [];
    for (let c = 0; c < n; c++) {
      const ed = new Map(); const add = (u, v) => { let s = ed.get(u); if (!s) ed.set(u, (s = [])); s.push(v); };
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        if (G[j * W + i] !== c) continue;
        const v = (x, y) => y * VW + x;
        if (j === 0 || G[(j - 1) * W + i] !== c) add(v(i, j), v(i + 1, j));
        if (i === W - 1 || G[j * W + i + 1] !== c) add(v(i + 1, j), v(i + 1, j + 1));
        if (j === H - 1 || G[(j + 1) * W + i] !== c) add(v(i + 1, j + 1), v(i, j + 1));
        if (i === 0 || G[j * W + i - 1] !== c) add(v(i, j + 1), v(i, j));
      }
      if (!ed.size) continue;
      const xy = (u) => [u % VW, Math.floor(u / VW)];
      const anillos = [];
      for (const [a0, l0] of ed) {
        while (l0.length) {
          let prev = a0, cur = l0.pop(); const r = [a0]; let guard = 0;
          while (cur !== a0 && guard++ < 5e6) {
            r.push(cur); const ops = ed.get(cur); if (!ops || !ops.length) break;
            let pick = 0;
            if (ops.length > 1) {
              const [px, py] = xy(prev), [cx, cy] = xy(cur); const dx = cx - px, dy = cy - py; const rx = -dy, ry = dx;
              let best = 9; ops.forEach((t, ii) => { const [tx, ty] = xy(t); const sx = tx - cx, sy = ty - cy; const pr = sx === rx && sy === ry ? 0 : sx === dx && sy === dy ? 1 : 2; if (pr < best) { best = pr; pick = ii; } });
            }
            prev = cur; cur = ops.splice(pick, 1)[0];
          }
          /* Solo los vértices donde cambia la dirección */
          const m = r.length; const sv = [];
          for (let t = 0; t < m; t++) { const [ax, ay] = xy(r[(t - 1 + m) % m]), [bx, by] = xy(r[t]), [cx, cy] = xy(r[(t + 1) % m]); if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) sv.push([bx, by]); }
          if (sv.length < 3) continue;
          /* Punto de prueba: un cuarto de celda a la derecha del primer borde (adentro del ambiente) */
          const [x0, y0] = xy(r[0]), [x1, y1] = xy(r[1] ?? r[0]); const ddx = x1 - x0, ddy = y1 - y0;
          const prueba = geo([(x0 + x1) / 2 - ddy * 0.25, (y0 + y1) / 2 + ddx * 0.25]);
          const ring = sv.map(geo); ring.push(ring[0]);
          let ar = 0; for (let t = 0; t < ring.length - 1; t++) ar += ring[t][0] * ring[t + 1][1] - ring[t + 1][0] * ring[t][1];
          anillos.push({ ring, area: ar / 2, prueba });
        }
      }
      /* Con la celda siempre a la derecha, los contornos exteriores quedan en sentido horario y los huecos al revés */
      const ext = anillos.filter((x) => x.area < 0).map((x) => ({ ...x, huecos: [] })); const hue = anillos.filter((x) => x.area > 0);
      for (const h of hue) { let best = null; for (const e of ext) if (pip(h.prueba[0], h.prueba[1], [e.ring]) && (!best || -e.area < -best.area)) best = e; if (best) best.huecos.push(h.ring); }
      if (ext.length) out.push({ clase: c, geom: { type: "MultiPolygon", coordinates: ext.map((e) => [e.ring, ...e.huecos]) } });
    }
    return out;
  },

  /* ---------- Shapefile (polígonos, WGS84) ---------- */
  orientar(rings) { return rings.map((r, i) => { let s = 0; for (let t = 0; t < r.length - 1; t++) s += r[t][0] * r[t + 1][1] - r[t + 1][0] * r[t][1]; const horario = s < 0; return (i === 0) === horario ? r : r.slice().reverse(); }); },
  shapefile(feats, campos) {
    const recs = feats.map((f) => { const polys = f.geom.type === "Polygon" ? [f.geom.coordinates] : f.geom.coordinates; const rings = polys.flatMap((pl) => AMB.orientar(pl)); return { rings, n: rings.reduce((s, r) => s + r.length, 0) }; });
    const caja = (pts) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of pts) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } return b; };
    const largo = recs.map((r) => 44 + 4 * r.rings.length + 16 * r.n);
    const shpLen = 100 + largo.reduce((s, x) => s + 8 + x, 0), shxLen = 100 + 8 * recs.length;
    const shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(shxLen));
    const total = caja(recs.flatMap((r) => r.rings.flat()));
    for (const [dv, len] of [[shp, shpLen], [shx, shxLen]]) { dv.setInt32(0, 9994); dv.setInt32(24, len / 2); dv.setInt32(28, 1000, true); dv.setInt32(32, 5, true); total.forEach((v, i) => dv.setFloat64(36 + 8 * i, v, true)); }
    let o = 100;
    recs.forEach((r, i) => {
      shx.setInt32(100 + 8 * i, o / 2); shx.setInt32(104 + 8 * i, largo[i] / 2);
      shp.setInt32(o, i + 1); shp.setInt32(o + 4, largo[i] / 2); o += 8;
      shp.setInt32(o, 5, true); caja(r.rings.flat()).forEach((v, k) => shp.setFloat64(o + 4 + 8 * k, v, true));
      shp.setInt32(o + 36, r.rings.length, true); shp.setInt32(o + 40, r.n, true); let q = o + 44; let ac = 0;
      for (const ring of r.rings) { shp.setInt32(q, ac, true); q += 4; ac += ring.length; }
      for (const ring of r.rings) for (const pt of ring) { shp.setFloat64(q, pt[0], true); shp.setFloat64(q + 8, pt[1], true); q += 16; }
      o += largo[i];
    });
    /* Tabla .dbf (dBase III) */
    const hl = 32 + 32 * campos.length + 1, rl = 1 + campos.reduce((s, c) => s + c.len, 0);
    const dbf = new Uint8Array(hl + rl * feats.length + 1); const dv = new DataView(dbf.buffer); const hoyD = new Date();
    dbf[0] = 3; dbf[1] = hoyD.getFullYear() - 1900; dbf[2] = hoyD.getMonth() + 1; dbf[3] = hoyD.getDate();
    dv.setUint32(4, feats.length, true); dv.setUint16(8, hl, true); dv.setUint16(10, rl, true);
    campos.forEach((c, i) => { const b = 32 + 32 * i; for (let k = 0; k < c.nombre.length; k++) dbf[b + k] = c.nombre.charCodeAt(k); dbf[b + 11] = c.tipo.charCodeAt(0); dbf[b + 16] = c.len; dbf[b + 17] = c.dec || 0; });
    dbf[hl - 1] = 0x0d;
    feats.forEach((f, ri) => {
      let b = hl + ri * rl; dbf[b++] = 0x20;
      for (const c of campos) {
        const v = f.props[c.nombre]; let s;
        if (c.tipo === "N") { s = v == null || !isFinite(v) ? "" : Number(v).toFixed(c.dec || 0); s = s.length > c.len ? "" : s.padStart(c.len, " "); }
        else s = String(v ?? "").normalize("NFD").replace(/[^\x20-\x7e]/g, "").slice(0, c.len).padEnd(c.len, " ");
        for (let k = 0; k < c.len; k++) dbf[b + k] = s.charCodeAt(k); b += c.len;
      }
    });
    dbf[dbf.length - 1] = 0x1a;
    const prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    return { shp: shp.buffer, shx: shx.buffer, dbf: dbf.buffer, prj };
  },
  nombreArchivo(l, a) { const s = `Rx_${l.nombre}_${a.campana || ""}`.normalize("NFD").replace(/[^\w]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""); return s.slice(0, 40); },
  armar(l, a) {
    const n = +a.n, d = AMB.dosis(a), nom = AMB.NOMBRES[n];
    let zonas = AMB.poligonos(a);
    /* Las franjas pisan los ambientes */
    const fr = a.franjas.map((f, i) => { let g = f.geom; for (const o of a.franjas.slice(i + 1)) { try { const r = geoOp("difference", feat(g), feat(o.geom)); g = r ? r.geometry : null; } catch (e) {} if (!g) break; } return { ...f, geomFinal: g }; }).filter((f) => f.geomFinal);
    zonas = zonas.map((z) => { let g = feat(z.geom); for (const f of a.franjas) { if (!g) break; try { g = geoOp("difference", g, feat(f.geom)); } catch (e) { console.warn("diferencia", e); } } return g ? { ...z, geom: g.geometry } : null; }).filter(Boolean);
    const props = (tipo, nombre, sem, fert, geom) => ({ TIPO: tipo, NOMBRE: nombre, SEM_HA: sem || 0, SEM_AC: Math.round((sem || 0) * 0.404686), FERT_KGHA: fert || 0, FERT_LBAC: +((fert || 0) * 0.892179).toFixed(1), HA: +haDe(geom).toFixed(2) });
    const feats = [
      ...zonas.map((z) => ({ geom: z.geom, props: props("Ambiente", `A${z.clase + 1} ${nom[z.clase]}`, d[z.clase].sem, d[z.clase].fert, z.geom) })),
      ...fr.map((f) => ({ geom: f.geomFinal, props: props("Franja", f.nombre, f.sem, f.fert, f.geomFinal) })),
    ];
    const campos = [{ nombre: "TIPO", tipo: "C", len: 10 }, { nombre: "NOMBRE", tipo: "C", len: 16 }, { nombre: "SEM_HA", tipo: "N", len: 10, dec: 0 }, { nombre: "SEM_AC", tipo: "N", len: 10, dec: 0 }, { nombre: "FERT_KGHA", tipo: "N", len: 8, dec: 1 }, { nombre: "FERT_LBAC", tipo: "N", len: 8, dec: 1 }, { nombre: "HA", tipo: "N", len: 10, dec: 2 }];
    return { feats, campos };
  },
  async exportar(l, a) {
    const d = AMB.dosis(a); const sinSem = d.map((x, k) => (x.sem ? null : `A${k + 1}`)).filter(Boolean);
    const frSin = a.franjas.filter((f) => !f.sem).map((f) => f.nombre);
    if (sinSem.length || frSin.length) { toast(`Falta la densidad de semillas en ${[...sinSem, ...frSin].join(", ")}.`, 6000); return; }
    const conFert = d.some((x) => x.fert) || a.franjas.some((f) => f.fert);
    if (conFert && (d.some((x) => !x.fert) || a.franjas.some((f) => !f.fert)) && !(await confirmar("Hay ambientes o franjas sin dosis de fertilizante: ahí el archivo lleva 0 kg/ha. ¿Descargar igual?", "Descargar"))) return;
    const fin = cargando("Armando la prescripción…");
    try {
      const { feats, campos } = AMB.armar(l, a); if (!feats.length) throw new Error("no quedó ningún polígono");
      const f = AMB.shapefile(feats, campos); const nom = AMB.nombreArchivo(l, a);
      const zip = new JSZip(); const dir = zip.folder("SendTo2020");
      dir.file(nom + ".shp", f.shp); dir.file(nom + ".shx", f.shx); dir.file(nom + ".dbf", f.dbf); dir.file(nom + ".prj", f.prj);
      const t = AMB.totales(a, AMB.stats(a));
      zip.file("LEEME.txt", [`Prescripción ${a.nombre} · ${l.nombre} · Flores Chicas`, `Generada el ${fechaAR(hoy())}`, "",
        "1. Copiar la carpeta SendTo2020 a la raíz del pendrive (sin otras carpetas en el medio).",
        "2. En el 20|20: Setup > Data > Import > Prescriptions > Seeding, elegir el archivo e Import. Repetir con Granular para el fertilizante.",
        "3. En Setup > Fields elegir el lote, asignar la prescripción y la columna: SEM_HA (semillas/ha) y FERT_KGHA (kg/ha).",
        "   Con el monitor en unidades imperiales: SEM_AC (semillas/acre) y FERT_LBAC (lb/acre).", "",
        "Dosis:", ...d.map((x, k) => `  A${k + 1} ${AMB.NOMBRES[+a.n][k]}: ${x.sem} semillas/ha · ${x.fert || 0} kg/ha`),
        ...a.franjas.map((f) => `  Franja ${f.nombre}: ${f.sem} semillas/ha · ${f.fert || 0} kg/ha · ${haDe(f.geom).toFixed(2)} ha`), "",
        `Total aproximado: ${Math.round(t.sem).toLocaleString("es-AR")} semillas (${t.bolsas.toFixed(1)} bolsas de 80.000) · ${Math.round(t.fert).toLocaleString("es-AR")} kg de fertilizante`].join("\r\n"));
      descargar(nom + ".zip", await zip.generateAsync({ type: "blob" }), "application/zip");
      a.exportado = new Date().toISOString(); AMB.cambio(a);
      toast(`Listo: ${nom}.zip con ${feats.length} polígonos.`, 6000);
    } catch (e) { console.error(e); toast("No pude armar la prescripción: " + e.message, 7000); } finally { fin(); }
  },
};
S.ambLista = {}; S.ambSel = null; S.ambEd = null; S.ambFr = null;
