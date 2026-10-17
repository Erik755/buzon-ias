-- "Lo que me toca": hilos dirigidos a un agente (para), registro de lectura por agente y por hilo,
-- y una lista corta por defecto con solo lo pendiente para la IA que pregunta. Aditiva.

alter table public.hilos add column para_agente uuid references public.agentes(id) on delete set null;
create index on public.hilos(buzon_id, para_agente);
grant select (para_agente) on public.hilos to authenticated;

-- Última vez que cada agente abrió cada hilo. Solo la escriben las funciones mcp_* (definer).
create table public.lecturas (
  agente_id uuid not null references public.agentes(id) on delete cascade,
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  leido_en timestamptz not null default now(),
  primary key (agente_id, hilo_id)
);
alter table public.lecturas enable row level security;
alter table public.lecturas force row level security;
revoke all on public.lecturas from public, anon, authenticated;
grant select on public.lecturas to authenticated;
create policy lecturas_dueno on public.lecturas for select to authenticated
  using (exists (select 1 from public.agentes g where g.id = agente_id and public.es_dueno(g.buzon_id)));

-- Texto sencillo del estado (mismo vocabulario que la PWA).
create or replace function public.estado_texto(e text) returns text language sql immutable set search_path = public as $$
  select case e when 'abierto' then 'Abierto' when 'tomado' then 'Una IA lo está trabajando'
    when 'pide_aprobacion' then 'Espera aprobación del dueño' when 'aprobado' then 'Aprobado' when 'rechazado' then 'Rechazado'
    when 'pide_cierre' then 'Listo para cerrar: espera al dueño' when 'cerrado' then 'Cerrado' else e end;
$$;

-- crear: campo opcional "para" (nombre de un agente activo del mismo buzón).
drop function if exists public.mcp_crear(text,text,text,text,text);
create function public.mcp_crear(p_token text, p_tipo text, p_titulo text, p_contexto text default null, p_ip text default null, p_para text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; dest uuid; n int;
begin
  a := public._mcp_ctx(p_token, 'crear', p_ip);
  if nullif(trim(p_para), '') is not null then
    select count(*), min(id::text)::uuid into n, dest from public.agentes
     where buzon_id = a.buzon_id and eliminado_en is null and lower(nombre) = lower(trim(p_para));
    if n = 0 then raise exception '400:No hay un agente activo llamado "%" en tu buzon', left(trim(p_para), 60); end if;
    if n > 1 then raise exception '409:Hay varios agentes llamados "%"; pide al humano que les ponga nombres distintos', left(trim(p_para), 60); end if;
  end if;
  insert into public.hilos(buzon_id, tipo, titulo, contexto, creado_por_agente, para_agente)
    values (a.buzon_id, p_tipo, p_titulo, p_contexto, a.id, dest) returning * into h;
  perform public._mcp_audit(a, 'crear', h.id, p_ip);
  return jsonb_build_object('id', h.id, 'estado', h.estado, 'creado_por', a.nombre,
    'para', (select nombre from public.agentes where id = dest));
end $$;
revoke all on function public.mcp_crear(text,text,text,text,text,text) from public;
grant execute on function public.mcp_crear(text,text,text,text,text,text) to anon, authenticated, service_role;

-- leer:
--  * sin filtros -> solo lo pendiente para esta IA (no cerrado/aprobado/rechazado): primero lo dirigido a ella,
--    luego lo que ella tomó,
--    (el más antiguo primero), luego hilos con mensajes de otros que todavía no ha visto y hilos nuevos
--    sin destinatario que nunca ha abierto. Lo dirigido a OTRA IA no aparece salvo que esta IA lo haya tomado
--    o ya haya escrito en él.
--  * estado 'todos' -> todo; otro estado -> ese estado.
--  * la lista es un resumen corto (sin historial) con horas ISO con desfase y legibles en hora de CDMX.
--  * abrir un hilo registra la lectura.
create or replace function public.mcp_leer(p_token text, p_hilo_id uuid default null, p_estado text default null, p_limite int default 20, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public set timezone = 'America/Mexico_City' as $$
declare a public.agentes; h public.hilos; r jsonb; lim int := least(greatest(coalesce(p_limite, 20), 1), 100);
begin
  a := public._mcp_ctx(p_token, 'leer', p_ip);
  if p_hilo_id is null then
    with base as (
      select hh.*, l.leido_en,
             greatest(hh.creado_en, coalesce((select max(m.creado_en) from public.mensajes m where m.hilo_id = hh.id), hh.creado_en)) ultima,
             (select count(*) from public.mensajes m where m.hilo_id = hh.id and m.autor_agente is distinct from a.id
                 and (l.leido_en is null or m.creado_en > l.leido_en)) sin_leer,
             exists (select 1 from public.mensajes m where m.hilo_id = hh.id and m.autor_agente = a.id) escribi
        from public.hilos hh left join public.lecturas l on l.hilo_id = hh.id and l.agente_id = a.id
       where hh.buzon_id = a.buzon_id
    ), sel as (
      select b.*, row_number() over (order by
               case when p_estado is null then (case when b.para_agente = a.id then 0 when b.tomado_por_agente = a.id then 1 else 2 end) else 0 end,
               case when p_estado is null and b.para_agente = a.id then extract(epoch from b.creado_en) else -extract(epoch from b.ultima) end,
               b.creado_en, b.id) orden,
             case when b.para_agente = a.id then 'para_ti' when b.tomado_por_agente = a.id then 'tomado_por_ti' when b.sin_leer > 0 then 'mensajes_nuevos'
                       when b.leido_en is null and b.para_agente is null and b.creado_por_agente is distinct from a.id then 'hilo_nuevo' end motivo
        from base b
       where case when p_estado = 'todos' then true
                  when p_estado is not null then b.estado = p_estado
                  else b.estado not in ('cerrado','aprobado','rechazado')
                       and (b.para_agente = a.id or b.tomado_por_agente = a.id
                            -- lo dirigido a OTRA IA no es mío, salvo que ya haya escrito en él
                            or ((b.para_agente is null or b.escribi)
                                and (b.sin_leer > 0 or (b.leido_en is null and b.para_agente is null and b.creado_por_agente is distinct from a.id)))) end
       order by orden
       limit lim
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'titulo', s.titulo, 'tipo', s.tipo, 'estado', s.estado, 'estado_texto', public.estado_texto(s.estado),
        'para', (select nombre from public.agentes g where g.id = s.para_agente),
        'creado_por', (select case when g.eliminado_en is not null then 'agente eliminado' else g.nombre end from public.agentes g where g.id = s.creado_por_agente),
        'motivo', s.motivo, 'mensajes_sin_leer', s.sin_leer,
        'creado_en', to_char(s.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
        'creado_en_cdmx', to_char(s.creado_en, 'DD/MM/YYYY HH24:MI') || ' (hora de CDMX)',
        'ultima_actividad', to_char(s.ultima, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
        'ultima_actividad_cdmx', to_char(s.ultima, 'DD/MM/YYYY HH24:MI') || ' (hora de CDMX)'
      ) order by s.orden), '[]') into r from sel s;
    perform public._mcp_audit(a, 'leer:lista', null, p_ip);
    return jsonb_build_object('hilos', r, 'filtro', coalesce(p_estado, 'pendiente_para_ti'),
      'regla', 'Si hay varios, abre solo el más antiguo dirigido a ti (motivo para_ti) o pregunta al humano cuál. No los abras todos.');
  end if;
  select * into h from public.hilos where id = p_hilo_id and buzon_id = a.buzon_id;
  if not found then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  insert into public.lecturas(agente_id, hilo_id, leido_en) values (a.id, h.id, now())
    on conflict (agente_id, hilo_id) do update set leido_en = excluded.leido_en;
  perform public._mcp_audit(a, 'leer:hilo', h.id, p_ip);
  return jsonb_build_object('hilo', to_jsonb(h) || jsonb_build_object('estado_texto', public.estado_texto(h.estado),
      'creado_en_cdmx', to_char(h.creado_en, 'DD/MM/YYYY HH24:MI') || ' (hora de CDMX)',
      'para', (select nombre from public.agentes where id = h.para_agente)),
    'mensajes', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id,
                   'autor', case when m.autor_agente is null then 'humano' when ag.eliminado_en is not null then 'agente eliminado' else ag.nombre end,
                   'cuerpo', m.cuerpo, 'creado_en', to_char(m.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                   'creado_en_cdmx', to_char(m.creado_en, 'DD/MM/YYYY HH24:MI') || ' (hora de CDMX)') order by m.creado_en), '[]')
                 from public.mensajes m left join public.agentes ag on ag.id = m.autor_agente where m.hilo_id = h.id),
    'aprobaciones', (select coalesce(jsonb_agg(jsonb_build_object('decision', decision, 'nota', nota, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.aprobaciones where hilo_id = h.id),
    'adjuntos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'tamano', tamano, 'mensaje_id', mensaje_id, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.adjuntos where hilo_id = h.id));
end $$;
