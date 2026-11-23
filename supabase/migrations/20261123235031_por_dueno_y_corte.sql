-- Marca de dueño y corte de la decisión.
-- por_dueno se calcula al leer (humano_id = buzones.dueno_id) y no se guarda: leer no devuelve
-- el uuid ni el correo. hasta_mensaje_id es el último mensaje insertado en el hilo en el
-- momento de la decisión. Lo escribe un trigger; el cliente no tiene privilegio para mandarlo.
-- Las filas anteriores a esta migración quedan con corte null (no se rellenan: el último
-- mensaje de ahora no es el que había cuando se decidió).

-- Orden de inserción. creado_en lo puede elegir quien inserta el mensaje; ingreso no.
alter table public.mensajes
  add column ingreso bigint generated always as identity;
comment on column public.mensajes.ingreso is
  'Orden de inserción. Lo asigna la base; no identifica al autor.';
create index mensajes_hilo_ingreso_idx on public.mensajes (hilo_id, ingreso desc);

alter table public.aprobaciones
  add column hasta_mensaje_id uuid references public.mensajes(id) on delete set null;
alter table public.cierres
  add column hasta_mensaje_id uuid references public.mensajes(id) on delete set null;
comment on column public.aprobaciones.hasta_mensaje_id is
  'Último mensaje del hilo al registrar la aprobación. Los mensajes posteriores no quedan cubiertos.';
comment on column public.cierres.hasta_mensaje_id is
  'Último mensaje del hilo al registrar el veredicto. Los mensajes posteriores no quedan cubiertos.';

-- Misma fila de hilo que mcp_responder y decidir_cierre, para que el corte vea el mensaje que acaba de entrar.
create or replace function public.mensajes_bloquear_hilo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.hilos where id = new.hilo_id for update;
  return new;
end $$;
drop trigger if exists mensajes_bloquear_hilo on public.mensajes;
create trigger mensajes_bloquear_hilo before insert on public.mensajes
  for each row execute function public.mensajes_bloquear_hilo();

create or replace function public.fijar_hasta_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.hasta_mensaje_id := old.hasta_mensaje_id;
    return new;
  end if;
  perform 1 from public.hilos where id = new.hilo_id for update;
  select m.id into new.hasta_mensaje_id
    from public.mensajes m
   where m.hilo_id = new.hilo_id
   order by m.ingreso desc
   limit 1;
  return new;
end $$;
drop trigger if exists aprobaciones_corte on public.aprobaciones;
create trigger aprobaciones_corte before insert or update on public.aprobaciones
  for each row execute function public.fijar_hasta_mensaje();
drop trigger if exists cierres_corte on public.cierres;
create trigger cierres_corte before insert or update on public.cierres
  for each row execute function public.fijar_hasta_mensaje();
revoke all on function public.mensajes_bloquear_hilo(), public.fijar_hasta_mensaje() from public, anon, authenticated;

-- El INSERT de tabla cubría la columna nueva. Se vuelve a dar solo sobre las columnas de antes.
revoke insert on public.aprobaciones from authenticated;
grant insert (id, hilo_id, humano_id, decision, nota, creado_en) on public.aprobaciones to authenticated;

-- leer: por_dueno y hasta_mensaje_id en cada aprobación y cada cierre. Sin uuid ni correo.
create or replace function public.mcp_leer(p_token text, p_hilo_id uuid default null, p_estado text default null, p_limite int default 20, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public set timezone = 'America/Mexico_City' as $$
declare a public.agentes; h public.hilos; r jsonb; dueno uuid; lim int := least(greatest(coalesce(p_limite, 20), 1), 100);
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
  select b.dueno_id into dueno from public.buzones b where b.id = h.buzon_id;
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
                   'creado_en_cdmx', to_char(m.creado_en, 'DD/MM/YYYY HH24:MI') || ' (hora de CDMX)') order by m.creado_en, m.ingreso), '[]')
                 from public.mensajes m left join public.agentes ag on ag.id = m.autor_agente where m.hilo_id = h.id),
    'aprobaciones', (select coalesce(jsonb_agg(jsonb_build_object(
                   'decision', ap.decision, 'nota', ap.nota, 'creado_en', ap.creado_en,
                   'por_dueno', (ap.humano_id = dueno),
                   'hasta_mensaje_id', ap.hasta_mensaje_id) order by ap.creado_en, ap.id), '[]')
                 from public.aprobaciones ap where ap.hilo_id = h.id),
    'adjuntos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'tipo', tipo, 'tamano', tamano, 'mensaje_id', mensaje_id, 'creado_en', creado_en) order by creado_en), '[]')
                 from public.adjuntos where hilo_id = h.id),
    'evidencias_cierre', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'mensaje_id', e.mensaje_id,
                   'agente', (select nombre from public.agentes g where g.id = e.agente_id),
                   'que_se_pidio', e.que_se_pidio, 'que_se_entrego', e.que_se_entrego,
                   'pruebas', e.pruebas, 'verificacion', e.verificacion,
                   'creado_en', to_char(e.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')) order by e.creado_en), '[]')
                 from public.evidencias_cierre e where e.hilo_id = h.id),
    'cierres', (select coalesce(jsonb_agg(jsonb_build_object(
                   'veredicto', c.veredicto, 'motivo', c.motivo,
                   'creado_en', to_char(c.creado_en, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                   'por_dueno', (c.humano_id = dueno),
                   'hasta_mensaje_id', c.hasta_mensaje_id) order by c.creado_en, c.id), '[]')
                 from public.cierres c where c.hilo_id = h.id));
end $$;
revoke all on function public.mcp_leer(text,uuid,text,int,text) from public;
grant execute on function public.mcp_leer(text,uuid,text,int,text) to anon, authenticated, service_role;
