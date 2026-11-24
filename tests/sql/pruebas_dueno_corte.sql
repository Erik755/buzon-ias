-- Dueño y corte: por_dueno y hasta_mensaje_id en leer.
-- El corte lo fija el servidor al registrar la decisión. La IA no aprueba, no cierra y no se marca humana.

reset role;

create temp table _cz (k text primary key, id uuid);
grant all on _cz to anon, authenticated, service_role;
do $$
declare
  n int;
  ag uuid := 'bbbbbbbb-0000-0000-0000-0000000000d9';
  tok text := 'bz_' || repeat('q', 30);
  ha uuid; hb uuid; hc uuid; he uuid; hf uuid; hg uuid;
  m1 uuid; m2 uuid; mb uuid; me uuid;
begin
  select count(*) into n from public.agentes where buzon_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if n < 20 then
    insert into public.agentes(id, buzon_id, nombre) values (ag, 'aaaaaaaa-0000-0000-0000-000000000001', 'LectorCorte');
  else
    select a.id into ag from public.agentes a
     where a.buzon_id = 'aaaaaaaa-0000-0000-0000-000000000001' and a.eliminado_en is null
     order by (select count(*) from public.auditoria au where au.actor = 'agente:' || a.id::text) asc
     limit 1;
  end if;
  insert into public.tokens(agente_id, hash_token)
  values (ag, encode(sha256(convert_to(tok, 'UTF8')), 'hex'));
  insert into _cz values ('ag', ag), ('tok', null);
  perform set_config('buzon.corte_token', tok, false);

  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte hilo A', 'pide_aprobacion', ag) returning id into ha;
  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte hilo B', 'abierto', ag) returning id into hb;
  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte hilo C', 'pide_aprobacion', ag) returning id into hc;
  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte hilo E', 'pide_cierre', ag) returning id into he;
  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte hilo F', 'pide_aprobacion', ag) returning id into hf;
  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte hilo G', 'abierto', ag) returning id into hg;
  insert into _cz values ('a', ha), ('b', hb), ('c', hc), ('e', he), ('f', hf), ('g', hg);

  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (ha, ag, 'primero A', timestamptz '2020-01-01') returning id into m1;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (ha, ag, 'ultimo A', timestamptz '2020-01-02') returning id into m2;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (hb, ag, 'solo B', timestamptz '2020-01-03') returning id into mb;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (he, ag, 'antes del cierre', timestamptz '2020-01-04') returning id into me;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (hc, ag, 'viejo C', timestamptz '2020-01-05');
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (hc, ag, 'ultimo C', timestamptz '2020-01-06');
  insert into _cz values ('a1', m1), ('a2', m2), ('b1', mb), ('e1', me);
end $$;

-- 254-256 La credencial de una IA (rol anon + token) no concede decisiones ni autoría humana.
set role anon;
do $$
declare h uuid := (select id from _cz where k = 'g');
begin
  begin
    insert into public.aprobaciones(hilo_id, humano_id, decision)
    values (h, '11111111-1111-1111-1111-111111111111', 'aprobado');
    perform pg_temp.falla('254');
  exception when insufficient_privilege then
    perform pg_temp.ok('254 anon (token de IA) no inserta aprobaciones');
  end;
  begin
    insert into public.cierres(hilo_id, humano_id, veredicto)
    values (h, '11111111-1111-1111-1111-111111111111', 'aceptado');
    perform pg_temp.falla('255');
  exception when insufficient_privilege then
    perform pg_temp.ok('255 anon (token de IA) no inserta cierres');
  end;
  begin
    insert into public.mensajes(hilo_id, autor_humano, cuerpo)
    values (h, '11111111-1111-1111-1111-111111111111', 'me hago pasar por humano');
    perform pg_temp.falla('256');
  exception when insufficient_privilege then
    perform pg_temp.ok('256 anon no puede insertar autor_humano (no fija es_humano)');
  end;
  begin
    update public.mensajes set autor_humano = '11111111-1111-1111-1111-111111111111';
    perform pg_temp.falla('256b');
  exception when insufficient_privilege then
    perform pg_temp.ok('256b anon no puede reescribir un mensaje como humano');
  end;
end $$;
reset role;
do $$
declare
  tok text := current_setting('buzon.corte_token');
  g uuid := (select id from _cz where k = 'g');
  r jsonb; m jsonb;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'mensajes' and column_name = 'es_humano')
  then perform pg_temp.falla('257 hay una columna es_humano que se podria escribir'); else
    perform pg_temp.ok('257 es_humano no es una columna'); end if;
  r := public.mcp_responder(tok, g, 'comentario de la IA', 'comentar');
  if r->>'estado' is null then perform pg_temp.falla('258 responder ' || r::text); end if;
  select x into m from jsonb_array_elements(public.mcp_leer(tok, g)->'mensajes') x where x->>'cuerpo' = 'comentario de la IA';
  if (m->>'es_humano') = 'false' and (m->>'autor') <> 'humano'
  then perform pg_temp.ok('258 el mensaje de la IA sale con es_humano=false');
  else perform pg_temp.falla('258 ' || coalesce(m::text, 'null')); end if;
end $$;

-- 259 El cliente no elige el corte. 260 El dueño aprueba y leer lo muestra.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare
  h uuid := (select id from _cz where k = 'a');
  falso uuid := (select id from _cz where k = 'b1');
begin
  begin
    insert into public.aprobaciones(hilo_id, humano_id, decision, nota, hasta_mensaje_id)
    values (h, '11111111-1111-1111-1111-111111111111', 'aprobado', 'forjado', falso);
    perform pg_temp.falla('259 el cliente escribio hasta_mensaje_id');
  exception
    when insufficient_privilege then
      perform pg_temp.ok('259 un hasta_mensaje_id enviado por el cliente se rechaza');
    when others then
      perform pg_temp.falla('259 ' || sqlerrm);
  end;
  if exists (select 1 from public.aprobaciones where hilo_id = h) then
    perform pg_temp.falla('259b el rechazo dejo una aprobacion');
  else
    perform pg_temp.ok('259b no quedo aprobacion al rechazar el corte');
  end if;
  if (select estado from public.hilos where id = h) <> 'pide_aprobacion' then
    perform pg_temp.falla('259c el hilo cambio de estado');
  else
    perform pg_temp.ok('259c el hilo sigue pidiendo aprobacion');
  end if;
  insert into public.aprobaciones(hilo_id, humano_id, decision, nota)
  values (h, '11111111-1111-1111-1111-111111111111', 'aprobado', 'va el dueno');
end $$;
reset role;

do $$
declare
  tok text := current_setting('buzon.corte_token');
  ha uuid := (select id from _cz where k = 'a');
  hb uuid := (select id from _cz where k = 'b');
  m2 uuid := (select id from _cz where k = 'a2');
  leido jsonb; ap jsonb; texto text;
begin
  if (select hasta_mensaje_id from public.aprobaciones where hilo_id = ha) is distinct from m2 then
    perform pg_temp.falla('260 corte guardado ' || coalesce((select hasta_mensaje_id::text from public.aprobaciones where hilo_id = ha), 'null'));
  else
    perform pg_temp.ok('260 la aprobacion cubre el ultimo mensaje del hilo');
  end if;
  leido := public.mcp_leer(tok, ha);
  ap := leido->'aprobaciones'->0;
  if ap->>'decision' = 'aprobado' and ap->>'nota' = 'va el dueno'
     and ap->>'por_dueno' = 'true' and ap->>'hasta_mensaje_id' = m2::text
     and not (ap ? 'humano_id')
  then perform pg_temp.ok('261 leer muestra por_dueno=true y el corte, sin humano_id');
  else perform pg_temp.falla('261 ' || coalesce(ap::text, 'null')); end if;
  texto := leido::text;
  if position('11111111-1111-1111-1111-111111111111' in texto) > 0
     or position('22222222-2222-2222-2222-222222222222' in texto) > 0
     or position('erik@ejemplo.test' in texto) > 0
     or position('intruso@ejemplo.test' in texto) > 0
     or texto like '%humano_id%' or texto like '%dueno_id%' or texto like '%"email"%'
  then perform pg_temp.falla('262 leer filtra identidad');
  else perform pg_temp.ok('262 leer no incluye uuid ni correo del dueno'); end if;
  leido := public.mcp_leer(tok, hb);
  if leido->'aprobaciones' = '[]'::jsonb and leido->'cierres' = '[]'::jsonb
     and position('va el dueno' in leido::text) = 0
  then perform pg_temp.ok('263 la aprobacion del hilo A no aparece en el hilo B');
  else perform pg_temp.falla('263 ' || leido::text); end if;
end $$;

-- Un mensaje posterior no queda cubierto. El corte no se mueve.
do $$
declare
  tok text := current_setting('buzon.corte_token');
  ha uuid := (select id from _cz where k = 'a');
  ag uuid := (select id from _cz where k = 'ag');
  m2 uuid := (select id from _cz where k = 'a2');
  m3 uuid; ap jsonb;
begin
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (ha, ag, 'despues de aprobar', timestamptz '2024-06-01') returning id into m3;
  ap := public.mcp_leer(tok, ha)->'aprobaciones'->0;
  if ap->>'hasta_mensaje_id' = m2::text and m3 is distinct from m2
     and exists (select 1 from jsonb_array_elements(public.mcp_leer(tok, ha)->'mensajes') x where (x->>'id')::uuid = m3)
     and not exists (select 1 from public.aprobaciones where hilo_id = ha and hasta_mensaje_id = m3)
  then perform pg_temp.ok('264 el mensaje posterior no esta cubierto por la aprobacion');
  else perform pg_temp.falla('264 corte=' || coalesce(ap->>'hasta_mensaje_id','null') || ' nuevo=' || m3::text); end if;
end $$;

-- Aunque un rol privilegiado escriba el corte, el trigger lo sustituye por el ultimo mensaje real.
do $$
declare
  hc uuid := (select id from _cz where k = 'c');
  ajeno uuid := (select id from _cz where k = 'b1');
  ultimo uuid; guardado uuid;
begin
  select id into ultimo from public.mensajes where hilo_id = hc and cuerpo = 'ultimo C';
  insert into public.aprobaciones(hilo_id, humano_id, decision, nota, hasta_mensaje_id)
  values (hc, '11111111-1111-1111-1111-111111111111', 'rechazado', 'ignora el corte', ajeno);
  select hasta_mensaje_id into guardado from public.aprobaciones where hilo_id = hc;
  if guardado = ultimo and guardado is distinct from ajeno
  then perform pg_temp.ok('265 un hasta_mensaje_id privilegiado se ignora');
  else perform pg_temp.falla('265 guardado=' || coalesce(guardado::text,'null') || ' ultimo=' || coalesce(ultimo::text,'null')); end if;
end $$;

-- Un humano que no es el dueno (fila escrita fuera de RLS, solo para la marca) sale por_dueno=false, sin su uuid.
do $$
declare
  tok text := current_setting('buzon.corte_token');
  hb uuid := (select id from _cz where k = 'b');
  ap jsonb; texto text;
begin
  insert into public.aprobaciones(hilo_id, humano_id, decision, nota)
  values (hb, '22222222-2222-2222-2222-222222222222', 'aprobado', 'no soy el dueno');
  ap := public.mcp_leer(tok, hb)->'aprobaciones'->0;
  texto := public.mcp_leer(tok, hb)::text;
  if ap->>'por_dueno' = 'false' and ap->>'nota' = 'no soy el dueno' and not (ap ? 'humano_id')
     and position('22222222-2222-2222-2222-222222222222' in texto) = 0
     and position('intruso@ejemplo.test' in texto) = 0
     and position('11111111-1111-1111-1111-111111111111' in texto) = 0
  then perform pg_temp.ok('266 por_dueno=false cuando humano_id no es el dueno, sin filtrar su uuid');
  else perform pg_temp.falla('266 ' || coalesce(ap::text,'null')); end if;
end $$;

-- Cierre: el corte incluye la nota del veredicto y no los mensajes que vengan despues.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare
  he uuid := (select id from _cz where k = 'e');
  falso uuid := (select id from _cz where k = 'e1');
  ret text;
begin
  begin
    insert into public.cierres(hilo_id, humano_id, veredicto, hasta_mensaje_id)
    values (he, '11111111-1111-1111-1111-111111111111', 'aceptado', falso);
    perform pg_temp.falla('267 el cliente inserto un cierre');
  exception when insufficient_privilege then
    perform pg_temp.ok('267 el cliente no inserta cierres ni su corte');
  end;
  ret := public.decidir_cierre(he, false, 'sigue en el hilo');
  if ret <> 'abierto' then perform pg_temp.falla('268 ' || coalesce(ret,'null')); end if;
end $$;
reset role;
do $$
declare
  tok text := current_setting('buzon.corte_token');
  he uuid := (select id from _cz where k = 'e');
  ag uuid := (select id from _cz where k = 'ag');
  nota uuid; despues uuid; ci jsonb; texto text;
begin
  select id into nota from public.mensajes where hilo_id = he and cuerpo = 'sigue en el hilo' and autor_humano is not null;
  if (select hasta_mensaje_id from public.cierres where hilo_id = he) is distinct from nota then
    perform pg_temp.falla('268 corte del cierre');
  else
    perform pg_temp.ok('268 el cierre cubre la nota recien escrita');
  end if;
  ci := public.mcp_leer(tok, he)->'cierres'->0;
  texto := public.mcp_leer(tok, he)::text;
  if ci->>'veredicto' = 'rechazado' and ci->>'por_dueno' = 'true' and ci->>'hasta_mensaje_id' = nota::text
     and not (ci ? 'humano_id')
     and position('11111111-1111-1111-1111-111111111111' in texto) = 0
     and position('erik@ejemplo.test' in texto) = 0
     and texto not like '%humano_id%' and texto not like '%dueno_id%'
  then perform pg_temp.ok('269 leer muestra el cierre del dueno con corte y sin su identidad');
  else perform pg_temp.falla('269 ' || coalesce(ci::text,'null')); end if;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo, creado_en)
  values (he, ag, 'despues del cierre', timestamptz '2024-07-01') returning id into despues;
  if (select hasta_mensaje_id from public.cierres where hilo_id = he) = nota
     and despues is distinct from nota
  then perform pg_temp.ok('270 un mensaje posterior al cierre no queda cubierto');
  else perform pg_temp.falla('270'); end if;
end $$;

-- Hilo sin mensajes: el corte es null y sigue siendo del dueno.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare hf uuid := (select id from _cz where k = 'f');
begin
  insert into public.aprobaciones(hilo_id, humano_id, decision, nota)
  values (hf, '11111111-1111-1111-1111-111111111111', 'aprobado', 'sin mensajes');
end $$;
reset role;
do $$
declare
  tok text := current_setting('buzon.corte_token');
  hf uuid := (select id from _cz where k = 'f');
  ap jsonb;
begin
  ap := public.mcp_leer(tok, hf)->'aprobaciones'->0;
  if ap->>'por_dueno' = 'true' and ap->'hasta_mensaje_id' = 'null'::jsonb
     and (select hasta_mensaje_id is null from public.aprobaciones where hilo_id = hf)
  then perform pg_temp.ok('271 sin mensajes el corte queda null');
  else perform pg_temp.falla('271 ' || coalesce(ap::text,'null')); end if;
end $$;

-- service_role sigue sin poder insertar aprobaciones.
set role service_role;
do $$
declare h uuid := (select id from _cz where k = 'g');
begin
  begin
    insert into public.aprobaciones(hilo_id, humano_id, decision)
    values (h, '11111111-1111-1111-1111-111111111111', 'aprobado');
    perform pg_temp.falla('272');
  exception when insufficient_privilege then
    perform pg_temp.ok('272 service_role no inserta aprobaciones');
  end;
end $$;
reset role;

-- El corte no se mueve con un UPDATE directo, pero borrar el mensaje o el hilo sí puede limpiarlo.
do $$
declare
  ag uuid := (select id from _cz where k = 'ag');
  h uuid; m uuid; corte uuid; bz uuid;
begin
  insert into public.hilos(buzon_id, tipo, titulo, estado, creado_por_agente)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tarea', 'Corte para borrar', 'pide_aprobacion', ag)
  returning id into h;
  insert into public.mensajes(hilo_id, autor_agente, cuerpo) values (h, ag, 'cubierto') returning id into m;
  insert into public.aprobaciones(hilo_id, humano_id, decision) values (h, '11111111-1111-1111-1111-111111111111', 'aprobado');
  corte := (select hasta_mensaje_id from public.aprobaciones where hilo_id = h);
  update public.aprobaciones set hasta_mensaje_id = null, nota = 'intento' where hilo_id = h;
  if (select hasta_mensaje_id from public.aprobaciones where hilo_id = h) is distinct from corte then
    perform pg_temp.falla('273 un update directo movio el corte');
  else
    perform pg_temp.ok('273 un update directo no mueve el corte');
  end if;
  begin
    delete from public.mensajes where id = m;
    if (select hasta_mensaje_id is null from public.aprobaciones where hilo_id = h) then
      perform pg_temp.ok('274 borrar el mensaje cubierto deja el corte en null');
    else
      perform pg_temp.falla('274 el corte siguio apuntando al mensaje borrado');
    end if;
  exception when foreign_key_violation then
    perform pg_temp.falla('274 ' || sqlerrm);
  end;

  insert into auth.users(id, email) values ('33333333-3333-3333-3333-333333333333', 'corte-borrar@ejemplo.test');
  insert into public.buzones(dueno_id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Buzon corte') returning id into bz;
  insert into public.hilos(buzon_id, tipo, titulo) values (bz, 'tarea', 'Hilo del buzon') returning id into h;
  insert into public.mensajes(hilo_id, autor_humano, cuerpo) values (h, '33333333-3333-3333-3333-333333333333', 'nota');
  insert into public.aprobaciones(hilo_id, humano_id, decision) values (h, '33333333-3333-3333-3333-333333333333', 'aprobado');
  insert into public.cierres(hilo_id, humano_id, veredicto) values (h, '33333333-3333-3333-3333-333333333333', 'aceptado');
  begin
    delete from public.buzones where id = bz;
    if not exists (select 1 from public.hilos where id = h)
       and not exists (select 1 from public.aprobaciones where hilo_id = h)
       and not exists (select 1 from public.cierres where hilo_id = h)
    then perform pg_temp.ok('275 borrar el buzon arrastra hilo, aprobacion y cierre');
    else perform pg_temp.falla('275 quedaron filas'); end if;
  exception when foreign_key_violation then
    perform pg_temp.falla('275 ' || sqlerrm);
  end;
end $$;

\echo TODAS_LAS_PRUEBAS_PASARON
