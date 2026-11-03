// Función "ia" de Campo Flores Chicas.
// Lee fotos y PDF de comprobantes, interpreta labores dictadas y responde consultas sobre un lote.
// Necesita el secreto ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODELO = Deno.env.get("MODELO") ?? "claude-sonnet-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function b64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function claude(body: Record<string, unknown>) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Falta configurar la clave ANTHROPIC_API_KEY en Supabase.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, ...body }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `Error ${r.status} de la API de Claude`);
  return j;
}
const usoHerramienta = (j: any) => j.content.find((c: any) => c.type === "tool_use")?.input;

// ---------- Esquemas de respuesta ----------
const TIPOS_PRODUCTO = ["herbicida", "insecticida", "fungicida", "fertilizante", "semilla", "coadyuvante", "combustible", "servicio", "otro"];
const TOOL_COMPROBANTE = {
  name: "registrar_comprobante",
  description: "Registra los datos leídos de una factura, remito o nota de crédito de un proveedor agropecuario.",
  input_schema: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: ["factura", "remito", "nota_credito", "nota_debito", "otro"] },
      letra: { type: ["string", "null"], description: "A, B, C, M o R. null si no figura." },
      numero: { type: ["string", "null"], description: "Punto de venta y número, ej. 0003-00012345" },
      fecha: { type: ["string", "null"], description: "Fecha de emisión YYYY-MM-DD" },
      proveedor: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del emisor tal como figura en el comprobante" },
          cuit: { type: ["string", "null"], description: "CUIT del emisor, solo dígitos" },
          id: { type: ["string", "null"], description: "id del proveedor de la lista del usuario que corresponde (por CUIT, o por nombre aunque esté escrito distinto o sea el nombre de fantasía). null si no está en la lista." },
        },
        required: ["nombre"],
      },
      moneda: { type: "string", enum: ["ARS", "USD"] },
      tipo_cambio: { type: ["number", "null"], description: "Tipo de cambio si el comprobante lo informa" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string" },
            cantidad: { type: "number", description: "Cantidad en la unidad indicada. Convertí envases a litros o kilos cuando se pueda (10 bidones de 20 L = 200 L)." },
            unidad: { type: "string", enum: ["L", "kg", "u", "ha", "otro"] },
            precio_unitario: { type: ["number", "null"], description: "Precio por unidad sin IVA, en la unidad de 'unidad'. null en remitos sin precio." },
            alicuota_iva: { type: ["number", "null"], description: "Porcentaje, ej. 10.5 o 21" },
            subtotal: { type: ["number", "null"], description: "Importe neto del renglón sin IVA" },
            tipo_producto: { type: "string", enum: TIPOS_PRODUCTO },
            principio_activo: { type: ["string", "null"] },
            concentracion: { type: ["string", "null"], description: "ej. 62% o 480 g/L" },
            producto_id: { type: ["string", "null"], description: "id del insumo de la lista del usuario al que corresponde este renglón, aunque figure con otra marca o nombre comercial (mismo principio activo y concentración). null si no hay uno que corresponda con seguridad." },
          },
          required: ["descripcion", "cantidad", "unidad", "tipo_producto"],
        },
      },
      remitos_referenciados: { type: "array", items: { type: "string" }, description: "Números de remito que la factura menciona (ej. 'Remito 0001-00004567'). Vacío si no menciona ninguno." },
      neto: { type: ["number", "null"] },
      iva: { type: ["number", "null"] },
      total: { type: ["number", "null"] },
      observaciones: { type: ["string", "null"], description: "Datos dudosos o ilegibles que el usuario debería revisar" },
    },
    required: ["tipo", "proveedor", "moneda", "items"],
  },
};

const TIPOS_LABOR = ["Siembra", "Pulverización", "Fertilización", "Cosecha", "Labranza", "Rolo", "Picado", "Enfardado", "Desmalezado", "Otra"];
const TOOL_LABORES = {
  name: "registrar_labores",
  description: "Registra una o más labores agrícolas descriptas por el usuario.",
  input_schema: {
    type: "object",
    properties: {
      labores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            lote_id: { type: ["string", "null"], description: "id del lote de la lista; null si no se puede identificar" },
            sub_id: { type: ["string", "null"], description: "id del sector si se menciona uno" },
            labor_tipo_id: { type: ["string", "null"], description: "id de la labor del catálogo que corresponde (ej. 'pulverizamos' → la pulverización terrestre si no se dice aérea); null si no está claro" },
            fecha: { type: "string", description: "YYYY-MM-DD. Interpretá 'ayer', 'el martes', etc. respecto de la fecha de hoy." },
            tipo: { type: "string", enum: TIPOS_LABOR },
            contratista_id: { type: ["string", "null"] },
            contratista: { type: ["string", "null"] },
            superficie_ha: { type: ["number", "null"], description: "Solo si se dice; si no, null" },
            costo_ha: { type: ["number", "null"] },
            moneda: { type: ["string", "null"], description: "USD o ARS si se dice el precio" },
            insumos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  producto_id: { type: ["string", "null"] },
                  nombre: { type: "string" },
                  dosis: { type: ["number", "null"] },
                  unidad: { type: "string", enum: ["L/ha", "cc/ha", "kg/ha", "g/ha", "u/ha"] },
                },
                required: ["nombre", "unidad"],
              },
            },
            condiciones: {
              type: "object",
              properties: {
                viento_kmh: { type: ["number", "null"] }, direccion_viento: { type: ["string", "null"] },
                temperatura: { type: ["number", "null"] }, humedad: { type: ["number", "null"] },
                caudal_lha: { type: ["number", "null"] }, receta: { type: ["string", "null"] },
              },
            },
            notas: { type: ["string", "null"] },
            dudas: { type: ["string", "null"], description: "Qué no quedó claro y conviene revisar" },
          },
          required: ["fecha", "tipo", "insumos"],
        },
      },
    },
    required: ["labores"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Iniciá sesión para usar esta función." }, 401);
    const b = await req.json();

    if (b.accion === "comprobante") {
      const contenido: unknown[] = [];
      for (const a of b.archivos ?? []) {
        const { data, error } = await sb.storage.from("comprobantes").download(a.path);
        if (error || !data) throw new Error("No pude leer el archivo " + a.path);
        const datos = b64(await data.arrayBuffer());
        const tipo = data.type || a.tipo || "";
        if (tipo.includes("pdf")) contenido.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: datos } });
        else contenido.push({ type: "image", source: { type: "base64", media_type: tipo.startsWith("image/") ? tipo : "image/jpeg", data: datos } });
      }
      contenido.push({
        type: "text",
        text: "Leé este comprobante de un proveedor de un establecimiento agropecuario de Argentina y registrá sus datos. " +
          "Si hay varias imágenes son páginas del mismo comprobante. Los precios unitarios van sin IVA. " +
          "Si un dato no se lee con seguridad, ponelo en null y mencionalo en observaciones. " +
          (b.contexto?.proveedores?.length ? "Proveedores de la lista del usuario (para proveedor.id): " + JSON.stringify(b.contexto.proveedores) + ". " : "") +
          (b.contexto?.productos?.length ? "Insumos de la lista del usuario (para producto_id; la cantidad va en la unidad de ese insumo): " + JSON.stringify(b.contexto.productos) : ""),
      });
      const j = await claude({
        max_tokens: 4096,
        tools: [TOOL_COMPROBANTE],
        tool_choice: { type: "tool", name: "registrar_comprobante" },
        messages: [{ role: "user", content: contenido }],
      });
      return json({ datos: usoHerramienta(j) });
    }

    if (b.accion === "dictado") {
      const j = await claude({
        max_tokens: 3000,
        tools: [TOOL_LABORES],
        tool_choice: { type: "tool", name: "registrar_labores" },
        system:
          "Sos el asistente de carga de labores de un establecimiento agropecuario en Lobería, provincia de Buenos Aires. " +
          "Interpretás lo que el usuario dictó (puede tener errores del dictado por voz) y lo convertís en labores. " +
          "Asociá lotes, productos y contratistas con los de las listas usando sus id; si no hay coincidencia clara dejá el id en null y escribí el nombre. " +
          "Las dosis de herbicidas se dicen en litros o cc por hectárea; las de fertilizantes y semillas en kilos por hectárea.\n" +
          "Fecha de hoy: " + b.hoy + ". Campaña actual: " + b.campana + ".\n" +
          "Lotes: " + JSON.stringify(b.contexto?.lotes ?? []) + "\n" +
          "Catálogo de labores: " + JSON.stringify(b.contexto?.labores_catalogo ?? []) + "\n" +
          "Productos: " + JSON.stringify(b.contexto?.productos ?? []) + "\n" +
          "Contratistas: " + JSON.stringify(b.contexto?.contratistas ?? []),
        messages: [{ role: "user", content: String(b.texto ?? "").slice(0, 6000) }],
      });
      return json({ datos: usoHerramienta(j) });
    }

    if (b.accion === "consulta") {
      const j = await claude({
        max_tokens: 1500,
        system:
          "Respondés consultas sobre un lote de un establecimiento agropecuario de Lobería (Buenos Aires) usando solo los datos que se te pasan. " +
          "Contestá en español rioplatense, breve y concreto, con cifras cuando las haya. Si el dato no está, decilo.\n" +
          "Datos del lote: " + JSON.stringify(b.contexto).slice(0, 60000),
        messages: [{ role: "user", content: String(b.pregunta ?? "").slice(0, 2000) }],
      });
      return json({ texto: j.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
