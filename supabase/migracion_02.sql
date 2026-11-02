-- =====================================================================
-- Campo Flores Chicas · actualización 2: catálogo de labores e insumos fijos
-- Pegar completo en Supabase > SQL Editor > New query > Run.
-- No borra datos. Se puede volver a correr sin problema.
-- =====================================================================

-- Insumos: nombres alternativos (marcas, como figuran en remitos) y precio de referencia
alter table productos add column if not exists alias jsonb not null default '[]';
alter table productos add column if not exists precio numeric;
alter table productos add column if not exists moneda text default 'USD';

-- Catálogo de labores con precio por ha
create table if not exists labores_tipo (
  id text primary key default gen_random_uuid()::text,
  nombre text not null,
  categoria text,                         -- Siembra, Pulverización, Cosecha, Labranza…
  precios jsonb not null default '[]',    -- [{desde, precio, moneda}] historial; desde null = desde siempre
  insumos jsonb not null default '[]',    -- insumos que lleva normalmente [{producto_id, nombre, dosis, unidad}]
  activo boolean default true,
  notas text,
  creado timestamptz default now()
);

alter table labores add column if not exists labor_tipo_id text references labores_tipo(id) on delete set null;
alter table ordenes add column if not exists labor_tipo_id text references labores_tipo(id) on delete set null;

alter table labores_tipo enable row level security;
drop policy if exists "usuarios del campo" on labores_tipo;
create policy "usuarios del campo" on labores_tipo for all to authenticated using (true) with check (true);

-- Que la app vea las columnas nuevas enseguida
notify pgrst, 'reload schema';
