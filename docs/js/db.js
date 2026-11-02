"use strict";
/* Capa de datos. Con Supabase configurado usa la base compartida; si no, guarda en este navegador (modo prueba). */
const TABLAS = {
  lotes: ["id", "nombre", "campo", "geom", "subs", "notas", "creado"],
  siembras: ["id", "lote_id", "sub_id", "campana", "cultivo", "hibrido", "fecha", "notas", "creado"],
  rindes: ["id", "lote_id", "campana", "cultivo", "campo", "unidad", "archivo", "n", "stats", "path", "creado"],
  proveedores: ["id", "nombre", "cuit", "tipo", "telefono", "notas", "creado"],
  productos: ["id", "nombre", "tipo", "principio_activo", "concentracion", "unidad", "notas", "creado"],
  comprobantes: ["id", "tipo", "letra", "numero", "fecha", "proveedor_id", "proveedor_nombre", "cuit", "moneda", "tipo_cambio", "total", "items", "mueve_stock", "archivos", "estado", "origen", "ia", "notas", "campana", "creado", "creado_por"],
  ordenes: ["id", "numero", "lote_id", "sub_id", "campana", "tipo", "contratista_id", "contratista", "fecha_emision", "fecha_prevista", "superficie_ha", "insumos", "indicaciones", "estado", "labor_id", "creado", "creado_por"],
  labores: ["id", "lote_id", "sub_id", "campana", "fecha", "tipo", "contratista_id", "contratista", "superficie_ha", "costo_ha", "moneda", "costo_estado", "insumos", "condiciones", "orden_id", "origen", "notas", "creado", "creado_por"],
};
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function limpiarFila(t, f) {
  const o = {};
  for (const c of TABLAS[t]) if (f[c] !== undefined) o[c] = f[c] === "" && /fecha|_id$|numero$|costo_ha|superficie|tipo_cambio|total/.test(c) ? null : f[c];
  return o;
}

/* ---------- Modo prueba: IndexedDB ---------- */
const Local = {
  db: null,
  abrir() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open("campo-flores-chicas-app", 1);
        r.onupgradeneeded = () => {
          for (const t of Object.keys(TABLAS)) r.result.createObjectStore(t, { keyPath: "id" });
          r.result.createObjectStore("archivos");
          r.result.createObjectStore("kv");
        };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  st(n, m) { return this.db.transaction(n, m).objectStore(n); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
};

const DB = {
  modo: "local",
  sb: null,
  usuario: null,
  async iniciar() {
    const c = window.CONFIG || {};
    if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY && window.supabase) {
      this.modo = "nube";
      this.sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
      const { data } = await this.sb.auth.getSession();
      this.usuario = data.session?.user || null;
    } else {
      await Local.abrir();
      this.usuario = { email: "modo prueba" };
    }
  },
  async entrar(email, clave) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: clave });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
    this.usuario = data.user;
  },
  async recuperar(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
    if (error) throw error;
  },
  async cambiarClave(clave) { const { error } = await this.sb.auth.updateUser({ password: clave }); if (error) throw error; },
  async salir() { if (this.sb) await this.sb.auth.signOut(); this.usuario = null; },

  async listar(t) {
    if (this.modo === "local") return Local.db ? Local.req(Local.st(t, "readonly").getAll()) : [];
    let out = [], i = 0;
    for (;;) {
      const { data, error } = await this.sb.from(t).select("*").range(i, i + 999);
      if (error) throw new Error(`No pude leer ${t}: ${error.message}`);
      out = out.concat(data);
      if (data.length < 1000) break;
      i += 1000;
    }
    return out;
  },
  async guardar(t, fila) {
    if (!fila.id) fila.id = nuevoId();
    if (!fila.creado) fila.creado = new Date().toISOString();
    if (TABLAS[t].includes("creado_por") && !fila.creado_por) fila.creado_por = this.usuario?.email || null;
    const f = limpiarFila(t, fila);
    if (this.modo === "local") { await Local.req(Local.st(t, "readwrite").put(JSON.parse(JSON.stringify(f)))); return fila; }
    const { error } = await this.sb.from(t).upsert(f);
    if (error) throw new Error(`No se pudo guardar: ${error.message}`);
    return fila;
  },
  async guardarVarios(t, filas) {
    if (this.modo === "local") { for (const f of filas) await this.guardar(t, f); return; }
    for (const f of filas) { if (!f.id) f.id = nuevoId(); if (!f.creado) f.creado = new Date().toISOString(); }
    for (let i = 0; i < filas.length; i += 200) {
      const { error } = await this.sb.from(t).upsert(filas.slice(i, i + 200).map((f) => limpiarFila(t, f)));
      if (error) throw new Error(`No se pudo guardar: ${error.message}`);
    }
  },
  async borrar(t, id) {
    if (this.modo === "local") return Local.req(Local.st(t, "readwrite").delete(id));
    const { error } = await this.sb.from(t).delete().eq("id", id);
    if (error) throw new Error(`No se pudo borrar: ${error.message}`);
  },
  async subir(bucket, path, blob) {
    if (this.modo === "local") { await Local.req(Local.st("archivos", "readwrite").put(blob, bucket + "/" + path)); return path; }
    const { error } = await this.sb.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type || "application/octet-stream" });
    if (error) throw new Error("No se pudo subir el archivo: " + error.message);
    return path;
  },
  async bajar(bucket, path) {
    if (this.modo === "local") return Local.req(Local.st("archivos", "readonly").get(bucket + "/" + path));
    const { data, error } = await this.sb.storage.from(bucket).download(path);
    if (error) throw new Error("No se pudo descargar el archivo.");
    return data;
  },
  async url(bucket, path) {
    if (this.modo === "local") { const b = await this.bajar(bucket, path); return b ? URL.createObjectURL(b) : null; }
    const { data } = await this.sb.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  },
  async borrarArchivo(bucket, path) {
    if (this.modo === "local") return Local.req(Local.st("archivos", "readwrite").delete(bucket + "/" + path));
    await this.sb.storage.from(bucket).remove([path]);
  },
  async ia(accion, datos) {
    if (this.modo === "local") throw new Error("La lectura automática funciona cuando la app está conectada a Supabase con la clave de Claude. En modo prueba cargá los datos a mano.");
    const { data, error } = await this.sb.functions.invoke("ia", { body: { accion, ...datos } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

/* Caché local (NDVI, preferencias). Siempre en este navegador. */
const Cache = {
  db: null,
  abrir() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open("campo-flores-chicas-cache", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  get(k) { if (!this.db) return Promise.resolve(undefined); return new Promise((res) => { const r = this.db.transaction("kv", "readonly").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); },
  set(k, v) { if (!this.db) return Promise.resolve(); return new Promise((res) => { const r = this.db.transaction("kv", "readwrite").objectStore("kv").put(v, k); r.onsuccess = r.onerror = () => res(); }); },
};
