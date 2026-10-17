-- v2: configuración en lenguaje natural. Códigos de configuración (bzc_) de un solo uso y vida corta
-- que la PWA genera y que la IA (o la terminal del usuario) cambia por un token bz_ de agente.
-- Aditiva: solo agrega objetos.

create table public.codigos_config (
  id uuid primary key default gen_random_uuid(),
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  nombre_agente text not null check (length(nombre_agente) between 1 and 60),
  alcances text[] not null default '{crear,leer,responder}' check (alcances <@ array['crear','leer','responder'] and cardinality(alcances) > 0),
  dias_token int not null default 30 check (dias_token between 1 and 90),
  hash_codigo text not null unique check (hash_codigo ~ '^[0-9a-f]{64}$'),
  vence_en timestamptz not null,
  intentos_fallidos int not null default 0,
  usado_en timestamptz,
  agente_creado uuid references public.agentes(id) on delete set null,
  creado_por uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);
create index on public.codigos_config(buzon_id);
alter table public.codigos_config enable row level security;
alter table public.codigos_config force row level security;
revoke all on public.codigos_config from anon, authenticated;
-- El dueño ve el estado de sus códigos (nunca el hash) y puede anularlos.
grant select (id, buzon_id, nombre_agente, alcances, dias_token, vence_en, intentos_fallidos, usado_en, agente_creado, creado_en)
  on public.codigos_config to authenticated;
create policy codigos_dueno on public.codigos_config for select to authenticated using (public.es_dueno(buzon_id));

-- Lo genera la PWA: devuelve el código UNA vez; solo se guarda su SHA-256.
create or replace function public.crear_codigo_config(p_buzon uuid, p_nombre text, p_minutos int default 10,
  p_alcances text[] default '{crear,leer,responder}', p_dias_token int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; r public.codigos_config;
begin
  if auth.uid() is null or not public.es_dueno(p_buzon) then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p_minutos is null or p_minutos not between 1 and 15 then raise exception 'el codigo dura entre 1 y 15 minutos' using errcode = '22023'; end if;
  if (select count(*) from public.codigos_config where buzon_id = p_buzon and usado_en is null and vence_en > now()) >= 5 then
    raise exception 'maximo 5 codigos activos por buzon' using errcode = '54000'; end if;
  c := 'bzc_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.codigos_config(buzon_id, nombre_agente, alcances, dias_token, hash_codigo, vence_en, creado_por)
    values (p_buzon, btrim(p_nombre), p_alcances, p_dias_token, encode(sha256(convert_to(c, 'UTF8')), 'hex'), now() + make_interval(mins => p_minutos), auth.uid())
    returning * into r;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id) values (p_buzon, 'humano:' || auth.uid(), 'codigo_config:crear', r.id);
  return jsonb_build_object('id', r.id, 'codigo', c, 'vence_en', r.vence_en);
end $$;

create or replace function public.anular_codigo_config(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  update public.codigos_config set vence_en = least(vence_en, now()) where id = p_id and public.es_dueno(buzon_id) and usado_en is null
    returning buzon_id into b;
  if b is null then raise exception 'sin permiso o ya usado' using errcode = '42501'; end if;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id) values (b, 'humano:' || auth.uid(), 'codigo_config:anular', p_id);
end $$;

-- Canje: lo llama el servidor MCP (POST /api/canje) con la clave anon. Sin sesión: la credencial es el código.
-- * Un solo uso, caduca en <=15 min, 5 intentos fallidos lo anulan (si el código existe).
-- * Sin límite global (sería un DoS para todos): con 244 bits no hay fuerza bruta posible. El abuso se frena
--   por IP en el borde (regla de Vercel Firewall para /api/canje, ver docs/DESPLIEGUE.md).
-- * Los fallos de formato no se auditan (evita inflar la auditoría con basura anónima).
-- * Todo queda en auditoria. Los fallos devuelven {error} en vez de lanzar excepción para que
--   el contador y la auditoría no se deshagan con la transacción.
create or replace function public.canjear_codigo_config(p_codigo text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.codigos_config; ag uuid; t text; ip inet := case when p_ip ~ '^[0-9a-fA-F:.]+$' then p_ip::inet end;
begin
  if p_codigo is null or p_codigo !~ '^bzc_[0-9a-f]{64}$' then
    return jsonb_build_object('error', '400:Codigo con formato invalido'); end if;
  select * into r from public.codigos_config where hash_codigo = encode(sha256(convert_to(p_codigo, 'UTF8')), 'hex') for update;
  if not found then
    insert into public.auditoria(actor, accion, ip) values ('anonimo', 'codigo_config:canje_fallido', ip);
    return jsonb_build_object('error', '403:Codigo invalido, vencido o ya usado'); end if;
  if r.usado_en is not null or r.vence_en <= now() or r.intentos_fallidos >= 5 then
    update public.codigos_config set intentos_fallidos = intentos_fallidos + 1 where id = r.id;
    insert into public.auditoria(buzon_id, actor, accion, objeto_id, ip) values (r.buzon_id, 'anonimo', 'codigo_config:canje_fallido', r.id, ip);
    return jsonb_build_object('error', '403:Codigo invalido, vencido o ya usado');
  end if;
  insert into public.agentes(buzon_id, nombre) values (r.buzon_id, r.nombre_agente) returning id into ag;
  t := 'bz_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.tokens(agente_id, hash_token, alcances, vence_en)
    values (ag, encode(sha256(convert_to(t, 'UTF8')), 'hex'), r.alcances, now() + make_interval(days => r.dias_token));
  update public.codigos_config set usado_en = now(), agente_creado = ag where id = r.id;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id, ip) values (r.buzon_id, 'agente:' || ag, 'codigo_config:canje_ok', r.id, ip);
  return jsonb_build_object('token', t, 'agente', r.nombre_agente, 'alcances', r.alcances,
    'vence_en', now() + make_interval(days => r.dias_token));
end $$;

revoke all on function public.crear_codigo_config(uuid, text, int, text[], int), public.anular_codigo_config(uuid),
  public.canjear_codigo_config(text, text) from public;
grant execute on function public.crear_codigo_config(uuid, text, int, text[], int), public.anular_codigo_config(uuid) to authenticated;
grant execute on function public.canjear_codigo_config(text, text) to anon, authenticated;
