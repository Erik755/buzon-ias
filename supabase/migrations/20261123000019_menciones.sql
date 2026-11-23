-- 019: menciones @Nombre. Aditiva. No modifica migraciones ya aplicadas.
-- Parsea @menciones en mensajes nuevos y en título/contexto de hilos nuevos
-- (humano o IA), despierta a esa IA por su webhook aunque no esté marcada en
-- el hilo y aunque no lo haya leído, y devuelve el resultado en mcp_crear /
-- mcp_responder. Una mención no suscribe, no asigna el hilo y no da derecho
-- a aprobar ni a cerrar.
--
-- Tope: 8 menciones resueltas por texto. IA: como mucho un aviso por agente
-- y hilo cada 60 s, y 5 avisos de mención por autor y hora. Humano: un aviso
-- por agente y hilo cada 10 s (ráfaga). Siguen el freno de 20 mensajes entre
-- IAs y la ráfaga B2 de hilos nuevos. El autor no se avisa a sí mismo.
-- Un alias que coincide con más de un agente activo del mismo buzón no avisa
-- y queda como ambiguo.

-- ============ Normalización (sin distinguir mayúsculas ni tildes) ============
create or replace function public.mencion_norm(p text) returns text
language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select nullif(regexp_replace(translate(lower(normalize(p, NFKC)),
    'áàäâãåéèëêíìïîóòöôõúùüûýÿñç',
    'aaaaaaeeeeiiiiooooouuuyync'), '[^a-z0-9]', '', 'g'), '');
$$;
revoke all on function public.mencion_norm(text) from public, anon, authenticated;
grant execute on function public.mencion_norm(text) to anon, authenticated, service_role;

-- ============ Alias por agente ============
create table public.agente_alias (
  agente_id uuid not null references public.agentes(id) on delete cascade,
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  alias text not null check (length(alias) between 2 and 40),
  alias_norm text not null check (alias_norm ~ '^[a-z0-9]{2,40}$'),
  origen text not null default 'conocido' check (origen in ('conocido', 'dueno')),
  primary key (agente_id, alias_norm)
);
create index agente_alias_norm_idx on public.agente_alias(buzon_id, alias_norm);
comment on table public.agente_alias is
  'Alias con los que se puede mencionar a un agente (@grok, @grokbot). No guarda webhooks ni secretos.';

alter table public.agente_alias enable row level security;
alter table public.agente_alias force row level security;
revoke all on public.agente_alias from public, anon, authenticated;
grant select on public.agente_alias to authenticated;
drop policy if exists agente_alias_dueno on public.agente_alias;
create policy agente_alias_dueno on public.agente_alias
  for select to authenticated using (public.es_dueno(buzon_id));

-- Alias cortos de nombres conocidos. Solo se suman al nombre; no se cruzan
-- entre dos agentes distintos salvo que el dueño (o dos nombres) los hagan coincidir.
create or replace function public._alias_conocidos(p_norm text) returns text[]
language sql immutable set search_path = public as $$
  select case p_norm
    when 'grok' then array['grokbot', 'xaigrok']
    when 'grokbot' then array['grok', 'xaigrok']
    when 'xaigrok' then array['grok', 'grokbot']
    when 'chatgpt' then array['openai', 'chatgptweb']
    when 'claude' then array['claudecode', 'claudedesktop', 'anthropic']
    when 'claudecode' then array['claude']
    when 'claudedesktop' then array['claude']
    when 'gemini' then array['geminicli', 'googlegemini']
    when 'geminicli' then array['gemini']
    when 'copilot' then array['githubcopilot', 'vscode']
    when 'githubcopilot' then array['copilot', 'vscode']
    when 'cursor' then array['cursoride']
    when 'cursoride' then array['cursor']
    when 'codex' then array['openaicodex']
    when 'perplexity' then array['perplexityai']
    when 'antigravity' then array['googleantigravity']
    when 'googleantigravity' then array['antigravity']
    when 'instinct' then array['instinctmovil']
    when 'labelboxrecursion' then array['labelbox', 'recursion']
    when 'labelbox' then array['labelboxrecursion']
    else '{}'::text[]
  end;
$$;
revoke all on function public._alias_conocidos(text) from public, anon, authenticated;

create or replace function public._sincronizar_alias_conocidos(p_agente uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nom text; b uuid; n text; lista text[];
begin
  select nombre, buzon_id into nom, b from public.agentes where id = p_agente and eliminado_en is null;
  if b is null then return; end if;
  n := public.mencion_norm(nom);
  lista := coalesce(public._alias_conocidos(n), '{}');
  if n = any(lista) then lista := array_remove(lista, n); end if;
  lista := array(select x from unnest(lista) x
    where x is not null and x !~ '^(humano|human|owner|dueno)$' and x <> coalesce(n, ''));
  delete from public.agente_alias
   where agente_id = p_agente and origen = 'conocido'
     and not (alias_norm = any(lista));
  insert into public.agente_alias(agente_id, buzon_id, alias, alias_norm, origen)
  select p_agente, b, x, x, 'conocido' from unnest(lista) x
  on conflict (agente_id, alias_norm) do nothing;
end $$;
revoke all on function public._sincronizar_alias_conocidos(uuid) from public, anon, authenticated;

create or replace function public.agentes_alias_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.eliminado_en is not null then
    delete from public.agente_alias where agente_id = new.id;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.nombre is not distinct from old.nombre and old.eliminado_en is null then
    return new;
  end if;
  perform public._sincronizar_alias_conocidos(new.id);
  return new;
end $$;
revoke all on function public.agentes_alias_sync() from public, anon, authenticated;
drop trigger if exists agentes_alias_sync on public.agentes;
create trigger agentes_alias_sync after insert or update of nombre, eliminado_en on public.agentes
  for each row execute function public.agentes_alias_sync();

do $$
declare r uuid;
begin
  for r in select id from public.agentes where eliminado_en is null loop
    perform public._sincronizar_alias_conocidos(r);
  end loop;
end $$;

-- El dueño agrega o quita un alias propio (los conocidos se recalculan del nombre).
create or replace function public.guardar_alias_agente(p_agente uuid, p_alias text, p_activo boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare b uuid; n text; cambio uuid;
begin
  if auth.uid() is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p_activo is null then raise exception 'p_activo requerido' using errcode = '22004'; end if;
  select a.buzon_id into b from public.agentes a
   where a.id = p_agente and a.eliminado_en is null and public.es_dueno(a.buzon_id);
  if b is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  n := public.mencion_norm(p_alias);
  if n is null or length(n) < 2 or length(n) > 40 or n in ('humano', 'human', 'owner', 'dueno') then
    raise exception 'alias no valido' using errcode = '22023';
  end if;
  if p_activo then
    insert into public.agente_alias(agente_id, buzon_id, alias, alias_norm, origen)
      values (p_agente, b, left(trim(p_alias), 40), n, 'dueno')
      on conflict (agente_id, alias_norm) do update
        set alias = excluded.alias
        where public.agente_alias.origen = 'dueno'
      returning agente_id into cambio;
    if cambio is not null then
      insert into public.auditoria(buzon_id, actor, accion, objeto_id)
        values (b, 'humano:' || auth.uid(), 'alias:agregar', p_agente);
    end if;
  else
    delete from public.agente_alias
     where agente_id = p_agente and alias_norm = n and origen = 'dueno'
     returning agente_id into cambio;
    if cambio is not null then
      insert into public.auditoria(buzon_id, actor, accion, objeto_id)
        values (b, 'humano:' || auth.uid(), 'alias:quitar', p_agente);
    end if;
  end if;
  return coalesce(p_activo and cambio is not null, false) or (not p_activo and cambio is not null);
end $$;
revoke all on function public.guardar_alias_agente(uuid, text, boolean) from public, anon;
grant execute on function public.guardar_alias_agente(uuid, text, boolean) to authenticated;

-- ============ Menciones resueltas (sin URLs ni secretos) ============
create table public.menciones (
  id uuid primary key default gen_random_uuid(),
  buzon_id uuid not null references public.buzones(id) on delete cascade,
  hilo_id uuid not null references public.hilos(id) on delete cascade,
  mensaje_id uuid references public.mensajes(id) on delete cascade,
  notificacion_id bigint not null references public.notificaciones(id) on delete cascade,
  agente_id uuid references public.agentes(id) on delete set null,
  token text not null check (length(token) between 1 and 40),
  token_norm text not null check (length(token_norm) between 2 and 40),
  orden int not null check (orden > 0),
  estado text not null check (estado in (
    'notificada', 'autor', 'ambigua', 'desconocida', 'sin_webhook', 'limitada', 'bucle', 'rafaga', 'excedida')),
  creado_en timestamptz not null default now()
);
create index menciones_notif_idx on public.menciones(notificacion_id);
create index menciones_hilo_idx on public.menciones(hilo_id, agente_id);
create index menciones_mensaje_idx on public.menciones(mensaje_id);
comment on table public.menciones is
  'Resolución de cada @mencion. estado=notificada significa que se encoló el aviso; no es una entrega. No guarda webhooks.';

alter table public.menciones enable row level security;
alter table public.menciones force row level security;
revoke all on public.menciones from public, anon, authenticated;
grant select on public.menciones to authenticated;
drop policy if exists menciones_dueno on public.menciones;
create policy menciones_dueno on public.menciones
  for select to authenticated using (public.es_dueno(buzon_id));

-- Quita bloques ``` ``` y código entre comillas simples invertidas. Solo cuenta
-- una @ al inicio o después de espacio (un correo no es una mención).
create or replace function public.extraer_menciones(p_texto text)
returns table(orden int, token text)
language plpgsql immutable set search_path = public as $$
declare
  limpio text := coalesce(p_texto, '');
  rec record;
  i int := 0;
begin
  limpio := regexp_replace(limpio, '```[\s\S]*?```', ' ', 'g');
  limpio := regexp_replace(limpio, '`[^`\n]*`', ' ', 'g');
  for rec in
    select x[1] as tok
      from regexp_matches(limpio,
        '(?:^|[[:space:]])@([A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ][A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ0-9_-]{0,39})', 'g') as x
  loop
    i := i + 1;
    exit when i > 32;
    orden := i;
    token := rec.tok;
    return next;
  end loop;
end $$;
revoke all on function public.extraer_menciones(text) from public, anon, authenticated;

create or replace function public._registrar_menciones(
  p_notif bigint, p_buzon uuid, p_hilo uuid, p_mensaje uuid,
  p_autor uuid, p_humano boolean, p_texto text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  n public.notificaciones;
  rec record;
  norm text;
  consideradas int := 0;
  ya int := 0;
  ncoinc int;
  dest uuid;
  tiene boolean;
  est text;
  freno text := null;
  seguidos int;
  nuevos int;
  hora int;
  hilo_en timestamptz;
begin
  select * into n from public.notificaciones where id = p_notif;
  if not found then return; end if;
  if not coalesce(p_humano, false) and n.evento = 'mensaje_nuevo' then
    select count(*) into seguidos from public.mensajes m
     where m.hilo_id = p_hilo and m.autor_agente is not null and m.creado_en <= n.creado_en
       and m.creado_en > coalesce((select max(x.creado_en) from public.mensajes x
            where x.hilo_id = p_hilo and x.autor_humano is not null and x.creado_en <= n.creado_en), '-infinity');
    if seguidos >= 20 then freno := 'bucle'; end if;
  elsif not coalesce(p_humano, false) and n.evento = 'hilo_nuevo' and p_autor is not null then
    select creado_en into hilo_en from public.hilos where id = p_hilo;
    select count(*) into nuevos from public.hilos x
     where x.buzon_id = p_buzon and x.creado_por_agente = p_autor
       and x.creado_en <= hilo_en and x.creado_en > hilo_en - interval '1 hour'
       and x.creado_en > coalesce((select max(m.creado_en) from public.mensajes m
            join public.hilos y on y.id = m.hilo_id
            where y.buzon_id = p_buzon and m.autor_humano is not null and m.creado_en <= hilo_en), '-infinity');
    if nuevos > 10 then freno := 'rafaga'; end if;
  end if;

  for rec in select * from public.extraer_menciones(p_texto) loop
    norm := public.mencion_norm(rec.token);
    if norm is null or length(norm) < 2 then continue; end if;
    if consideradas >= 8 then
      insert into public.menciones(buzon_id, hilo_id, mensaje_id, notificacion_id, token, token_norm, orden, estado)
        values (p_buzon, p_hilo, p_mensaje, p_notif, left(rec.token, 40), norm, rec.orden, 'excedida');
      continue;
    end if;
    consideradas := consideradas + 1;
    select count(*), (array_agg(a.id order by a.creado_en, a.id))[1]
      into ncoinc, dest
      from public.agentes a
     where a.buzon_id = p_buzon and a.eliminado_en is null
       and (public.mencion_norm(a.nombre) = norm
            or exists (select 1 from public.agente_alias al
                        where al.agente_id = a.id and al.buzon_id = p_buzon and al.alias_norm = norm));
    if ncoinc = 0 then
      est := 'desconocida'; dest := null;
    elsif ncoinc > 1 then
      est := 'ambigua'; dest := null;
    elsif dest = p_autor and not coalesce(p_humano, false) then
      est := 'autor';
    elsif exists (select 1 from public.menciones mn
                    where mn.notificacion_id = p_notif and mn.agente_id = dest and mn.estado = 'notificada') then
      est := 'notificada';
    elsif freno is not null then
      est := freno;
    else
      select (a.webhook_url is not null and (a.webhook_secreto is not null or a.webhook_clave is not null))
        into tiene from public.agentes a where a.id = dest;
      if not coalesce(tiene, false) then
        est := 'sin_webhook';
      elsif not coalesce(p_humano, false) and exists (
        select 1 from public.menciones mn
          join public.notificaciones nt on nt.id = mn.notificacion_id
         where mn.notificacion_id <> p_notif and mn.hilo_id = p_hilo and mn.agente_id = dest
           and mn.estado = 'notificada' and nt.origen_humano is not true
           and nt.creado_en > n.creado_en - interval '60 seconds') then
        est := 'limitada';
      elsif not coalesce(p_humano, false) then
        select count(*) into hora from (
          select distinct mn.notificacion_id, mn.agente_id
            from public.menciones mn
            join public.notificaciones nt on nt.id = mn.notificacion_id
           where mn.notificacion_id <> p_notif and mn.estado = 'notificada'
             and nt.buzon_id = p_buzon and nt.agente_origen = p_autor and nt.origen_humano is not true
             and nt.creado_en > n.creado_en - interval '1 hour') q;
        if hora + ya >= 5 then est := 'limitada';
        else est := 'notificada'; ya := ya + 1; end if;
      elsif exists (
        select 1 from public.menciones mn
          join public.notificaciones nt on nt.id = mn.notificacion_id
         where mn.notificacion_id <> p_notif and mn.hilo_id = p_hilo and mn.agente_id = dest
           and mn.estado = 'notificada' and nt.origen_humano
           and nt.creado_en > n.creado_en - interval '10 seconds') then
        est := 'limitada';
      else
        est := 'notificada';
      end if;
    end if;
    insert into public.menciones(buzon_id, hilo_id, mensaje_id, notificacion_id, agente_id, token, token_norm, orden, estado)
      values (p_buzon, p_hilo, p_mensaje, p_notif, dest, left(rec.token, 40), norm, rec.orden, est);
  end loop;
end $$;
revoke all on function public._registrar_menciones(bigint, uuid, uuid, uuid, uuid, boolean, text) from public, anon, authenticated;

create or replace function public._informe_menciones(p_notif bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'notificadas', coalesce((
      select jsonb_agg(jsonb_build_object('agente', g.nombre, 'tokens', g.tokens) order by g.min_orden)
        from (
          select a.nombre, jsonb_agg(mn.token order by mn.orden) as tokens, min(mn.orden) as min_orden
            from public.menciones mn
            join public.agentes a on a.id = mn.agente_id
           where mn.notificacion_id = p_notif and mn.estado = 'notificada'
           group by a.nombre
        ) g
    ), '[]'::jsonb),
    'no_reconocidas', coalesce((
      select jsonb_agg(mn.token order by mn.orden) from public.menciones mn
       where mn.notificacion_id = p_notif and mn.estado = 'desconocida'
    ), '[]'::jsonb),
    'ambiguas', coalesce((
      select jsonb_agg(mn.token order by mn.orden) from public.menciones mn
       where mn.notificacion_id = p_notif and mn.estado = 'ambigua'
    ), '[]'::jsonb),
    'sin_aviso', coalesce((
      select jsonb_agg(jsonb_build_object('token', mn.token, 'agente', a.nombre, 'motivo', mn.estado) order by mn.orden)
        from public.menciones mn
        left join public.agentes a on a.id = mn.agente_id
       where mn.notificacion_id = p_notif
         and mn.estado not in ('notificada', 'desconocida', 'ambigua')
    ), '[]'::jsonb)
  );
$$;
revoke all on function public._informe_menciones(bigint) from public, anon, authenticated;

-- Liga el aviso de un mensaje con ese mensaje, para que mcp_responder informe
-- sus menciones aunque otro mensaje del mismo hilo se encole en paralelo.
alter table public.notificaciones add column if not exists mensaje_id uuid references public.mensajes(id) on delete set null;
create index if not exists notificaciones_mensaje_idx on public.notificaciones(mensaje_id);

-- ============ Encolar: mismos avisos de siempre + registro de menciones ============
create or replace function public.encolar_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
declare nid bigint; b uuid;
begin
  select h.buzon_id into b from public.hilos h where h.id = new.hilo_id and h.estado <> 'cerrado';
  if b is null then return new; end if;
  insert into public.notificaciones(buzon_id, hilo_id, evento, agente_origen, origen_humano, mensaje_id)
    values (b, new.hilo_id, 'mensaje_nuevo', new.autor_agente, new.autor_agente is null, new.id)
    returning id into nid;
  perform public._registrar_menciones(nid, b, new.hilo_id, new.id, new.autor_agente, new.autor_agente is null, new.cuerpo);
  return new;
end $$;
revoke all on function public.encolar_mensaje() from public, anon, authenticated;

create or replace function public.encolar_notificacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if tg_op = 'INSERT' then
    insert into public.notificaciones(buzon_id, hilo_id, evento, agente_origen, origen_humano)
      values (new.buzon_id, new.id, 'hilo_nuevo', new.creado_por_agente, new.creado_por_agente is null)
      returning id into nid;
    perform public._registrar_menciones(nid, new.buzon_id, new.id, null, new.creado_por_agente,
      new.creado_por_agente is null, concat_ws(E'\n', new.titulo, new.contexto));
  elsif new.estado = 'pide_aprobacion' and old.estado is distinct from 'pide_aprobacion' then
    insert into public.notificaciones(buzon_id, hilo_id, evento) values (new.buzon_id, new.id, 'pide_aprobacion');
  elsif new.estado = 'pide_cierre' and old.estado is distinct from 'pide_cierre' then
    insert into public.notificaciones(buzon_id, hilo_id, evento, agente_origen) values (new.buzon_id, new.id, 'pide_cierre', null);
  end if;
  return new;
end $$;
revoke all on function public.encolar_notificacion() from public, anon, authenticated;

-- Destinos: el camino de la 017 (participantes, suscripción, frenos) más las
-- menciones ya marcadas notificada. Una fila por agente. Sin secretos de más.
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
    if seguidos >= 20 then return; end if;
  end if;
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
         (
           n.evento = 'mensaje_nuevo'
           and exists (select 1 from public.hilo_suscripciones s where s.hilo_id = h.id and s.agente_id = a.id)
           and not exists (
                 select 1 from public.notificaciones p
                  where p.hilo_id = h.id and p.id < n.id and ('wh:' || a.id::text) = any(p.entregados)
                    and p.creado_en > n.creado_en - interval '10 seconds')
         )
         or
         (
           exists (select 1 from public.menciones mn
                    where mn.notificacion_id = n.id and mn.agente_id = a.id and mn.estado = 'notificada')
         )
       );
end $$;
revoke all on function public._destinos_webhook(bigint) from public, anon, authenticated;
grant execute on function public._destinos_webhook(bigint) to service_role;

-- ============ MCP: mismo contrato, más la clave menciones ============
create or replace function public.mcp_crear(p_token text, p_tipo text, p_titulo text, p_contexto text default null, p_ip text default null, p_para text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; dest uuid; n int; nid bigint;
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
  -- El aviso de este insert (el hilo_nuevo de este hilo), no el mensaje_nuevo más nuevo.
  select id into nid from public.notificaciones
   where hilo_id = h.id and evento = 'hilo_nuevo'
   order by id asc
   limit 1;
  perform public._mcp_audit(a, 'crear', h.id, p_ip);
  return jsonb_build_object('id', h.id, 'estado', h.estado, 'creado_por', a.nombre,
    'para', (select nombre from public.agentes where id = dest),
    'menciones', public._informe_menciones(nid));
end $$;
revoke all on function public.mcp_crear(text,text,text,text,text,text) from public;
grant execute on function public.mcp_crear(text,text,text,text,text,text) to anon, authenticated, service_role;

create or replace function public.mcp_responder(p_token text, p_hilo_id uuid, p_cuerpo text, p_accion text default 'comentar', p_ip text default null, p_evidencia jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; m uuid; ev jsonb; prueba jsonb; n int; nid bigint;
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
  select id into nid from public.notificaciones where mensaje_id = m and evento = 'mensaje_nuevo' limit 1;
  perform public._mcp_audit(a, 'responder:' || p_accion, h.id, p_ip);
  return jsonb_build_object('mensaje_id', m, 'estado', h.estado,
    'evidencia', case when p_accion = 'pedir_cierre' then (p_evidencia is not null) else null end,
    'menciones', public._informe_menciones(nid));
end $$;
revoke all on function public.mcp_responder(text,uuid,text,text,text,jsonb) from public;
grant execute on function public.mcp_responder(text,uuid,text,text,text,jsonb) to anon, authenticated, service_role;

-- La PWA: sugerencias de @ y el estado de cada mención (avisado / descartado / pendiente).
create or replace function public.menciones_sugerencias(p_hilo uuid)
returns table(id uuid, nombre text, etiqueta text)
language plpgsql stable security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  select h.buzon_id into b from public.hilos h where h.id = p_hilo and public.es_dueno(h.buzon_id);
  if b is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  return query
    select a.id, a.nombre, a.nombre as etiqueta
      from public.agentes a
     where a.buzon_id = b and a.eliminado_en is null
    union all
    select a.id, a.nombre, al.alias
      from public.agente_alias al
      join public.agentes a on a.id = al.agente_id
     where al.buzon_id = b and a.eliminado_en is null
     order by 2, 3;
end $$;
revoke all on function public.menciones_sugerencias(uuid) from public, anon;
grant execute on function public.menciones_sugerencias(uuid) to authenticated;

create or replace function public.menciones_del_hilo(p_hilo uuid)
returns table(mensaje_id uuid, token text, agente_id uuid, agente text, estado text, entrega text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  if not exists (select 1 from public.hilos h where h.id = p_hilo and public.es_dueno(h.buzon_id)) then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  return query
    select mn.mensaje_id, mn.token, mn.agente_id,
           case when ag.id is null then null when ag.eliminado_en is not null then 'agente eliminado' else ag.nombre end,
           mn.estado,
           case
             when mn.estado <> 'notificada' or mn.agente_id is null then null
             when ('wh:' || mn.agente_id::text) = any(nt.entregados) then 'avisado'
             when exists (select 1 from unnest(nt.descartados) d where split_part(d, '|', 1) = 'wh:' || mn.agente_id::text) then 'descartado'
             when nt.estado = 'fallida' then 'descartado'
             else 'pendiente'
           end
      from public.menciones mn
      join public.notificaciones nt on nt.id = mn.notificacion_id
      left join public.agentes ag on ag.id = mn.agente_id
     where mn.hilo_id = p_hilo
     order by mn.orden, mn.token;
end $$;
revoke all on function public.menciones_del_hilo(uuid) from public, anon;
grant execute on function public.menciones_del_hilo(uuid) to authenticated;
