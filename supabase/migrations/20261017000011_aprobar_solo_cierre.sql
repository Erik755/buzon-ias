-- Aprobar solo el cierre: las IAs se escriben libremente; cerrar un hilo requiere al dueño.
-- Aditiva: estado y eventos nuevos, una columna, una RPC y guardias.

alter table public.hilos drop constraint if exists hilos_estado_check;
alter table public.hilos add constraint hilos_estado_check check (estado in
  ('abierto','tomado','pide_aprobacion','aprobado','rechazado','pide_cierre','cerrado'));

alter table public.notificaciones drop constraint if exists notificaciones_evento_check;
alter table public.notificaciones add constraint notificaciones_evento_check
  check (evento in ('hilo_nuevo','pide_aprobacion','mensaje_nuevo','pide_cierre'));
-- Quién originó el aviso (para no mandarle webhook a sí mismo). null = el creador del hilo.
alter table public.notificaciones add column agente_origen uuid references public.agentes(id) on delete set null;

-- Guardia: aprobado/rechazado solo por aprobación humana (igual que antes) y cerrado solo por decidir_cierre().
create or replace function public.hilos_estado_guard() returns trigger
language plpgsql as $$
begin
  if new.estado in ('aprobado','rechazado') and new.estado is distinct from old.estado
     and pg_trigger_depth() < 2 then
    raise exception 'solo una aprobacion humana puede aprobar/rechazar' using errcode = '42501';
  end if;
  if new.estado = 'cerrado' and old.estado is distinct from 'cerrado'
     and coalesce(current_setting('buzon.cierre_humano', true), '') <> 'si' then
    raise exception 'solo el dueño puede cerrar un hilo' using errcode = '42501';
  end if;
  if old.estado = 'cerrado' and new.estado is distinct from 'cerrado' then
    raise exception 'un hilo cerrado no se reabre' using errcode = '42501';
  end if;
  return new;
end $$;
-- Un insert no pasa por el trigger de update: nadie crea hilos ya cerrados.
create or replace function public.hilos_insert_guard() returns trigger language plpgsql as $$
begin
  if new.estado = 'cerrado' and coalesce(current_setting('buzon.cierre_humano', true), '') <> 'si' then
    raise exception 'un hilo no puede nacer cerrado' using errcode = '42501'; end if;
  return new;
end $$;
create trigger hilos_insert_guard before insert on public.hilos for each row execute function public.hilos_insert_guard();

-- Avisos: pide_cierre (push al dueño) y mensaje_nuevo de una IA (webhook a las demás IAs).
create or replace function public.encolar_notificacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notificaciones(buzon_id, hilo_id, evento) values (new.buzon_id, new.id, 'hilo_nuevo');
  elsif new.estado = 'pide_aprobacion' and old.estado is distinct from 'pide_aprobacion' then
    insert into public.notificaciones(buzon_id, hilo_id, evento) values (new.buzon_id, new.id, 'pide_aprobacion');
  elsif new.estado = 'pide_cierre' and old.estado is distinct from 'pide_cierre' then
    insert into public.notificaciones(buzon_id, hilo_id, evento, agente_origen) values (new.buzon_id, new.id, 'pide_cierre', null);
  end if;
  return new;
end $$;

create or replace function public.encolar_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.autor_agente is not null then
    insert into public.notificaciones(buzon_id, hilo_id, evento, agente_origen)
      select h.buzon_id, h.id, 'mensaje_nuevo', new.autor_agente from public.hilos h where h.id = new.hilo_id;
  end if;
  return new;
end $$;
revoke all on function public.encolar_mensaje() from public, anon, authenticated;
create trigger mensajes_notificar after insert on public.mensajes for each row execute function public.encolar_mensaje();

create or replace function public._tomar_notificaciones(p_limite int default 20)
returns table(id bigint, buzon_id uuid, hilo_id uuid, evento text, intentos int, creado_por_agente uuid, entregados text[])
language sql security definer set search_path = public as $$
  update public.notificaciones n set intentos = n.intentos + 1,
         proximo_intento = now() + (interval '1 minute' * power(4, n.intentos))
  from public.hilos h
  where n.id in (select id from public.notificaciones where estado = 'pendiente' and proximo_intento <= now()
                 order by id limit least(p_limite, 50) for update skip locked)
    and h.id = n.hilo_id
  returning n.id, n.buzon_id, n.hilo_id, n.evento, n.intentos, coalesce(n.agente_origen, h.creado_por_agente), n.entregados;
$$;
revoke all on function public._tomar_notificaciones(int) from public, anon, authenticated;
grant execute on function public._tomar_notificaciones(int) to service_role;

-- responder: nueva acción pedir_cierre. Un hilo cerrado ya no acepta mensajes.
create or replace function public.mcp_responder(p_token text, p_hilo_id uuid, p_cuerpo text, p_accion text default 'comentar', p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; m uuid;
begin
  a := public._mcp_ctx(p_token, 'responder', p_ip);
  if p_accion not in ('comentar','tomar','pedir_aprobacion','pedir_cierre') then raise exception '400:accion no permitida (las IAs no aprueban ni cierran)'; end if;
  select * into h from public.hilos where id = p_hilo_id and buzon_id = a.buzon_id for update;
  if not found then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  if h.estado = 'cerrado' then raise exception '409:El hilo ya esta cerrado'; end if;
  if p_accion in ('tomar','pedir_aprobacion') and h.estado in ('aprobado','rechazado') then raise exception '409:El hilo ya esta %', h.estado; end if;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo) values (h.id, a.id, p_cuerpo) returning id into m;
  if p_accion = 'tomar' then update public.hilos set estado = 'tomado', tomado_por_agente = a.id where id = h.id returning * into h; end if;
  if p_accion = 'pedir_aprobacion' then update public.hilos set estado = 'pide_aprobacion' where id = h.id returning * into h; end if;
  if p_accion = 'pedir_cierre' and h.estado <> 'pide_cierre' then update public.hilos set estado = 'pide_cierre' where id = h.id returning * into h; end if;
  perform public._mcp_audit(a, 'responder:' || p_accion, h.id, p_ip);
  return jsonb_build_object('mensaje_id', m, 'estado', h.estado);
end $$;

-- El dueño decide el cierre (o cierra por su cuenta). Rechazar devuelve el hilo a "abierto".
create or replace function public.decidir_cierre(p_hilo uuid, p_cerrar boolean, p_nota text default null)
returns text language plpgsql security definer set search_path = public as $$
declare h public.hilos;
begin
  if auth.uid() is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into h from public.hilos where id = p_hilo for update;
  if not found or not public.es_dueno(h.buzon_id) then raise exception 'sin permiso' using errcode = '42501'; end if;
  if h.estado = 'cerrado' then raise exception 'el hilo ya esta cerrado' using errcode = '22023'; end if;
  if not p_cerrar and h.estado <> 'pide_cierre' then raise exception 'nadie pidio cerrar este hilo' using errcode = '22023'; end if;
  if nullif(trim(p_nota), '') is not null then
    insert into public.mensajes(hilo_id, autor_humano, cuerpo) values (h.id, auth.uid(), left(p_nota, 2000));
  end if;
  if p_cerrar then
    perform set_config('buzon.cierre_humano', 'si', true);
    update public.hilos set estado = 'cerrado' where id = h.id;
    perform set_config('buzon.cierre_humano', '', true);
  else
    update public.hilos set estado = 'abierto' where id = h.id;
  end if;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    values (h.buzon_id, 'humano:' || auth.uid(), case when p_cerrar then 'cierre:aprobado' else 'cierre:rechazado' end, h.id);
  return case when p_cerrar then 'cerrado' else 'abierto' end;
end $$;
revoke all on function public.decidir_cierre(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_cierre(uuid, boolean, text) to authenticated;
