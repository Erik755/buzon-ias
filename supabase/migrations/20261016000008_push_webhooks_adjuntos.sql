-- v2: notificaciones push, webhooks por agente y adjuntos. Solo agrega objetos (aditiva).

-- ============ Push (suscripciones del navegador del dueño) ============
create table public.push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  humano_id uuid not null references auth.users(id) on delete cascade,
  -- Solo servicios de push conocidos (anti-SSRF): FCM, Mozilla, Apple y Windows. Mismo filtro en enviarPush.
  endpoint text not null unique check (length(endpoint) <= 1000 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 16 and 30),
  creado_en timestamptz not null default now()
);
create index on public.push_suscripciones(buzon_id);
alter table public.push_suscripciones enable row level security;
alter table public.push_suscripciones force row level security;
revoke all on public.push_suscripciones from anon, authenticated;
grant select, insert, delete on public.push_suscripciones to authenticated;
create policy push_dueno on public.push_suscripciones for all to authenticated
  using (humano_id = auth.uid() and public.es_dueno(buzon_id))
  with check (humano_id = auth.uid() and public.es_dueno(buzon_id));
create or replace function public.limite_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.push_suscripciones where buzon_id = new.buzon_id) >= 10 then
    raise exception 'maximo 10 dispositivos con notificaciones por buzon' using errcode = '54000';
  end if; return new;
end $$;
create trigger push_limite before insert on public.push_suscripciones for each row execute function public.limite_push();

-- ============ Webhook opcional por agente ============
alter table public.agentes add column webhook_url text
  check (webhook_url is null or (webhook_url ~ '^https://[^/@\s]+(/[^\s]*)?$' and length(webhook_url) <= 500));
alter table public.agentes add column webhook_secreto text;
-- El dueño puede poner/quitar la URL, pero nunca leer ni escribir el secreto directamente.
revoke select, update on public.agentes from authenticated;
grant select (id, buzon_id, nombre, creado_en, webhook_url) on public.agentes to authenticated;
grant update (nombre, webhook_url) on public.agentes to authenticated;

-- Genera (o rota) el secreto HMAC y lo devuelve UNA vez al dueño.
create or replace function public.rotar_secreto_webhook(p_agente uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if not exists (select 1 from public.agentes where id = p_agente and public.es_dueno(buzon_id)) then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  s := 'whsec_' || encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
  update public.agentes set webhook_secreto = s where id = p_agente;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    select buzon_id, 'humano:' || auth.uid(), 'webhook:rotar_secreto', id from public.agentes where id = p_agente;
  return s;
end $$;
revoke all on function public.rotar_secreto_webhook(uuid) from public, anon;
grant execute on function public.rotar_secreto_webhook(uuid) to authenticated;

-- ============ Cola de notificaciones (outbox) ============
create table public.notificaciones (
  id bigserial primary key,
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  evento text not null check (evento in ('hilo_nuevo', 'pide_aprobacion')),
  intentos int not null default 0,
  proximo_intento timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'fallida')),
  ultimo_error text,
  entregados text[] not null default '{}', -- destinos ya avisados ('push:<id>', 'wh:<agente>'): los reintentos no duplican
  creado_en timestamptz not null default now()
);
create index on public.notificaciones(estado, proximo_intento);
alter table public.notificaciones enable row level security;
alter table public.notificaciones force row level security;
revoke all on public.notificaciones from anon, authenticated;
grant select on public.notificaciones to authenticated;
create policy notif_leer on public.notificaciones for select to authenticated using (public.es_dueno(buzon_id));

create or replace function public.encolar_notificacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notificaciones(buzon_id, hilo_id, evento) values (new.buzon_id, new.id, 'hilo_nuevo');
  elsif new.estado = 'pide_aprobacion' and old.estado is distinct from 'pide_aprobacion' then
    insert into public.notificaciones(buzon_id, hilo_id, evento) values (new.buzon_id, new.id, 'pide_aprobacion');
  end if;
  return new;
end $$;
create trigger hilos_notificar after insert or update of estado on public.hilos
  for each row execute function public.encolar_notificacion();

-- El notificador (Edge Function con service_role) toma lotes sin pisarse.
create or replace function public._tomar_notificaciones(p_limite int default 20)
returns table(id bigint, buzon_id uuid, hilo_id uuid, evento text, intentos int, creado_por_agente uuid, entregados text[])
language sql security definer set search_path = public as $$
  update public.notificaciones n set intentos = n.intentos + 1,
         proximo_intento = now() + (interval '1 minute' * power(4, n.intentos))
  from public.hilos h
  where n.id in (select id from public.notificaciones where estado = 'pendiente' and proximo_intento <= now()
                 order by id limit least(p_limite, 50) for update skip locked)
    and h.id = n.hilo_id
  returning n.id, n.buzon_id, n.hilo_id, n.evento, n.intentos, h.creado_por_agente, n.entregados;
$$;
create or replace function public._cerrar_notificacion(p_id bigint, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.notificaciones set
    estado = case when p_ok then 'enviada' when intentos >= 3 then 'fallida' else 'pendiente' end,
    ultimo_error = left(p_error, 300) where id = p_id;
$$;
create or replace function public._marcar_entregado(p_id bigint, p_destino text)
returns void language sql security definer set search_path = public as $$
  update public.notificaciones set entregados = array_append(entregados, left(p_destino, 80))
   where id = p_id and not (left(p_destino, 80) = any(entregados));
$$;
revoke all on function public._marcar_entregado(bigint, text) from public, anon, authenticated;
grant execute on function public._marcar_entregado(bigint, text) to service_role;
revoke all on function public._tomar_notificaciones(int), public._cerrar_notificacion(bigint, boolean, text),
  public.encolar_notificacion(), public.limite_push() from public, anon, authenticated;
grant execute on function public._tomar_notificaciones(int), public._cerrar_notificacion(bigint, boolean, text) to service_role;

-- ============ Adjuntos ============
create table public.adjuntos (
  id uuid primary key default gen_random_uuid(),
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  mensaje_id uuid references public.mensajes(id) on delete cascade,
  subido_por_agente uuid references public.agentes(id) on delete set null,
  nombre text not null check (length(nombre) between 1 and 120 and nombre !~ '[/\\]'),
  tipo text not null check (tipo in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','text/markdown')),
  tamano int not null check (tamano between 1 and 3145728),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  ruta text not null unique,
  creado_en timestamptz not null default now()
);
create index on public.adjuntos(hilo_id);
create index on public.adjuntos(buzon_id);
alter table public.adjuntos enable row level security;
alter table public.adjuntos force row level security;
revoke all on public.adjuntos from anon, authenticated;
grant select on public.adjuntos to authenticated;
create policy adjuntos_leer on public.adjuntos for select to authenticated using (public.es_dueno(buzon_id));

-- Registro atómico con cuota (100 MB por buzón). Solo lo llama la Edge Function (service_role).
create or replace function public._registrar_adjunto(p_agente uuid, p_hilo uuid, p_mensaje uuid, p_nombre text, p_tipo text,
  p_tamano int, p_sha256 text, p_ruta text, p_ip text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid; usado bigint; r uuid;
begin
  select a.buzon_id into b from public.agentes a join public.hilos h on h.buzon_id = a.buzon_id
   where a.id = p_agente and h.id = p_hilo;
  if b is null then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  if p_mensaje is not null and not exists (select 1 from public.mensajes where id = p_mensaje and hilo_id = p_hilo) then
    raise exception '404:Mensaje no encontrado en ese hilo'; end if;
  perform pg_advisory_xact_lock(hashtext(b::text));
  select coalesce(sum(tamano),0) into usado from public.adjuntos where buzon_id = b;
  if usado + p_tamano > 104857600 then raise exception '413:Cuota de adjuntos del buzon llena (100 MB)'; end if;
  insert into public.adjuntos(buzon_id, hilo_id, mensaje_id, subido_por_agente, nombre, tipo, tamano, sha256, ruta)
    values (b, p_hilo, p_mensaje, p_agente, p_nombre, p_tipo, p_tamano, p_sha256, p_ruta) returning id into r;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id, ip)
    values (b, 'agente:' || p_agente, 'adjunto:subir', r, case when p_ip ~ '^[0-9a-fA-F:.]+$' then p_ip::inet end);
  return r;
end $$;
-- Autoriza una descarga y la audita. Devuelve la ruta solo si quien pide es del mismo buzón.
create or replace function public._autorizar_descarga(p_adjunto uuid, p_agente uuid, p_humano uuid, p_ip text default null)
returns table(ruta text, nombre text, tipo text) language plpgsql security definer set search_path = public as $$
declare a public.adjuntos;
begin
  select * into a from public.adjuntos where id = p_adjunto;
  if not found
     or (p_agente is not null and not exists (select 1 from public.agentes where id = p_agente and buzon_id = a.buzon_id))
     or (p_humano is not null and not exists (select 1 from public.buzones where id = a.buzon_id and dueno_id = p_humano))
     or (p_agente is null and p_humano is null) then
    raise exception '404:Adjunto no encontrado en tu buzon';
  end if;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id, ip)
    values (a.buzon_id, coalesce('agente:' || p_agente, 'humano:' || p_humano), 'adjunto:descargar', a.id,
            case when p_ip ~ '^[0-9a-fA-F:.]+$' then p_ip::inet end);
  return query select a.ruta, a.nombre, a.tipo;
end $$;
-- Pre-chequeo ANTES de subir a Storage: hilo/mensaje del buzón del agente y cuota disponible.
create or replace function public._verificar_adjunto(p_agente uuid, p_hilo uuid, p_mensaje uuid, p_tamano int)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select a.buzon_id into b from public.agentes a join public.hilos h on h.buzon_id = a.buzon_id where a.id = p_agente and h.id = p_hilo;
  if b is null then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  if p_mensaje is not null and not exists (select 1 from public.mensajes where id = p_mensaje and hilo_id = p_hilo) then
    raise exception '404:Mensaje no encontrado en ese hilo'; end if;
  if (select coalesce(sum(tamano),0) from public.adjuntos where buzon_id = b) + p_tamano > 104857600 then
    raise exception '413:Cuota de adjuntos del buzon llena (100 MB)'; end if;
end $$;
revoke all on function public._verificar_adjunto(uuid,uuid,uuid,int) from public, anon, authenticated;
grant execute on function public._verificar_adjunto(uuid,uuid,uuid,int) to service_role;
revoke all on function public._registrar_adjunto(uuid,uuid,uuid,text,text,int,text,text,text),
  public._autorizar_descarga(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public._registrar_adjunto(uuid,uuid,uuid,text,text,int,text,text,text),
  public._autorizar_descarga(uuid,uuid,uuid,text) to service_role;
-- La Edge Function valida tokens con la misma regla que el MCP.
grant execute on function public._mcp_ctx(text,text,text) to service_role;

-- mcp_leer ahora también lista adjuntos (solo metadatos).
create or replace function public.mcp_leer(p_token text, p_hilo_id uuid default null, p_estado text default null, p_limite int default 20, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; r jsonb;
begin
  a := public._mcp_ctx(p_token, 'leer', p_ip);
  if p_hilo_id is null then
    select coalesce(jsonb_agg(x order by x.creado_en desc), '[]') into r from (
      select id, tipo, titulo, estado, creado_en from public.hilos
       where buzon_id = a.buzon_id and (p_estado is null or estado = p_estado)
       order by creado_en desc limit least(greatest(p_limite,1),100)) x;
    perform public._mcp_audit(a, 'leer:lista', null, p_ip);
    return jsonb_build_object('hilos', r);
  end if;
  select * into h from public.hilos where id = p_hilo_id and buzon_id = a.buzon_id;
  if not found then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  perform public._mcp_audit(a, 'leer:hilo', h.id, p_ip);
  return jsonb_build_object('hilo', to_jsonb(h),
    'mensajes', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'autor', coalesce(ag.nombre,'humano'), 'cuerpo', m.cuerpo, 'creado_en', m.creado_en) order by m.creado_en), '[]')
                 from public.mensajes m left join public.agentes ag on ag.id = m.autor_agente where m.hilo_id = h.id),
    'aprobaciones', (select coalesce(jsonb_agg(jsonb_build_object('decision', decision, 'nota', nota, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.aprobaciones where hilo_id = h.id),
    'adjuntos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'tamano', tamano, 'mensaje_id', mensaje_id, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.adjuntos where hilo_id = h.id));
end $$;

-- ============ Storage: bucket privado ============
-- Sin políticas para anon/authenticated: nadie lee ni escribe directo. Todo pasa por la Edge Function
-- "adjuntos", que valida el buzón, el tipo real y la cuota, firma URLs de 5 min y audita.
insert into storage.buckets (id, name, public) values ('adjuntos', 'adjuntos', false) on conflict (id) do nothing;
