# Flores Chicas · Gestión agrícola

Aplicación web para el campo: mapa de lotes, cultivos por campaña, mapas de rinde, NDVI, labores, aplicaciones de agroquímicos, órdenes de trabajo y comprobantes leídos desde una foto o un PDF.

Funciona en la computadora y en el teléfono, donde se instala como una app. Los datos quedan en una base compartida en internet, así que todos los usuarios ven lo mismo.

## Cómo está armada

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `docs/` | GitHub Pages | La aplicación que se abre en el navegador. |
| `supabase/schema.sql` | Supabase | Crea las tablas, los permisos y las carpetas de archivos. |
| `supabase/functions/ia/` | Supabase | Lee comprobantes, interpreta labores dictadas y responde consultas por lote. Usa la API de Claude. |

Si `docs/js/config.js` está vacío, la app arranca en **modo prueba**. En ese modo guarda todo en el navegador donde la abrís, no tiene usuarios y no lee comprobantes automáticamente. Sirve para probarla antes de configurar nada.

## Puesta en marcha (una sola vez, unos 30 minutos)

### 1. Supabase: base de datos y archivos

1. Entrá a <https://supabase.com>, creá una cuenta y después un proyecto nuevo. Región: São Paulo (`sa-east-1`). Guardá la contraseña de la base que te pide.
2. En el menú de la izquierda, entrá a **SQL Editor** y tocá **New query**.
3. Pegá todo el contenido de `supabase/schema.sql` y tocá **Run**. Tiene que decir *Success*. Si es una instalación nueva, con esto alcanza; `migracion_02.sql` es solo para bases creadas antes del catálogo de labores.
4. Entrá a **Project Settings → API** y copiá dos datos:
   - **Project URL**, que tiene la forma `https://xxxx.supabase.co`.
   - **anon public key**, una clave larga que empieza con `eyJ…`.
5. Pegá esos dos datos en `docs/js/config.js`.

### 2. Usuarios

1. En **Authentication → Users**, tocá **Add user → Create new user**. Cargá el correo y la contraseña de cada persona que va a usar la app y tildá *Auto Confirm User*.
2. En **Authentication → Sign In / Providers**, desactivá **Allow new users to sign up**. Así nadie se puede registrar por su cuenta.

Todos los usuarios ven y editan todo. Los permisos por persona quedan para más adelante.

### 3. Lectura de comprobantes con IA

1. Entrá a <https://console.anthropic.com>, creá una cuenta y cargá crédito en **Billing**. Con US$ 10 alcanza para cientos de comprobantes.
2. En **API Keys**, creá una clave nueva y copiala.
3. En Supabase, entrá a **Edge Functions → Secrets** y agregá un secreto con nombre `ANTHROPIC_API_KEY` y la clave como valor.
4. En **Edge Functions**, tocá **Deploy a new function → Via Editor**. Ponele de nombre `ia`, pegá el contenido de `supabase/functions/ia/index.ts` y tocá **Deploy**.

### 4. Publicar la página (GitHub Pages)

1. En GitHub, creá un repositorio nuevo llamado `campo-flores-chicas`. Puede ser **privado** si tenés GitHub Pro; si no, tiene que ser público. El código no contiene datos del campo, y la clave `anon` está pensada para ir en la página.
2. Subí todo el contenido de esta carpeta con **Add file → Upload files**.
3. En **Settings → Pages**, elegí *Deploy from a branch*, la rama `main` y la carpeta `/docs`. Guardá.
4. En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/campo-flores-chicas/`.
5. Volvé a Supabase, a **Authentication → URL Configuration**, y poné esa dirección en **Site URL**. Hace falta para que funcione "Olvidé mi contraseña".

### 5. En el teléfono

Abrí la dirección en Chrome (Android) o Safari (iPhone) e ingresá con tu usuario. Después:

- **Android:** menú ⋮ → *Agregar a la pantalla principal*.
- **iPhone:** botón Compartir → *Agregar a inicio*.

### 6. Pasar los lotes del mapa anterior

1. En el archivo `Campo_Flores_Chicas.html` anterior, entrá a **Proyecto → Exportar proyecto completo**.
2. En la app nueva, entrá a **☰ → Importar datos** y elegí ese archivo. Se pasan los lotes, los sectores, los cultivos y los mapas de rinde.

## Actualizaciones

Cuando una versión nueva necesita cambios en la base o en la función de IA, se avisa acá.

**Actualización 2 (catálogo de labores e insumos fijos)**

1. En Supabase, entrá a **SQL Editor → New query**, pegá todo `supabase/migracion_02.sql` y tocá **Run**.
2. En **Edge Functions → ia → Code**, reemplazá todo el código por el de `supabase/functions/ia/index.ts` y tocá **Deploy**.

Mientras no se corra el paso 1, la app muestra un aviso rojo y no deja guardar el catálogo.

## Cómo se usa

- **Cargar (botón +):** es la pantalla de inicio en el teléfono. Desde ahí sacás fotos de comprobantes, subís facturas en PDF, dictás labores y armás órdenes de trabajo.
- **Comprobantes:**
  - Cada foto o PDF se sube y se lee con IA: tipo, número, fecha, proveedor y CUIT, y cada renglón con producto, cantidad y precio.
  - Antes de confirmarlo lo revisás al lado de la imagen.
  - Al confirmar se crean solos el proveedor y los productos nuevos.
  - Si una factura corresponde a un remito que ya cargaste, destildá **Ingresa mercadería al stock** para no contar dos veces la misma mercadería.
- **Catálogo de labores:**
  - Es la lista fija de labores (pulverización terrestre, cosecha, disco, fertilización…), cada una con su precio por ha y los insumos que lleva normalmente.
  - Al cargar una labor en un lote se elige del catálogo: toma el precio y propone los insumos.
  - Para cambiar una tarifa, tocá la labor y **Cambiar precio**, eligiendo desde qué fecha rige. Las labores anteriores conservan su precio.
- **Labores:** si una labor necesita otro precio, se lo podés poner solo a ella. Si queda "a definir", después se le pone precio desde la lista de labores.
- **Dictar labor:** en el teléfono, tocá el micrófono del teclado y contá lo que se hizo. La IA arma la labor con el lote, los productos, las dosis y el contratista, y vos la revisás antes de guardarla.
- **Aplicaciones:** es el registro de pulverizaciones, con productos, dosis, total aplicado, condiciones, receta agronómica e ingeniero agrónomo. Se exporta a CSV.
- **Órdenes de trabajo:**
  - Se imprimen o se mandan por WhatsApp. Si cargás el teléfono del contratista, se abre el chat con él.
  - Al marcarla realizada, la orden se convierte en una labor.
- **Ficha del lote (en el mapa):** muestra las labores y costos de la campaña, y tiene la opción **Preguntar sobre este lote**, que responde con los datos cargados.
- **Insumos y stock del galpón:**
  - Es la lista fija de insumos. En labores, órdenes y catálogo se eligen siempre de esta lista.
  - El stock sube al confirmar remitos y facturas, y baja al cargar labores. **Ajustar stock** sirve para cargar el inventario inicial o corregir lo contado en el galpón.
  - El precio vigente es el de la última factura; si todavía no hay factura, se usa el precio de referencia cargado a mano.
- **Remitos con otra marca:**
  - Cada renglón del remito se asigna a un insumo de tu lista. Si el nombre ya se vio antes, se reconoce solo.
  - Si es nuevo, la IA sugiere a qué insumo corresponde y la app te pregunta antes de confirmarlo.
  - Lo que elegís queda guardado como nombre alternativo del insumo.

## Costos

- **Supabase y GitHub Pages:** los planes gratuitos alcanzan para empezar. El plan gratuito de Supabase pausa el proyecto si pasa una semana sin uso; se reactiva desde el panel.
- **API de Claude:** se paga por uso. Leer un comprobante cuesta del orden de unos centavos de dólar.

## Próximas etapas

- Recibir fotos de comprobantes y audios por WhatsApp. Hace falta una cuenta de WhatsApp Business (Meta) y un servicio de transcripción para los audios.
- Márgenes por lote: rinde × precio menos costos.
- Gestión ganadera y de la cabaña.
