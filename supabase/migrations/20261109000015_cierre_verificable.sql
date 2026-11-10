-- Cierre verificable v1:
-- A) Evidencia estructurada al pedir_cierre (opcional; sin evidencia queda marcado evidencia=false).
-- B) Veredicto humano estructurado al decidir el cierre (aceptado/rechazado + motivo + quién).
-- C) Autoría humana inequívoca: leer devuelve es_humano (booleano) y se reservan los nombres
--    humano/human/owner/dueño para que ninguna IA pueda llamarse así.
-- Aditiva e idempotente: tablas nuevas, funciones reemplazadas, sin tocar datos existentes.

-- ---------- A) evidencias_cierre ----------
create table if not exists public.evidencias_cierre (
  id uuid primary key default gen_random_uuid(),
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  mensaje_id uuid not null unique references public.mensajes(id) on delete cascade,
  agente_id uuid not null references public.agentes(id) on delete cascade,
  que_se_pidio text not null check (length(que_se_pidio) between 1 and 2000),
  que_se_entrego text not null check (length(que_se_entrego) between 1 and 4000),
  pruebas jsonb not null default '[]' check (jsonb_typeof(pruebas) = 'array'),
  verificacion text check (verificacion is null or length(verificacion) between 1 and 4000),
  creado_en timestamptz not null default now()
);
create index if not exists evidencias_cierre_hilo_idx on public.evidencias_cierre(hilo_id);
alter table public.evidencias_cierre enable row level security;
alter table public.evidencias_cierre force row level security;
revoke all on public.evidencias_cierre from public, anon, authenticated;
grant select on public.evidencias_cierre to authenticated;
drop policy if exists evidencias_dueno on public.evidencias_cierre;
create policy evidencias_dueno on public.evidencias_cierre for select to authenticated
  using (exists (select 1 from public.hilos h where h.id = hilo_id and public.es_dueno(h.buzon_id)));

-- ---------- B) cierres (veredicto humano estructurado) ----------
create table if not exists public.cierres (
  id uuid primary key default gen_random_uuid(),
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  humano_id uuid not null references auth.users(id),
  veredicto text not null check (veredicto in ('aceptado','rechazado')),
  motivo text check (motivo is null or length(motivo) <= 2000),
  creado_en timestamptz not null default now()
);
create index if not exists cierres_hilo_idx on public.cierres(hilo_id);
alter table public.cierres enable row level security;
alter table public.cierres force row level security;
revoke all on public.cierres from public, anon, authenticated;
grant select on public.cierres to authenticated;
drop policy if exists cierres_dueno on public.cierres;
create policy cierres_dueno on public.cierres for select to authenticated
  using (exists (select 1 from public.hilos h where h.id = hilo_id and public.es_dueno(h.buzon_id)));

-- decidir_cierre: mismo comportamiento + registra el veredicto estructurado.
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
  insert into public.cierres(hilo_id, humano_id, veredicto, motivo)
    values (h.id, auth.uid(), case when p_cerrar then 'aceptado' else 'rechazado' end, nullif(trim(p_nota), ''));
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    values (h.buzon_id, 'humano:' || auth.uid(), case when p_cerrar then 'cierre:aprobado' else 'cierre:rechazado' end, h.id);
  return case when p_cerrar then 'cerrado' else 'abierto' end;
end $$;
revoke all on function public.decidir_cierre(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_cierre(uuid, boolean, text) to authenticated;

-- ---------- C) nombres reservados (humano/owner/dueño, sin importar mayúsculas) ----------
create or replace function public.agentes_nombre_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if lower(btrim(new.nombre)) in ('humano','owner','dueño','dueno') then
    raise exception '400:nombre de agente reservado (humano/owner/dueño): elige otro';
  end if;
  return new;
end $$;
drop trigger if exists agentes_nombre_guard on public.agentes;
create trigger agentes_nombre_guard before insert or update of nombre on public.agentes
  for each row execute function public.agentes_nombre_guard();

-- ---------- A+C) mcp_responder con evidencia opcional y mcp_leer con es_humano ----------
drop function if exists public.mcp_responder(text, uuid, text, text, text);
create or replace function public.mcp_responder(p_token text, p_hilo_id uuid, p_cuerpo text, p_accion text default 'comentar', p_ip text default null, p_evidencia jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; m uuid; ev jsonb; prueba jsonb; n int;
begin
  a := public._mcp_ctx(p_token, 'responder', p_ip);
  if p_accion not in ('comentar','tomar','pedir_aprobacion','pedir_cierre') then raise exception '400:accion no permitida (las IAs no aprueban ni cierran)'; end if;
  if p_evidencia is not null and p_accion <> 'pedir_cierre' then
    raise exception '400:la evidencia solo se admite con accion pedir_cierre'; end if;
  if p_evidencia is not null then
    if jsonb_typeof(p_evidencia) is distinct from 'object' then raise exception '400:evidencia debe ser un objeto'; end if;
    ev := p_evidencia;
    if coalesce(ev->>'que_se_pidio','') !~ '\S' or length(ev->>'que_se_pidio') > 2000 then
      raise exception '400:evidencia.que_se_pidio requerido (1-2000)'; end if;
    if coalesce(ev->>'que_se_entrego','') !~ '\S' or length(ev->>'que_se_entrego') > 4000 then
      raise exception '400:evidencia.que_se_entrego requerido (1-4000)'; end if;
    if ev ? 'verificacion' and (jsonb_typeof(ev->'verificacion') is distinct from 'string'
        or not (ev->>'verificacion') ~ '\S' or length(ev->>'verificacion') > 4000) then
      raise exception '400:evidencia.verificacion debe ser texto (1-4000)'; end if;
    if ev ? 'pruebas' then
      if jsonb_typeof(ev->'pruebas') is distinct from 'array' or jsonb_array_length(ev->'pruebas') > 10 then
        raise exception '400:evidencia.pruebas debe ser un arreglo de hasta 10 elementos'; end if;
      for prueba in select value from jsonb_array_elements(ev->'pruebas') loop
        if jsonb_typeof(prueba) is distinct from 'object' then raise exception '400:cada prueba debe ser un objeto {url} o {adjunto_sha256}'; end if;
        n := (case when prueba ? 'url' then 1 else 0 end) + (case when prueba ? 'adjunto_sha256' then 1 else 0 end);
        if n = 0 then raise exception '400:cada prueba necesita url o adjunto_sha256'; end if;
        if prueba ? 'url' and (jsonb_typeof(prueba->'url') is distinct from 'string'
            or prueba->>'url' !~ '^https?://' or length(prueba->>'url') > 500) then
          raise exception '400:prueba.url debe ser http(s) de hasta 500 caracteres'; end if;
        if prueba ? 'adjunto_sha256' and (jsonb_typeof(prueba->'adjunto_sha256') is distinct from 'string'
            or prueba->>'adjunto_sha256' !~ '^[0-9a-f]{64}$') then
          raise exception '400:prueba.adjunto_sha256 debe ser 64 hex'; end if;
      end loop;
    end if;
  end if;
  select * into h from public.hilos where id = p_hilo_id and buzon_id = a.buzon_id for update;
  if not found then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  if h.estado = 'cerrado' then raise exception '409:El hilo ya esta cerrado'; end if;
  if p_evidencia is not null and p_evidencia ? 'pruebas' then
    for prueba in select value from jsonb_array_elements(p_evidencia->'pruebas') loop
      if prueba ? 'adjunto_sha256' and not exists (
        select 1 from public.adjuntos ad where ad.hilo_id = h.id and ad.sha256 = (prueba->>'adjunto_sha256')) then
        raise exception '400:prueba.adjunto_sha256 no corresponde a un adjunto de este hilo';
      end if;
    end loop;
  end if;
  if p_accion in ('tomar','pedir_aprobacion') and h.estado in ('aprobado','rechazado') then raise exception '409:El hilo ya esta %', h.estado; end if;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo) values (h.id, a.id, p_cuerpo) returning id into m;
  if p_evidencia is not null then
    insert into public.evidencias_cierre(hilo_id, mensaje_id, agente_id, que_se_pidio, que_se_entrego, pruebas, verificacion)
      values (h.id, m, a.id, ev->>'que_se_pidio', ev->>'que_se_entrego', coalesce(ev->'pruebas','[]'), ev->>'verificacion');
  end if;
  if p_accion = 'tomar' then update public.hilos set estado = 'tomado', tomado_por_agente = a.id where id = h.id returning * into h; end if;
  if p_accion = 'pedir_aprobacion' then update public.hilos set estado = 'pide_aprobacion' where id = h.id returning * into h; end if;
  if p_accion = 'pedir_cierre' and h.estado <> 'pide_cierre' then update public.hilos set estado = 'pide_cierre' where id = h.id returning * into h; end if;
  perform public._mcp_audit(a, 'responder:' || p_accion, h.id, p_ip);
  return jsonb_build_object('mensaje_id', m, 'estado', h.estado,
    'evidencia', case when p_accion = 'pedir_cierre' then (p_evidencia is not null) else null end);
end $$;
revoke all on function public.mcp_responder(text,uuid,text,text,text,jsonb) from public;
grant execute on function public.mcp_responder(text,uuid,text,text,text,jsonb) to anon, authenticated, service_role;

-- leer: cada mensaje trae es_humano (booleano, de autor_humano IS NOT NULL). El texto "humano"
-- se mantiene por compatibilidad, pero las IAs deben fiarse solo de es_humano.
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
                   'es_humano', (m.autor_humano is not null),
                   'cuerpo', m.cuerpo, 'creado_en', to_char(m.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                   'creado_en_cdmx', to_char(m.creado_en, 'DD/MM/YYYY HH24:MI') || ' (hora de CDMX)') order by m.creado_en), '[]')
                 from public.mensajes m left join public.agentes ag on ag.id = m.autor_agente where m.hilo_id = h.id),
    'aprobaciones', (select coalesce(jsonb_agg(jsonb_build_object('decision', decision, 'nota', nota, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.aprobaciones where hilo_id = h.id),
    'adjuntos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'tamano', tamano, 'mensaje_id', mensaje_id, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.adjuntos where hilo_id = h.id),
    'evidencias_cierre', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'mensaje_id', e.mensaje_id,
                   'agente', (select nombre from public.agentes g where g.id = e.agente_id),
                   'que_se_pidio', e.que_se_pidio, 'que_se_entrego', e.que_se_entrego,
                   'pruebas', e.pruebas, 'verificacion', e.verificacion,
                   'creado_en', to_char(e.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')) order by e.creado_en), '[]')
                 from public.evidencias_cierre e where e.hilo_id = h.id),
    'cierres', (select coalesce(jsonb_agg(jsonb_build_object('veredicto', c.veredicto, 'motivo', c.motivo,
                   'creado_en', to_char(c.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')) order by c.creado_en), '[]')
                 from public.cierres c where c.hilo_id = h.id));
end $$;
revoke all on function public.mcp_leer(text,uuid,text,int,text) from public;
grant execute on function public.mcp_leer(text,uuid,text,int,text) to anon, authenticated, service_role;
