-- 014: frenos de avisos (Auditor B2, B3). Aditiva: reemplaza dos funciones de la 013.
-- B2: tope de hilos nuevos por IA sin intervención humana (las IAs no se despiertan creando hilos en vez de responder).
-- B3: el despertar por pg_net se limita a uno cada 5 s (el cron de cada minuto recoge lo que quede).

create or replace function public._destinos_webhook(p_id bigint)
returns table(id uuid, webhook_url text, webhook_secreto text, webhook_clave text)
language plpgsql stable security definer set search_path = public as $$
declare n public.notificaciones; h public.hilos; origen uuid; seguidos int; nuevos int;
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
  -- B2: más de 10 hilos nuevos de la misma IA en una hora, sin que el dueño escriba en el buzón: no se despierta a nadie.
  if n.evento = 'hilo_nuevo' and origen is not null then
    select count(*) into nuevos from public.hilos x
     where x.buzon_id = h.buzon_id and x.creado_por_agente = origen
       and x.creado_en <= h.creado_en and x.creado_en > h.creado_en - interval '1 hour'
       and x.creado_en > coalesce((select max(m.creado_en) from public.mensajes m join public.hilos y on y.id = m.hilo_id
                                    where y.buzon_id = h.buzon_id and m.autor_humano is not null and m.creado_en <= h.creado_en), '-infinity');
    if nuevos > 10 then return; end if;
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
       and (n.evento = 'hilo_nuevo' or not exists (
             select 1 from public.notificaciones p
              where p.hilo_id = h.id and p.id < n.id and ('wh:' || a.id::text) = any(p.entregados)
                and p.creado_en > coalesce((select l.leido_en from public.lecturas l where l.agente_id = a.id and l.hilo_id = h.id), '-infinity')));
end $$;
revoke all on function public._destinos_webhook(bigint) from public, anon, authenticated;
grant execute on function public._destinos_webhook(bigint) to service_role;

create or replace function public._despertar_notificador() returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text; ult timestamptz;
begin
  select valor into u from public.config_interna where clave = 'notificar_url';
  if u is null or u !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/notificar$' then return; end if;
  if not exists (select 1 from public.notificaciones where estado = 'pendiente' and proximo_intento <= now()) then return; end if;
  -- B3: si otra transacción está despertando ahora, o hubo un despertar hace < 5 s, no se repite.
  if not pg_try_advisory_xact_lock(hashtext('buzon_despertar')) then return; end if;
  select valor::timestamptz into ult from public.config_interna where clave = 'ultimo_despertar';
  if ult is not null and ult > clock_timestamp() - interval '5 seconds' then return; end if;
  s := public._secreto_bd();
  if s is null then return; end if;
  insert into public.config_interna(clave, valor) values ('ultimo_despertar', clock_timestamp()::text)
    on conflict (clave) do update set valor = excluded.valor;
  perform net.http_post(url := u, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-buzon-bd', s), timeout_milliseconds := 30000);
exception when others then raise notice 'no se pudo despertar al notificador: %', sqlerrm;
end $$;
revoke all on function public._despertar_notificador() from public, anon, authenticated;

-- QA (bajo 2): guardar dirección y clave en una sola transacción. p_clave null/'' = no tocar la clave.
create or replace function public.guardar_webhook(p_agente uuid, p_url text, p_clave text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare u text := nullif(trim(p_url), ''); c text := nullif(trim(p_clave), '');
begin
  if auth.uid() is null or not exists (select 1 from public.agentes where id = p_agente and eliminado_en is null and public.es_dueno(buzon_id)) then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if c is not null and (length(c) < 8 or length(c) > 500 or c ~ '\s') then
    raise exception 'la clave no es valida' using errcode = '22023';
  end if;
  -- I3: sin dirección no hay avisos, así que también se olvida la clave.
  update public.agentes set webhook_url = u, webhook_clave = case when u is null then null else webhook_clave end
   where id = p_agente;  -- el CHECK de la columna valida la URL
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    select buzon_id, 'humano:' || auth.uid(), 'webhook:guardar_url', id from public.agentes where id = p_agente;
  if c is not null and u is not null then
    update public.agentes set webhook_clave = c where id = p_agente;
    insert into public.auditoria(buzon_id, actor, accion, objeto_id)
      select buzon_id, 'humano:' || auth.uid(), 'webhook:guardar_clave', id from public.agentes where id = p_agente;
  end if;
  return true;
end $$;
revoke all on function public.guardar_webhook(uuid, text, text) from public, anon;
grant execute on function public.guardar_webhook(uuid, text, text) to authenticated;

-- Auditor B1/B4: NO se revoca aquí. En Supabase el esquema net y sus funciones son de supabase_admin y los permisos
-- (USAGE a PUBLIC/anon/authenticated, EXECUTE por PUBLIC) los dio supabase_admin; el rol postgres que corre las
-- migraciones no puede quitarlos (REVOKE solo quita lo que concedió el mismo rol). Ver issue #2.

-- I4: índice para el tope de hilos nuevos por IA (B2).
create index if not exists hilos_buzon_agente_creado_idx on public.hilos(buzon_id, creado_por_agente, creado_en);

-- I5: la dirección del webhook solo se cambia con guardar_webhook (auditada, atómica con la clave).
revoke update (webhook_url) on public.agentes from authenticated;

-- QA (bajo): tope de push al teléfono del dueño. Máximo 10 push de hilos nuevos por hora y buzón;
-- pide_cierre / pide_aprobacion siempre pasan (son las que piden una decisión a Erik).
create or replace function public._permitir_push(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare n public.notificaciones; enviados int;
begin
  select * into n from public.notificaciones where id = p_id;
  if not found then return false; end if;
  if n.evento <> 'hilo_nuevo' then return true; end if;
  select count(*) into enviados from public.notificaciones p
   where p.buzon_id = n.buzon_id and p.evento = 'hilo_nuevo' and p.id <> n.id
     and p.creado_en > n.creado_en - interval '1 hour'
     and exists (select 1 from unnest(p.entregados) d where d like 'push:%');
  return enviados < 10;
end $$;
revoke all on function public._permitir_push(bigint) from public, anon, authenticated;
grant execute on function public._permitir_push(bigint) to service_role;
