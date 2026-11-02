-- =====================================================================
-- Campo Flores Chicas · base de datos
-- Pegar completo en Supabase > SQL Editor > New query > Run.
-- Se puede volver a correr sin perder datos.
-- =====================================================================

-- ---------- Lotes y cultivos ----------
create table if not exists lotes (
  id text primary key default gen_random_uuid()::text,
  nombre text not null,
  campo text,
  geom jsonb not null,
  subs jsonb not null default '[]',
  notas text default '',
  creado timestamptz default now()
);

create table if not exists siembras (
  id text primary key default gen_random_uuid()::text,
  lote_id text not null references lotes(id) on delete cascade,
  sub_id text,
  campana text not null,
  cultivo text not null,
  hibrido text,
  fecha date,
  notas text,
  creado timestamptz default now()
);

create table if not exists rindes (
  id text primary key default gen_random_uuid()::text,
  lote_id text not null references lotes(id) on delete cascade,
  campana text, cultivo text, campo text, unidad text, archivo text,
  n integer, stats jsonb, path text,
  creado timestamptz default now()
);

-- ---------- Proveedores, contratistas e insumos ----------
create table if not exists proveedores (
  id text primary key default gen_random_uuid()::text,
  nombre text not null,
  cuit text,
  tipo text default 'proveedor',          -- proveedor | contratista | ambos
  telefono text,
  notas text,
  creado timestamptz default now()
);

create table if not exists productos (
  id text primary key default gen_random_uuid()::text,
  nombre text not null,
  tipo text,                               -- herbicida, insecticida, fungicida, fertilizante, semilla, coadyuvante, combustible, otro
  principio_activo text,
  concentracion text,
  unidad text default 'L',                 -- L | kg | u
  notas text,
  creado timestamptz default now()
);

-- ---------- Comprobantes (facturas, remitos) ----------
create table if not exists comprobantes (
  id text primary key default gen_random_uuid()::text,
  tipo text default 'factura',             -- factura | remito | nota_credito | nota_debito | otro
  letra text,
  numero text,
  fecha date,
  proveedor_id text references proveedores(id) on delete set null,
  proveedor_nombre text,
  cuit text,
  moneda text default 'ARS',
  tipo_cambio numeric,
  total numeric,
  items jsonb not null default '[]',
  mueve_stock boolean default true,
  archivos jsonb not null default '[]',
  estado text default 'borrador',          -- borrador | confirmado
  origen text,                             -- foto | pdf | manual
  ia jsonb,
  notas text,
  campana text,
  creado timestamptz default now(),
  creado_por text
);

-- ---------- Labores y órdenes de trabajo ----------
create table if not exists ordenes (
  id text primary key default gen_random_uuid()::text,
  numero integer,
  lote_id text references lotes(id) on delete set null,
  sub_id text,
  campana text,
  tipo text,
  contratista_id text references proveedores(id) on delete set null,
  contratista text,
  fecha_emision date default current_date,
  fecha_prevista date,
  superficie_ha numeric,
  insumos jsonb not null default '[]',
  indicaciones text,
  estado text default 'pendiente',         -- pendiente | en_curso | realizada | cancelada
  labor_id text,
  creado timestamptz default now(),
  creado_por text
);

create table if not exists labores (
  id text primary key default gen_random_uuid()::text,
  lote_id text references lotes(id) on delete set null,
  sub_id text,
  campana text,
  fecha date,
  tipo text,
  contratista_id text references proveedores(id) on delete set null,
  contratista text,
  superficie_ha numeric,
  costo_ha numeric,
  moneda text default 'USD',
  costo_estado text default 'a_definir',   -- a_definir | acordado
  insumos jsonb not null default '[]',     -- [{producto_id, nombre, dosis, unidad, cantidad}]
  condiciones jsonb not null default '{}', -- viento, temperatura, humedad, caudal, receta, ing. agrónomo, aplicador
  orden_id text references ordenes(id) on delete set null,
  origen text,                             -- manual | dictado | orden
  notas text,
  creado timestamptz default now(),
  creado_por text
);

create index if not exists labores_lote on labores(lote_id, campana);
create index if not exists siembras_lote on siembras(lote_id, campana);
create index if not exists ordenes_estado on ordenes(estado);

-- ---------- Permisos: cualquier usuario con cuenta en el sistema ve y edita todo ----------
do $$
declare t text;
begin
  foreach t in array array['lotes','siembras','rindes','proveedores','productos','comprobantes','ordenes','labores'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "usuarios del campo" on %I', t);
    execute format('create policy "usuarios del campo" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Archivos: fotos y PDF de comprobantes, puntos de mapas de rinde ----------
insert into storage.buckets (id, name, public)
values ('comprobantes','comprobantes', false), ('rindes','rindes', false)
on conflict (id) do nothing;

drop policy if exists "usuarios del campo leen archivos" on storage.objects;
drop policy if exists "usuarios del campo suben archivos" on storage.objects;
drop policy if exists "usuarios del campo cambian archivos" on storage.objects;
drop policy if exists "usuarios del campo borran archivos" on storage.objects;
create policy "usuarios del campo leen archivos" on storage.objects for select to authenticated using (bucket_id in ('comprobantes','rindes'));
create policy "usuarios del campo suben archivos" on storage.objects for insert to authenticated with check (bucket_id in ('comprobantes','rindes'));
create policy "usuarios del campo cambian archivos" on storage.objects for update to authenticated using (bucket_id in ('comprobantes','rindes'));
create policy "usuarios del campo borran archivos" on storage.objects for delete to authenticated using (bucket_id in ('comprobantes','rindes'));
