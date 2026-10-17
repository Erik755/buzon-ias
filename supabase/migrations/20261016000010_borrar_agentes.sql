-- v2: borrar agentes (borrado lógico). Aditiva: agrega una columna, funciones y triggers.
-- Borrado lógico porque mensajes.autor_agente tiene CHECK num_nonnulls(...)=1: un borrado físico rompería
-- o perdería el historial. Los hilos y mensajes se conservan y se muestran como "agente eliminado".

alter table public.agentes add column eliminado_en timestamptz;
grant select (eliminado_en) on public.agentes to authenticated;
-- Ya no se borra directo: solo por borrar_agentes() (revoca, limpia y audita).
revoke delete on public.agentes from authenticated;

-- Un agente eliminado no puede recibir tokens nuevos ni editarse.
create or replace function public.agente_no_eliminado() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'tokens' then
    if exists (select 1 from public.agentes where id = new.agente_id and eliminado_en is not null) then
      raise exception 'agente eliminado' using errcode = '42501'; end if;
  elsif old.eliminado_en is not null and pg_trigger_depth() = 1 and current_user <> 'postgres' then
    raise exception 'agente eliminado' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.agente_no_eliminado() from public, anon, authenticated;
create trigger tokens_agente_vivo before insert on public.tokens for each row execute function public.agente_no_eliminado();
create trigger agentes_eliminado_inmutable before update on public.agentes for each row execute function public.agente_no_eliminado();

-- Borra (lógicamente) uno o varios agentes del dueño. Devuelve cuántos borró.
create or replace function public.borrar_agentes(p_agentes uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare a public.agentes; n int := 0;
begin
  if auth.uid() is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p_agentes is null or cardinality(p_agentes) = 0 or cardinality(p_agentes) > 100 then
    raise exception 'entre 1 y 100 agentes' using errcode = '22023'; end if;
  -- Todos deben ser del dueño; si alguno no, no se borra ninguno.
  if exists (select 1 from unnest(p_agentes) x(id) left join public.agentes g on g.id = x.id
              where g.id is null or not public.es_dueno(g.buzon_id)) then
    raise exception 'sin permiso' using errcode = '42501'; end if;
  for a in select * from public.agentes where id = any(p_agentes) and eliminado_en is null for update loop
    update public.tokens set revocado_en = now() where agente_id = a.id and revocado_en is null;
    -- Códigos de configuración pendientes para ese nombre de agente en ese buzón: anulados.
    update public.codigos_config set vence_en = least(vence_en, now())
     where buzon_id = a.buzon_id and usado_en is null and lower(nombre_agente) = lower(a.nombre);
    update public.agentes set eliminado_en = now(), webhook_url = null, webhook_secreto = null where id = a.id;
    insert into public.auditoria(buzon_id, actor, accion, objeto_id) values (a.buzon_id, 'humano:' || auth.uid(), 'agente:borrar', a.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.borrar_agentes(uuid[]) from public, anon;
grant execute on function public.borrar_agentes(uuid[]) to authenticated;

-- Candidatos a "Limpiar inactivos": sin uso en p_dias días o que nunca se conectaron (solo los del dueño).
create or replace function public.agentes_inactivos(p_buzon uuid, p_dias int default 30)
returns table(id uuid, nombre text, ultimo_uso timestamptz, creado_en timestamptz)
language sql stable security invoker set search_path = public as $$
  select a.id, a.nombre, max(t.ultimo_uso), a.creado_en
    from public.agentes a left join public.tokens t on t.agente_id = a.id
   where a.buzon_id = p_buzon and a.eliminado_en is null
   group by a.id
  having max(t.ultimo_uso) is null or max(t.ultimo_uso) < now() - make_interval(days => greatest(p_dias, 1))
   order by max(t.ultimo_uso) nulls first, a.creado_en;
$$;
revoke all on function public.agentes_inactivos(uuid, int) from public, anon;
grant execute on function public.agentes_inactivos(uuid, int) to authenticated;

-- leer: los mensajes de agentes eliminados dicen "agente eliminado".
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
    'mensajes', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id,
                   'autor', case when m.autor_agente is null then 'humano' when ag.eliminado_en is not null then 'agente eliminado' else ag.nombre end,
                   'cuerpo', m.cuerpo, 'creado_en', m.creado_en) order by m.creado_en), '[]')
                 from public.mensajes m left join public.agentes ag on ag.id = m.autor_agente where m.hilo_id = h.id),
    'aprobaciones', (select coalesce(jsonb_agg(jsonb_build_object('decision', decision, 'nota', nota, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.aprobaciones where hilo_id = h.id),
    'adjuntos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'tamano', tamano, 'mensaje_id', mensaje_id, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.adjuntos where hilo_id = h.id));
end $$;
