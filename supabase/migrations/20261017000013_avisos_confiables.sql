-- Avisos confiables (aditiva; depende de 011 y 012):
--  1) Clave del receptor por agente (p. ej. la "Webhook key" de una rutina de Grok Bot): se envía como
--     "Authorization: Bearer <clave>". Solo se escribe (RPC del dueño); nadie la puede leer por la API.
--  2) Los mensajes del dueño desde la PWA también despiertan a las IAs del hilo.
--  3) Destinatarios por hilo + freno anti ping-pong (issue #2): solo las IAs involucradas, no se re-despierta
--     a una IA que no ha abierto el hilo desde su último aviso, y tras 20 mensajes seguidos entre IAs sin que
--     el dueño escriba, el hilo deja de despertar IAs hasta que el dueño intervenga.
--  4) Entrega inmediata y reintentos sin depender del MCP: pg_net llama a "notificar" al encolar un aviso y
--     pg_cron cada minuto reintenta. El secreto interno de la BD se genera aquí en Vault (nunca en git).

-- ============ 1) Clave del receptor ============
alter table public.agentes add column if not exists webhook_clave text
  check (webhook_clave is null or (length(webhook_clave) between 8 and 500 and webhook_clave !~ '[\s]'));
alter table public.agentes add column if not exists webhook_tiene_clave boolean generated always as (webhook_clave is not null) stored;
alter table public.agentes add column if not exists webhook_tiene_secreto boolean generated always as (webhook_secreto is not null) stored;
grant select (webhook_tiene_clave, webhook_tiene_secreto) on public.agentes to authenticated;

create or replace function public.guardar_clave_webhook(p_agente uuid, p_clave text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c text := nullif(trim(p_clave), '');
begin
  if auth.uid() is null or not exists (select 1 from public.agentes where id = p_agente and eliminado_en is null and public.es_dueno(buzon_id)) then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if c is not null and (length(c) < 8 or length(c) > 500 or c ~ '\s') then
    raise exception 'la clave no es valida' using errcode = '22023';
  end if;
  update public.agentes set webhook_clave = c where id = p_agente;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    select buzon_id, 'humano:' || auth.uid(), case when c is null then 'webhook:quitar_clave' else 'webhook:guardar_clave' end, id
      from public.agentes where id = p_agente;
  return c is not null;
end $$;
revoke all on function public.guardar_clave_webhook(uuid, text) from public, anon;
grant execute on function public.guardar_clave_webhook(uuid, text) to authenticated;

-- Al borrar un agente también se olvida su clave del receptor.
create or replace function public.agentes_olvidar_clave() returns trigger language plpgsql as $$
begin
  if new.eliminado_en is not null and old.eliminado_en is null then new.webhook_clave := null; end if;
  return new;
end $$;
drop trigger if exists agentes_olvidar_clave on public.agentes;
create trigger agentes_olvidar_clave before update of eliminado_en on public.agentes
  for each row execute function public.agentes_olvidar_clave();

-- ============ 2) Mensajes del dueño también avisan ============
alter table public.notificaciones add column if not exists origen_humano boolean not null default false;
create index if not exists notificaciones_hilo_idx on public.notificaciones(hilo_id, id);

create or replace function public.encolar_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notificaciones(buzon_id, hilo_id, evento, agente_origen, origen_humano)
    select h.buzon_id, h.id, 'mensaje_nuevo', new.autor_agente, new.autor_agente is null
      from public.hilos h where h.id = new.hilo_id and h.estado <> 'cerrado';
  return new;
end $$;
revoke all on function public.encolar_mensaje() from public, anon, authenticated;

-- ============ 3) Destinatarios + freno anti ping-pong ============
create or replace function public._destinos_webhook(p_id bigint)
returns table(id uuid, webhook_url text, webhook_secreto text, webhook_clave text)
language plpgsql stable security definer set search_path = public as $$
declare n public.notificaciones; h public.hilos; origen uuid; seguidos int;
begin
  select * into n from public.notificaciones where notificaciones.id = p_id;
  if not found or n.evento not in ('hilo_nuevo', 'mensaje_nuevo') then return; end if;
  select * into h from public.hilos where hilos.id = n.hilo_id;
  if not found or h.estado = 'cerrado' then return; end if;
  origen := case when n.origen_humano then null else coalesce(n.agente_origen, h.creado_por_agente) end;
  if n.evento = 'mensaje_nuevo' and not n.origen_humano then
    select count(*) into seguidos from public.mensajes m
     where m.hilo_id = h.id and m.autor_agente is not null and m.creado_en <= n.creado_en
       and m.creado_en > coalesce((select max(x.creado_en) from public.mensajes x
                                    where x.hilo_id = h.id and x.autor_humano is not null and x.creado_en <= n.creado_en), '-infinity');
    if seguidos >= 20 then return; end if;  -- bucle entre IAs: esperamos al dueño
  end if;
  return query
    select a.id, a.webhook_url, a.webhook_secreto, a.webhook_clave
      from public.agentes a
     where a.buzon_id = h.buzon_id and a.eliminado_en is null and a.webhook_url is not null
       and (a.webhook_secreto is not null or a.webhook_clave is not null)
       and a.id is distinct from origen
       and case when n.evento = 'hilo_nuevo' then h.para_agente is null or a.id = h.para_agente
                else a.id in (h.para_agente, h.tomado_por_agente, h.creado_por_agente)
                     or exists (select 1 from public.mensajes m where m.hilo_id = h.id and m.autor_agente = a.id) end
       -- ya se le avisó de este hilo y no lo ha abierto desde entonces: no se le vuelve a despertar
       and (n.evento = 'hilo_nuevo' or not exists (
             select 1 from public.notificaciones p
              where p.hilo_id = h.id and p.id < n.id and ('wh:' || a.id::text) = any(p.entregados)
                and p.creado_en > coalesce((select l.leido_en from public.lecturas l where l.agente_id = a.id and l.hilo_id = h.id), '-infinity')));
end $$;
revoke all on function public._destinos_webhook(bigint) from public, anon, authenticated;
grant execute on function public._destinos_webhook(bigint) to service_role;

-- ============ 4) Entrega inmediata (pg_net) y reintentos (pg_cron) ============
-- Si las extensiones no existen (otro Postgres), todo lo demás sigue funcionando y el MCP sigue avisando.
do $$ begin
  create extension if not exists pg_net;
  create extension if not exists pg_cron;
exception when others then raise notice 'pg_net/pg_cron no disponibles: %', sqlerrm;
end $$;

-- Secreto interno de la BD: aleatorio, en Vault. La función "notificar" lo pide con service_role.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'buzon_secreto_bd') then
    perform vault.create_secret(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 'buzon_secreto_bd', 'Buzón: la BD despierta a notificar');
  end if;
exception when others then raise notice 'vault no disponible: %', sqlerrm;
end $$;

create or replace function public._secreto_bd() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'buzon_secreto_bd' limit 1);
exception when others then return null;
end $$;
revoke all on function public._secreto_bd() from public, anon, authenticated;
grant execute on function public._secreto_bd() to service_role;

-- URL de la función (no es secreta). Se guarda una vez al desplegar:
--   select public._configurar_notificador('https://<proyecto>.supabase.co/functions/v1/notificar');
create table if not exists public.config_interna (clave text primary key, valor text not null);
alter table public.config_interna enable row level security;
alter table public.config_interna force row level security;
revoke all on public.config_interna from public, anon, authenticated;

create or replace function public._despertar_notificador() returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select valor into u from public.config_interna where clave = 'notificar_url';
  if u is null or u !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/notificar$' then return; end if;
  s := public._secreto_bd();
  if s is null then return; end if;
  if not exists (select 1 from public.notificaciones where estado = 'pendiente' and proximo_intento <= now()) then return; end if;
  perform net.http_post(url := u, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-buzon-bd', s), timeout_milliseconds := 30000);
exception when others then raise notice 'no se pudo despertar al notificador: %', sqlerrm;
end $$;
revoke all on function public._despertar_notificador() from public, anon, authenticated;

create or replace function public._configurar_notificador(p_url text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/notificar$' then raise exception 'url no valida'; end if;
  insert into public.config_interna(clave, valor) values ('notificar_url', p_url)
    on conflict (clave) do update set valor = excluded.valor;
  begin
    perform cron.schedule('buzon-notificar', '* * * * *', 'select public._despertar_notificador()');
  exception when others then return 'url guardada; pg_cron no disponible: ' || sqlerrm;
  end;
  return 'listo';
end $$;
revoke all on function public._configurar_notificador(text) from public, anon, authenticated;

-- Al encolar avisos, despertar al notificador de inmediato (pg_net envía después del commit).
create or replace function public.notificaciones_despertar() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public._despertar_notificador(); return null; end $$;
revoke all on function public.notificaciones_despertar() from public, anon, authenticated;
drop trigger if exists notificaciones_despertar on public.notificaciones;
create trigger notificaciones_despertar after insert on public.notificaciones
  for each statement execute function public.notificaciones_despertar();
