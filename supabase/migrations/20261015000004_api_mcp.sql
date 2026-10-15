-- API del servidor MCP como funciones SECURITY DEFINER.
-- Así el servidor NO necesita la service_role: usa la clave pública (anon) y el token bz_ es la credencial.
-- Cada función valida el token (hash SHA-256, vigencia, revocación, alcance), fija el buzón y audita.

create or replace function public._mcp_ctx(p_token text, p_alcance text, p_ip text)
returns public.agentes language plpgsql security definer set search_path = public as $$
declare a public.agentes; n int;
begin
  if p_token is null or p_token !~ '^bz_[A-Za-z0-9_-]{20,}$' then raise exception '401:Falta token bz_ valido'; end if;
  select ag.* into a from public.tokens t join public.agentes ag on ag.id = t.agente_id
   where t.hash_token = encode(sha256(convert_to(p_token,'UTF8')),'hex')
     and t.revocado_en is null and t.vence_en > now() and p_alcance = any(t.alcances);
  if not found then raise exception '403:Token invalido, vencido, revocado o sin el alcance %', p_alcance; end if;
  select count(*) into n from public.auditoria where actor = 'agente:' || a.id and creado_en > now() - interval '1 minute';
  if n >= 60 then raise exception '429:Limite de 60 llamadas por minuto'; end if;
  update public.tokens set ultimo_uso = now() where hash_token = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  return a;
end $$;

create or replace function public._mcp_audit(a public.agentes, accion text, obj uuid, p_ip text)
returns void language sql security definer set search_path = public as $$
  insert into public.auditoria(buzon_id, actor, accion, objeto_id, ip)
  values (a.buzon_id, 'agente:' || a.id, accion, obj, case when p_ip ~ '^[0-9a-fA-F:.]+$' then p_ip::inet end);
$$;

create or replace function public.mcp_crear(p_token text, p_tipo text, p_titulo text, p_contexto text default null, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos;
begin
  a := public._mcp_ctx(p_token, 'crear', p_ip);
  insert into public.hilos(buzon_id, tipo, titulo, contexto, creado_por_agente)
    values (a.buzon_id, p_tipo, p_titulo, p_contexto, a.id) returning * into h;
  perform public._mcp_audit(a, 'crear', h.id, p_ip);
  return jsonb_build_object('id', h.id, 'estado', h.estado, 'creado_por', a.nombre);
end $$;

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
    'mensajes', (select coalesce(jsonb_agg(jsonb_build_object('autor', coalesce(ag.nombre,'humano'), 'cuerpo', m.cuerpo, 'creado_en', m.creado_en) order by m.creado_en), '[]')
                 from public.mensajes m left join public.agentes ag on ag.id = m.autor_agente where m.hilo_id = h.id),
    'aprobaciones', (select coalesce(jsonb_agg(jsonb_build_object('decision', decision, 'nota', nota, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.aprobaciones where hilo_id = h.id));
end $$;

create or replace function public.mcp_responder(p_token text, p_hilo_id uuid, p_cuerpo text, p_accion text default 'comentar', p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.agentes; h public.hilos; m uuid;
begin
  a := public._mcp_ctx(p_token, 'responder', p_ip);
  if p_accion not in ('comentar','tomar','pedir_aprobacion') then raise exception '400:accion no permitida (las IAs no aprueban)'; end if;
  select * into h from public.hilos where id = p_hilo_id and buzon_id = a.buzon_id for update;
  if not found then raise exception '404:Hilo no encontrado en tu buzon'; end if;
  if h.estado in ('aprobado','rechazado','cerrado') and p_accion <> 'comentar' then raise exception '409:El hilo ya esta %', h.estado; end if;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo) values (h.id, a.id, p_cuerpo) returning id into m;
  if p_accion = 'tomar' then update public.hilos set estado = 'tomado', tomado_por_agente = a.id where id = h.id returning * into h; end if;
  if p_accion = 'pedir_aprobacion' then update public.hilos set estado = 'pide_aprobacion' where id = h.id returning * into h; end if;
  perform public._mcp_audit(a, 'responder:' || p_accion, h.id, p_ip);
  return jsonb_build_object('mensaje_id', m, 'estado', h.estado);
end $$;

revoke all on function public._mcp_ctx(text,text,text), public._mcp_audit(public.agentes,text,uuid,text) from public, anon, authenticated;
revoke all on function public.mcp_crear(text,text,text,text,text), public.mcp_leer(text,uuid,text,int,text),
  public.mcp_responder(text,uuid,text,text,text) from public;
grant execute on function public.mcp_crear(text,text,text,text,text), public.mcp_leer(text,uuid,text,int,text),
  public.mcp_responder(text,uuid,text,text,text) to anon, authenticated, service_role;
