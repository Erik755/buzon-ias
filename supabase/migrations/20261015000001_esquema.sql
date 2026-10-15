-- Buzón compartido de tus IAs: esquema base (Semana 1)
create extension if not exists pgcrypto;

create table public.buzones (
  id uuid primary key default gen_random_uuid(),
  dueno_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 120),
  creado_en timestamptz not null default now()
);
create table public.agentes (
  id uuid primary key default gen_random_uuid(),
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 60),
  creado_en timestamptz not null default now()
);
create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references public.agentes(id) on delete cascade,
  hash_token text not null unique check (hash_token ~ '^[0-9a-f]{64}$'),
  alcances text[] not null default '{crear,leer,responder}'
    check (alcances <@ array['crear','leer','responder']),
  vence_en timestamptz not null default now() + interval '30 days',
  revocado_en timestamptz,
  ultimo_uso timestamptz,
  creado_en timestamptz not null default now()
);
create table public.hilos (
  id uuid primary key default gen_random_uuid(),
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  tipo text not null check (tipo in ('tarea','decision','avance')),
  titulo text not null check (length(titulo) between 1 and 200),
  contexto text check (length(contexto) <= 20000),
  estado text not null default 'abierto' check (estado in
    ('abierto','tomado','pide_aprobacion','aprobado','rechazado','cerrado')),
  creado_por_agente uuid references public.agentes(id) on delete set null,
  tomado_por_agente uuid references public.agentes(id) on delete set null,
  creado_en timestamptz not null default now()
);
create table public.mensajes (
  id uuid primary key default gen_random_uuid(),
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  autor_agente uuid references public.agentes(id) on delete set null,
  autor_humano uuid references auth.users(id) on delete set null,
  cuerpo text not null check (length(cuerpo) between 1 and 20000),
  creado_en timestamptz not null default now(),
  check (num_nonnulls(autor_agente, autor_humano) = 1)
);
create table public.aprobaciones (
  id uuid primary key default gen_random_uuid(),
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  humano_id uuid not null references auth.users(id),
  decision text not null check (decision in ('aprobado','rechazado')),
  nota text check (length(nota) <= 2000),
  creado_en timestamptz not null default now()
);
create table public.auditoria (
  id bigserial primary key,
  buzon_id uuid,
  actor text not null,
  accion text not null,
  objeto_id uuid,
  ip inet,
  creado_en timestamptz not null default now()
);
create index on public.agentes(buzon_id);
create index on public.tokens(agente_id);
create index on public.hilos(buzon_id, estado);
create index on public.mensajes(hilo_id);
create index on public.aprobaciones(hilo_id);
create index on public.auditoria(buzon_id, creado_en);

-- helper: ¿el usuario actual es dueño del buzón?
create or replace function public.es_dueno(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.buzones where id = b and dueno_id = auth.uid());
$$;
revoke all on function public.es_dueno(uuid) from public;
grant execute on function public.es_dueno(uuid) to authenticated;
