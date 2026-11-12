-- 017: avisos por agente y por hilo. El dueño elige qué IAs se despiertan
-- en cada conversación, en cada mensaje nuevo. Reusa la cola de notificaciones
-- y la función "notificar" (firma HMAC, clave Bearer, reintentos, freno SSRF).
-- El payload del webhook no cambia (evento, hilo_id, aviso; sin contenido ni secretos).
-- Aditiva: una tabla, dos RPCs del dueño, y se sustituye _destinos_webhook.
-- No se aplica sola a producción: hay que correrla después del merge.

create table public.hilo_suscripciones (
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  agente_id uuid not null references public.agentes(id) on delete cascade,
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (hilo_id, agente_id)
);
create index hilo_suscripciones_agente_idx on public.hilo_suscripciones(agente_id);
create index hilo_suscripciones_buzon_idx on public.hilo_suscripciones(buzon_id);

comment on table public.hilo_suscripciones is
  'IAs que el dueño quiere despertar en cada mensaje nuevo de este hilo.';

-- Coherencia: el hilo y el agente son del mismo buzón, y el agente sigue activo.
create or replace function public.hilo_suscripciones_coherente() returns trigger
language plpgsql set search_path = public as $$
declare bh uuid; ba uuid; elim timestamptz;
begin
  select buzon_id into bh from public.hilos where id = new.hilo_id;
  select buzon_id, eliminado_en into ba, elim from public.agentes where id = new.agente_id;
  if bh is null or ba is null or bh is distinct from ba or bh is distinct from new.buzon_id then
    raise exception 'el agente y el hilo deben ser del mismo buzón' using errcode = '23514';
  end if;
  if elim is not null then
    raise exception 'el agente ya no está activo' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists hilo_suscripciones_coherente on public.hilo_suscripciones;
create trigger hilo_suscripciones_coherente before insert or update on public.hilo_suscripciones
  for each row execute function public.hilo_suscripciones_coherente();

-- Si se borra un agente (soft), se olvidan sus suscripciones.
create or replace function public.hilo_suscripciones_al_borrar_agente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.eliminado_en is not null and old.eliminado_en is null then
    delete from public.hilo_suscripciones where agente_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists hilo_suscripciones_al_borrar_agente on public.agentes;
create trigger hilo_suscripciones_al_borrar_agente after update of eliminado_en on public.agentes
  for each row execute function public.hilo_suscripciones_al_borrar_agente();

alter table public.hilo_suscripciones enable row level security;
alter table public.hilo_suscripciones force row level security;
revoke all on public.hilo_suscripciones from public, anon, authenticated;
grant select on public.hilo_suscripciones to authenticated;
drop policy if exists hilo_suscripciones_dueno on public.hilo_suscripciones;
create policy hilo_suscripciones_dueno on public.hilo_suscripciones
  for select to authenticated using (public.es_dueno(buzon_id));

-- El dueño marca o desmarca una IA en un hilo suyo. Escribe solo esta RPC (no hay INSERT directo).
create or replace function public.suscribir_agente_hilo(p_hilo uuid, p_agente uuid, p_activo boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  select h.buzon_id into b
    from public.hilos h
    join public.agentes a on a.id = p_agente and a.buzon_id = h.buzon_id and a.eliminado_en is null
   where h.id = p_hilo and public.es_dueno(h.buzon_id);
  if b is null then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if p_activo then
    insert into public.hilo_suscripciones(hilo_id, agente_id, buzon_id)
      values (p_hilo, p_agente, b)
      on conflict (hilo_id, agente_id) do nothing;
    insert into public.auditoria(buzon_id, actor, accion, objeto_id)
      values (b, 'humano:' || auth.uid(), 'hilo:suscribir', p_agente);
  else
    delete from public.hilo_suscripciones where hilo_id = p_hilo and agente_id = p_agente;
    insert into public.auditoria(buzon_id, actor, accion, objeto_id)
      values (b, 'humano:' || auth.uid(), 'hilo:desuscribir', p_agente);
  end if;
  return p_activo;
end $$;
revoke all on function public.suscribir_agente_hilo(uuid, uuid, boolean) from public, anon;
grant execute on function public.suscribir_agente_hilo(uuid, uuid, boolean) to authenticated;

-- Lista las IAs del buzón para la PWA: si está marcada, si puede recibir aviso inmediato, si ya participa.
-- Nunca devuelve URLs ni secretos.
create or replace function public.agentes_para_avisos(p_hilo uuid)
returns table(id uuid, nombre text, suscrito boolean, tiene_aviso boolean, participa boolean)
language plpgsql stable security definer set search_path = public as $$
declare h public.hilos;
begin
  if auth.uid() is null then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  select * into h from public.hilos where hilos.id = p_hilo and public.es_dueno(hilos.buzon_id);
  if not found then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  return query
    select a.id, a.nombre,
           exists (select 1 from public.hilo_suscripciones s where s.hilo_id = h.id and s.agente_id = a.id) as suscrito,
           (a.webhook_url is not null and (a.webhook_tiene_clave or a.webhook_tiene_secreto)) as tiene_aviso,
           (a.id in (h.para_agente, h.tomado_por_agente, h.creado_por_agente)
            or exists (select 1 from public.mensajes m where m.hilo_id = h.id and m.autor_agente = a.id)) as participa
      from public.agentes a
     where a.buzon_id = h.buzon_id and a.eliminado_en is null
     order by (a.id in (h.para_agente, h.tomado_por_agente, h.creado_por_agente)
               or exists (select 1 from public.mensajes m where m.hilo_id = h.id and m.autor_agente = a.id)) desc,
              a.nombre;
end $$;
revoke all on function public.agentes_para_avisos(uuid) from public, anon;
grant execute on function public.agentes_para_avisos(uuid) to authenticated;

-- Destinos: se mantiene el camino de IAs involucradas (frenos B2, anti ping-pong,
-- "no re-despertar si no ha leído") y se SUMAN las IAs que el dueño suscribió, en cada
-- mensaje_nuevo, sin ese freno de lectura, con un tope de un aviso cada 10 s por IA y hilo.
-- El autor del mensaje nunca se avisa a sí mismo. El payload no cambia.
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
       and (
         -- Camino actual: IAs involucradas, sin re-despertar a quien no ha abierto el hilo.
         (
           case when n.evento = 'hilo_nuevo' then h.para_agente is null or a.id = h.para_agente
                else a.id in (h.para_agente, h.tomado_por_agente, h.creado_por_agente)
                     or exists (select 1 from public.mensajes m where m.hilo_id = h.id and m.autor_agente = a.id) end
           and (n.evento = 'hilo_nuevo' or not exists (
                 select 1 from public.notificaciones p
                  where p.hilo_id = h.id and p.id < n.id and ('wh:' || a.id::text) = any(p.entregados)
                    and p.creado_en > coalesce((select l.leido_en from public.lecturas l where l.agente_id = a.id and l.hilo_id = h.id), '-infinity')))
         )
         or
         -- Suscripción del dueño: cada mensaje nuevo, con tope de 10 s para no disparar en ráfaga.
         (
           n.evento = 'mensaje_nuevo'
           and exists (select 1 from public.hilo_suscripciones s where s.hilo_id = h.id and s.agente_id = a.id)
           and not exists (
                 select 1 from public.notificaciones p
                  where p.hilo_id = h.id and p.id < n.id and ('wh:' || a.id::text) = any(p.entregados)
                    and p.creado_en > n.creado_en - interval '10 seconds')
         )
       );
end $$;
revoke all on function public._destinos_webhook(bigint) from public, anon, authenticated;
grant execute on function public._destinos_webhook(bigint) to service_role;
