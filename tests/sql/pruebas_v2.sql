-- Pruebas v2: push, webhooks, notificaciones, adjuntos y códigos de configuración.
reset role;
insert into public.agentes(id,buzon_id,nombre) values
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Codex'),
  ('bbbbbbbb-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000002','AgenteAjeno');
insert into public.hilos(id,buzon_id,tipo,titulo) values
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','tarea','Hilo v2'),
  ('cccccccc-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000002','tarea','Hilo ajeno');
insert into public.tokens(agente_id,hash_token) values ('bbbbbbbb-0000-0000-0000-000000000001', encode(sha256(convert_to('bz_'||repeat('v',30),'UTF8')),'hex'));

-- 40-42 Notificaciones encoladas por trigger
do $$ begin
  if (select count(*) from public.notificaciones where hilo_id='cccccccc-0000-0000-0000-000000000002' and evento='hilo_nuevo')=1
  then perform pg_temp.ok('40 hilo nuevo encola notificación'); else perform pg_temp.falla('40'); end if;
  update public.hilos set estado='pide_aprobacion' where id='cccccccc-0000-0000-0000-000000000002';
  update public.hilos set titulo='x' where id='cccccccc-0000-0000-0000-000000000002';
  if (select count(*) from public.notificaciones where hilo_id='cccccccc-0000-0000-0000-000000000002')=2
  then perform pg_temp.ok('41 pedir aprobación encola 1 aviso, cambiar título no'); else perform pg_temp.falla('41'); end if;
end $$;
set role service_role;
do $$ declare n int; begin
  select count(*) into n from public._tomar_notificaciones(50);
  if n >= 2 and not exists (select 1 from public._tomar_notificaciones(50)) then perform pg_temp.ok('42 el notificador toma lotes sin repetir (backoff)'); else perform pg_temp.falla('42'); end if;
end $$;
reset role;
do $$ declare i bigint; begin
  select id into i from public.notificaciones where hilo_id='cccccccc-0000-0000-0000-000000000002' limit 1;
  update public.notificaciones set intentos=3 where id=i;
  perform public._cerrar_notificacion(i, false, repeat('e', 1000));
  if (select estado='fallida' and length(ultimo_error)=300 from public.notificaciones where id=i) then perform pg_temp.ok('43 tras 3 intentos queda fallida; error recortado'); else perform pg_temp.falla('43'); end if;
end $$;

-- 44-49 Push: RLS por buzón y dueño
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin
  insert into public.push_suscripciones(buzon_id,humano_id,endpoint,p256dh,auth) values
    ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','https://fcm.googleapis.com/fcm/send/e1', repeat('B',87), repeat('a',22));
  perform pg_temp.ok('44 Erik guarda su suscripción push');
  begin insert into public.push_suscripciones(buzon_id,humano_id,endpoint,p256dh,auth) values
    ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','http://inseguro/x', repeat('B',87), repeat('a',22));
    perform pg_temp.falla('45'); exception when check_violation then perform pg_temp.ok('45 endpoint push sin https rechazado'); end;
  declare u text; begin
    foreach u in array array['https://10.0.0.5:8443/x','https://metadata.google.internal/x','https://fcm.googleapis.com.evil.com/x','https://evil.com/fcm.googleapis.com/','https://fcm.googleapis.com:8443/x','https://push.apple.com.evil.com/x'] loop
      begin insert into public.push_suscripciones(buzon_id,humano_id,endpoint,p256dh,auth) values
        ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',u, repeat('B',87), repeat('a',22));
        perform pg_temp.falla('45b '||u); exception when check_violation then null; end;
    end loop;
    insert into public.push_suscripciones(buzon_id,humano_id,endpoint,p256dh,auth) values
      ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','https://web.push.apple.com/abc', repeat('B',87), repeat('a',22)),
      ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','https://updates.push.services.mozilla.com/wpush/v2/x', repeat('B',87), repeat('a',22)),
      ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','https://wns2-par02p.notify.windows.com/w/?token=x', repeat('B',87), repeat('a',22));
    perform pg_temp.ok('45b push solo a FCM, Mozilla, Apple y Windows (IPs, metadata, puertos y dominios parecidos rechazados)');
  end;
  begin perform public._tomar_notificaciones(1); perform pg_temp.falla('46'); exception when insufficient_privilege then perform pg_temp.ok('46 el dueño no puede tomar la cola del notificador'); end;
  begin update public.agentes set webhook_secreto='x'; perform pg_temp.falla('47'); exception when insufficient_privilege then perform pg_temp.ok('47 nadie escribe el secreto HMAC directo'); end;
  begin perform webhook_secreto from public.agentes; perform pg_temp.falla('48'); exception when insufficient_privilege then perform pg_temp.ok('48 el secreto HMAC no se puede leer'); end;
  begin update public.agentes set webhook_url='http://169.254.169.254/' where id='bbbbbbbb-0000-0000-0000-000000000002';
    perform pg_temp.falla('49'); exception when check_violation then perform pg_temp.ok('49 webhook sin https rechazado en BD'); end;
  update public.agentes set webhook_url='https://ejemplo.com/hook' where id='bbbbbbbb-0000-0000-0000-000000000002';
  if public.rotar_secreto_webhook('bbbbbbbb-0000-0000-0000-000000000002') ~ '^whsec_[0-9a-f]{64}$' then perform pg_temp.ok('50 Erik rota el secreto y lo ve una vez'); else perform pg_temp.falla('50'); end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.push_suscripciones)=0 and (select count(*) from public.notificaciones where buzon_id='aaaaaaaa-0000-0000-0000-000000000001')=0 then perform pg_temp.ok('51 intruso no ve suscripciones ni notificaciones de Erik'); else perform pg_temp.falla('51'); end if;
  begin insert into public.push_suscripciones(buzon_id,humano_id,endpoint,p256dh,auth) values
    ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','https://fcm.googleapis.com/fcm/send/e2', repeat('B',87), repeat('a',22));
    perform pg_temp.falla('52'); exception when insufficient_privilege then perform pg_temp.ok('52 intruso no suscribe su navegador al buzón de Erik'); end;
  begin perform public.rotar_secreto_webhook('bbbbbbbb-0000-0000-0000-000000000002'); perform pg_temp.falla('53'); exception when insufficient_privilege then perform pg_temp.ok('53 intruso no rota secretos de webhook de Erik'); end;
  update public.agentes set webhook_url='https://evil.example/x' where id='bbbbbbbb-0000-0000-0000-000000000002';
  if not found then perform pg_temp.ok('54 intruso no cambia el webhook de Erik'); else perform pg_temp.falla('54'); end if;
end $$;
reset role;

-- 55-62 Adjuntos
set role service_role;
do $$ declare r uuid; begin
  r := public._registrar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',null,'informe.pdf','application/pdf',1000,repeat('a',64),'aaaaaaaa-0000-0000-0000-000000000001/x1.pdf','203.0.113.5');
  perform pg_temp.ok('55 agente registra adjunto en su buzón');
  if (select count(*) from public._autorizar_descarga(r,'bbbbbbbb-0000-0000-0000-000000000002',null))=1 then perform pg_temp.ok('56 otro agente del mismo buzón puede descargar (PDF compartido)'); else perform pg_temp.falla('56'); end if;
  begin perform public._autorizar_descarga(r,'bbbbbbbb-0000-0000-0000-000000000009',null); perform pg_temp.falla('57');
    exception when others then if sqlerrm like '404:%' then perform pg_temp.ok('57 agente de otro buzón no descarga'); else raise; end if; end;
  begin perform public._autorizar_descarga(r,null,'22222222-2222-2222-2222-222222222222'); perform pg_temp.falla('58');
    exception when others then if sqlerrm like '404:%' then perform pg_temp.ok('58 humano ajeno no descarga'); else raise; end if; end;
  begin perform public._registrar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000009',null,'a.pdf','application/pdf',10,repeat('a',64),'z/1');
    perform pg_temp.falla('59'); exception when others then if sqlerrm like '404:%' then perform pg_temp.ok('59 no se adjunta a hilo de otro buzón'); else raise; end if; end;
  begin perform public._registrar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',null,'a.svg','image/svg+xml',10,repeat('a',64),'z/2');
    perform pg_temp.falla('60'); exception when check_violation then perform pg_temp.ok('60 SVG rechazado en BD'); end;
  begin perform public._registrar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',null,'g.pdf','application/pdf',3145729,repeat('a',64),'z/3');
    perform pg_temp.falla('61'); exception when check_violation then perform pg_temp.ok('61 archivo > 3 MB rechazado'); end;
  if (select count(*) from public.auditoria where accion in ('adjunto:subir','adjunto:descargar'))=2 then perform pg_temp.ok('62 subida y descarga quedan en auditoría'); else perform pg_temp.falla('62'); end if;
end $$;
reset role;
-- Cuota: llenar hasta casi 100 MB
insert into public.adjuntos(buzon_id,hilo_id,nombre,tipo,tamano,sha256,ruta)
  select 'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','r.pdf','application/pdf',3145728,repeat('b',64),'relleno/'||g from generate_series(1,33) g;
set role service_role;
do $$ begin
  begin perform public._registrar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',null,'c.pdf','application/pdf',3000000,repeat('a',64),'z/4');
    perform pg_temp.falla('63'); exception when others then if sqlerrm like '413:%' then perform pg_temp.ok('63 cuota de 100 MB por buzón'); else raise; end if; end;
end $$;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.adjuntos)=0 then perform pg_temp.ok('64 intruso no ve metadatos de adjuntos de Erik'); else perform pg_temp.falla('64'); end if;
  begin perform public._registrar_adjunto('bbbbbbbb-0000-0000-0000-000000000009','cccccccc-0000-0000-0000-000000000009',null,'a.pdf','application/pdf',10,repeat('a',64),'z/5');
    perform pg_temp.falla('65'); exception when insufficient_privilege then perform pg_temp.ok('65 usuarios no llaman funciones internas de adjuntos'); end;
end $$;
reset role;
do $$ begin
  if (select public from storage.buckets where id='adjuntos')=false then perform pg_temp.ok('66 bucket adjuntos es privado'); else perform pg_temp.falla('66'); end if;
  if (public.mcp_leer('bz_'||repeat('v',30),'cccccccc-0000-0000-0000-000000000002') -> 'adjuntos' -> 0 ->> 'nombre')='informe.pdf' then perform pg_temp.ok('67 leer muestra los adjuntos del hilo'); else perform pg_temp.falla('67'); end if;
end $$;

-- 70-82 Códigos de configuración
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
create temp table if not exists _c(codigo text, id uuid);
grant all on _c to public;
do $$ declare j jsonb; begin
  j := public.crear_codigo_config('aaaaaaaa-0000-0000-0000-000000000001','Grok', 10);
  insert into _c values (j->>'codigo', (j->>'id')::uuid);
  if j->>'codigo' ~ '^bzc_[0-9a-f]{64}$' and (j->>'vence_en')::timestamptz <= now() + interval '10 minutes' then perform pg_temp.ok('70 Erik genera código bzc_ de 10 min'); else perform pg_temp.falla('70'); end if;
  begin perform public.crear_codigo_config('aaaaaaaa-0000-0000-0000-000000000001','X', 60); perform pg_temp.falla('71');
    exception when invalid_parameter_value then perform pg_temp.ok('71 un código no puede durar más de 15 min'); end;
  begin perform hash_codigo from public.codigos_config; perform pg_temp.falla('72'); exception when insufficient_privilege then perform pg_temp.ok('72 el hash del código no se puede leer'); end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  begin perform public.crear_codigo_config('aaaaaaaa-0000-0000-0000-000000000001','Intruso'); perform pg_temp.falla('73');
    exception when insufficient_privilege then perform pg_temp.ok('73 intruso no genera códigos para el buzón de Erik'); end;
  if (select count(*) from public.codigos_config)=0 then perform pg_temp.ok('74 intruso no ve los códigos de Erik'); else perform pg_temp.falla('74'); end if;
end $$;
reset role;
set role anon;
do $$ declare j jsonb; c text; begin
  select codigo into c from _c;
  if (public.canjear_codigo_config('bzc_mal') ->> 'error') like '400:%' then perform pg_temp.ok('75 formato inválido rechazado'); else perform pg_temp.falla('75'); end if;
  if (public.canjear_codigo_config('bzc_' || repeat('0',64)) ->> 'error') like '403:%' then perform pg_temp.ok('76 código inexistente rechazado'); else perform pg_temp.falla('76'); end if;
  j := public.canjear_codigo_config(c, '198.51.100.7');
  if j->>'token' ~ '^bz_[0-9a-f]{64}$' and j->>'agente'='Grok' then perform pg_temp.ok('77 canje entrega token bz_ del agente nuevo'); else perform pg_temp.falla('77'); end if;
  if (public.mcp_leer(j->>'token') ? 'hilos') then perform pg_temp.ok('78 el token canjeado funciona en el MCP'); else perform pg_temp.falla('78'); end if;
  if (public.canjear_codigo_config(c) ->> 'error') like '403:%' then perform pg_temp.ok('79 el código es de un solo uso'); else perform pg_temp.falla('79'); end if;
end $$;
reset role;
do $$ declare c text; i uuid; begin
  if (select usado_en is not null and intentos_fallidos=1 and agente_creado is not null from public.codigos_config where id=(select id from _c))
    then perform pg_temp.ok('80 código queda usado, con el reintento contado'); else perform pg_temp.falla('80'); end if;
  if (select count(*) from public.auditoria where accion='codigo_config:canje_ok')=1 and (select count(*) from public.auditoria where accion='codigo_config:canje_fallido')=2
     and (select count(*) from public.auditoria where accion='codigo_config:crear')=1
    then perform pg_temp.ok('81 creación, canje y fallos (no los de formato) quedan en auditoría'); else perform pg_temp.falla('81'); end if;
  -- código vencido
  c := 'bzc_' || repeat('1',64);
  insert into public.codigos_config(buzon_id,nombre_agente,hash_codigo,vence_en,creado_por) values
    ('aaaaaaaa-0000-0000-0000-000000000001','Viejo',encode(sha256(convert_to(c,'UTF8')),'hex'),now()-interval '1 second','11111111-1111-1111-1111-111111111111') returning id into i;
  if (public.canjear_codigo_config(c) ->> 'error') like '403:%' then perform pg_temp.ok('82 código vencido rechazado'); else perform pg_temp.falla('82'); end if;
  -- límite de intentos
  c := 'bzc_' || repeat('2',64);
  insert into public.codigos_config(buzon_id,nombre_agente,hash_codigo,vence_en,creado_por,intentos_fallidos) values
    ('aaaaaaaa-0000-0000-0000-000000000001','Bloq',encode(sha256(convert_to(c,'UTF8')),'hex'),now()+interval '5 minutes','11111111-1111-1111-1111-111111111111',5);
  if (public.canjear_codigo_config(c) ->> 'error') like '403:%' then perform pg_temp.ok('83 tras 5 intentos fallidos el código queda anulado'); else perform pg_temp.falla('83'); end if;
end $$;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ declare j jsonb; begin
  j := public.crear_codigo_config('aaaaaaaa-0000-0000-0000-000000000001','Anulable', 5);
  perform public.anular_codigo_config((j->>'id')::uuid);
  reset role;
  if (public.canjear_codigo_config(j->>'codigo') ->> 'error') like '403:%' then perform pg_temp.ok('85 código anulado desde la PWA ya no sirve'); else perform pg_temp.falla('85'); end if;
end $$;
reset role;
-- 90-99 Borrar agentes
reset role;
insert into public.agentes(id,buzon_id,nombre) values ('bbbbbbbb-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','Viejo1');
insert into public.tokens(agente_id,hash_token) values ('bbbbbbbb-0000-0000-0000-0000000000e1', encode(sha256(convert_to('bz_'||repeat('e',30),'UTF8')),'hex'));
insert into public.mensajes(hilo_id,autor_agente,cuerpo) values ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000e1','mensaje de Viejo1');
update public.agentes set webhook_url='https://ejemplo.com/v1', webhook_secreto='whsec_x' where id='bbbbbbbb-0000-0000-0000-0000000000e1';
insert into public.codigos_config(buzon_id,nombre_agente,hash_codigo,vence_en,creado_por) values
  ('aaaaaaaa-0000-0000-0000-000000000001','viejo1',repeat('f',64),now()+interval '5 min','11111111-1111-1111-1111-111111111111');
-- una IA no puede borrar: no hay herramienta y la RPC exige sesión
set role anon;
do $$ begin
  begin perform public.borrar_agentes(array['bbbbbbbb-0000-0000-0000-0000000000e1'::uuid]); perform pg_temp.falla('90');
    exception when insufficient_privilege then perform pg_temp.ok('90 anon (una IA con su clave) no puede borrar agentes'); end;
end $$;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  begin perform public.borrar_agentes(array['bbbbbbbb-0000-0000-0000-0000000000e1'::uuid]); perform pg_temp.falla('91');
    exception when insufficient_privilege then perform pg_temp.ok('91 intruso no borra agentes de Erik'); end;
  begin perform public.borrar_agentes(array['bbbbbbbb-0000-0000-0000-000000000009'::uuid,'bbbbbbbb-0000-0000-0000-0000000000e1'::uuid]); perform pg_temp.falla('92');
    exception when insufficient_privilege then perform pg_temp.ok('92 lista mixta (propio + ajeno) se rechaza completa'); end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin
  begin delete from public.agentes where id='bbbbbbbb-0000-0000-0000-0000000000e1'; perform pg_temp.falla('93');
    exception when insufficient_privilege then perform pg_temp.ok('93 ni el dueño borra directo: solo con borrar_agentes'); end;
  if exists (select 1 from public.agentes_inactivos('aaaaaaaa-0000-0000-0000-000000000001') where id='bbbbbbbb-0000-0000-0000-0000000000e1')
    then perform pg_temp.ok('94 agente que nunca se conectó sale en inactivos'); else perform pg_temp.falla('94'); end if;
  if public.borrar_agentes(array['bbbbbbbb-0000-0000-0000-0000000000e1'::uuid]) = 1 then perform pg_temp.ok('95 Erik borra su agente'); else perform pg_temp.falla('95'); end if;
  begin insert into public.tokens(agente_id,hash_token) values ('bbbbbbbb-0000-0000-0000-0000000000e1', repeat('1',64)); perform pg_temp.falla('96');
    exception when insufficient_privilege then perform pg_temp.ok('96 no se pueden crear claves para un agente eliminado'); end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.agentes_inactivos('aaaaaaaa-0000-0000-0000-000000000001'))=0 then perform pg_temp.ok('97 intruso no ve los inactivos de Erik'); else perform pg_temp.falla('97'); end if;
end $$;
reset role;
do $$ begin
  begin perform public.mcp_leer('bz_'||repeat('e',30)); perform pg_temp.falla('98');
    exception when others then if sqlerrm like '403:%' then perform pg_temp.ok('98 la clave del agente borrado queda revocada'); else raise; end if; end;
  if (select eliminado_en is not null and webhook_url is null and webhook_secreto is null from public.agentes where id='bbbbbbbb-0000-0000-0000-0000000000e1')
     and (select vence_en <= now() from public.codigos_config where hash_codigo=repeat('f',64))
     and (select count(*) from public.auditoria where accion='agente:borrar' and objeto_id='bbbbbbbb-0000-0000-0000-0000000000e1')=1
    then perform pg_temp.ok('99 webhook quitado, código pendiente anulado y borrado auditado'); else perform pg_temp.falla('99'); end if;
  if exists (select 1 from public.mensajes where cuerpo='mensaje de Viejo1')
     and (public.mcp_leer('bz_'||repeat('v',30),'cccccccc-0000-0000-0000-000000000002') -> 'mensajes') @> '[{"autor":"agente eliminado","cuerpo":"mensaje de Viejo1"}]'
    then perform pg_temp.ok('100 hilos y mensajes se conservan como "agente eliminado"'); else perform pg_temp.falla('100'); end if;
end $$;
reset role;
-- 84 sin bloqueo global: 100 fallos anónimos no impiden canjear un código válido
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
create temp table if not exists _c2(codigo text); grant all on _c2 to public;
do $$ begin insert into _c2 select public.crear_codigo_config('aaaaaaaa-0000-0000-0000-000000000001','Tras ataque',5)->>'codigo'; end $$;
reset role;
create temp table _n0 as select count(*) n from public.auditoria where accion='codigo_config:canje_fallido';
set role anon;
do $$ declare i int; begin
  for i in 1..60 loop perform public.canjear_codigo_config('basura'||i); end loop;
  for i in 1..40 loop perform public.canjear_codigo_config('bzc_' || lpad(i::text,64,'9')); end loop;
  if (public.canjear_codigo_config((select codigo from _c2)) ? 'token') then perform pg_temp.ok('84 sin bloqueo global: tras 100 fallos un código válido sí se canjea'); else perform pg_temp.falla('84'); end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.auditoria where accion='codigo_config:canje_fallido') - (select n from _n0) = 40 then perform pg_temp.ok('86 fallos de formato no se auditan; los de códigos con formato válido sí'); else perform pg_temp.falla('86'); end if;
end $$;
reset role;
-- 87-89 reintentos sin duplicar y pre-chequeo de adjuntos
set role service_role;
do $$ declare i bigint; begin
  select id into i from public.notificaciones order by id desc limit 1;
  perform public._marcar_entregado(i, 'push:x'); perform public._marcar_entregado(i, 'push:x');
  if (select entregados = '{push:x}' from public.notificaciones where id=i) then perform pg_temp.ok('87 destino entregado se marca una sola vez'); else perform pg_temp.falla('87'); end if;
  begin perform public._verificar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',null,3000000); perform pg_temp.falla('88');
    exception when others then if sqlerrm like '413:%' then perform pg_temp.ok('88 la cuota se revisa antes de subir'); else raise; end if; end;
  begin perform public._verificar_adjunto('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000009',null,10); perform pg_temp.falla('89');
    exception when others then if sqlerrm like '404:%' then perform pg_temp.ok('89 pre-chequeo rechaza hilo de otro buzón'); else raise; end if; end;
end $$;
reset role;
-- 101-112 Aprobar solo el cierre
reset role;
insert into public.tokens(agente_id,hash_token) values ('bbbbbbbb-0000-0000-0000-000000000002', encode(sha256(convert_to('bz_'||repeat('w',30),'UTF8')),'hex'));
create temp table _h as select (public.mcp_crear('bz_'||repeat('v',30),'tarea','Revisión entre IAs')->>'id')::uuid id;
grant select on _h to anon, authenticated;
do $$ declare h uuid := (select id from _h); n int; begin
  perform public.mcp_responder('bz_'||repeat('w',30), h, 'Revisé: falta un caso');
  perform public.mcp_responder('bz_'||repeat('v',30), h, 'Corregido');
  if (select estado from public.hilos where id=h)='abierto' and (select count(*) from public.mensajes where hilo_id=h)=2
    then perform pg_temp.ok('101 las IAs conversan sin aprobación (el hilo sigue abierto)'); else perform pg_temp.falla('101'); end if;
  select count(*) into n from public.notificaciones where hilo_id=h and evento='mensaje_nuevo';
  if n=2 and (select agente_origen from public.notificaciones where hilo_id=h and evento='mensaje_nuevo' order by id limit 1)='bbbbbbbb-0000-0000-0000-000000000002'
    then perform pg_temp.ok('102 cada mensaje de IA encola aviso con su autor (para no avisarle a sí misma)'); else perform pg_temp.falla('102'); end if;
  perform public.mcp_responder('bz_'||repeat('w',30), h, 'Terminado, ¿cerramos?', 'pedir_cierre');
  if (select estado from public.hilos where id=h)='pide_cierre'
     and exists (select 1 from public.notificaciones where hilo_id=h and evento='pide_cierre')
    then perform pg_temp.ok('103 pedir_cierre deja el hilo esperando al dueño y encola aviso'); else perform pg_temp.falla('103'); end if;
  begin perform public.mcp_responder('bz_'||repeat('w',30), h, 'x', 'cerrar'); perform pg_temp.falla('104');
    exception when others then if sqlerrm like '400:%' then perform pg_temp.ok('104 una IA no puede cerrar (acción inexistente)'); else raise; end if; end;
end $$;
set role anon;
do $$ begin
  begin perform public.decidir_cierre((select id from _h), true); perform pg_temp.falla('105');
    exception when insufficient_privilege then perform pg_temp.ok('105 anon (una IA) no puede llamar decidir_cierre'); end;
end $$;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  begin perform public.decidir_cierre((select id from _h), true); perform pg_temp.falla('106');
    exception when insufficient_privilege then perform pg_temp.ok('106 intruso no cierra hilos de Erik'); end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin
  begin update public.hilos set estado='cerrado' where id=(select id from _h); perform pg_temp.falla('107');
    exception when insufficient_privilege then perform pg_temp.ok('107 ni el dueño cierra con update directo (solo con decidir_cierre, auditado)'); end;
  if public.decidir_cierre((select id from _h), false, 'Falta el README') = 'abierto' then perform pg_temp.ok('108 "Seguir trabajando" devuelve el hilo a abierto con nota'); else perform pg_temp.falla('108'); end if;
end $$;
reset role;
do $$ begin perform public.mcp_responder('bz_'||repeat('w',30), (select id from _h), 'README listo', 'pedir_cierre'); end $$;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin
  if public.decidir_cierre((select id from _h), true) = 'cerrado' then perform pg_temp.ok('109 Erik aprueba el cierre'); else perform pg_temp.falla('109'); end if;
  begin update public.hilos set estado='abierto' where id=(select id from _h); perform pg_temp.falla('110');
    exception when insufficient_privilege then perform pg_temp.ok('110 un hilo cerrado no se reabre'); end;
end $$;
reset role;
do $$ declare h uuid := (select id from _h); begin
  begin perform public.mcp_responder('bz_'||repeat('v',30), h, 'otra cosa'); perform pg_temp.falla('111');
    exception when others then if sqlerrm like '409:%' then perform pg_temp.ok('111 hilo cerrado ya no acepta mensajes de IAs'); else raise; end if; end;
  if (select count(*) from public.auditoria where objeto_id=h and accion in ('cierre:aprobado','cierre:rechazado') and actor like 'humano:%')=2
     and exists (select 1 from public.mensajes where hilo_id=h and autor_humano is not null and cuerpo='Falta el README')
    then perform pg_temp.ok('112 cierre y rechazo auditados como humano; la nota queda en el hilo'); else perform pg_temp.falla('112'); end if;
end $$;
reset role;
-- 113-122 Lo que me toca (para, lecturas, lista corta)
reset role;
create temp table _t (k text primary key, id uuid);
grant select on _t to anon, authenticated;
do $$ declare r jsonb; l jsonb; e text; begin
  insert into _t values ('t1', (public.mcp_crear('bz_'||repeat('v',30),'tarea','Para Codex 1',null,null,'codex')->>'id')::uuid);
  update public.hilos set creado_en = now() - interval '1 hour' where id=(select id from _t where k='t1');
  insert into _t values ('t2', (public.mcp_crear('bz_'||repeat('v',30),'tarea','Para Codex 2',null,null,'Codex')->>'id')::uuid);
  if (select para_agente from public.hilos where id=(select id from _t where k='t1'))='bbbbbbbb-0000-0000-0000-000000000002'
    then perform pg_temp.ok('113 crear con para guarda el destinatario (sin importar mayúsculas)'); else perform pg_temp.falla('113'); end if;
  foreach e in array array['Nadie','Viejo1','AgenteAjeno'] loop
    begin perform public.mcp_crear('bz_'||repeat('v',30),'tarea','x',null,null,e); perform pg_temp.falla('114 '||e);
      exception when others then if sqlerrm not like '400:%' then raise; end if; end;
  end loop;
  perform pg_temp.ok('114 para inexistente, eliminado o de otro buzón se rechaza');
  l := public.mcp_leer('bz_'||repeat('w',30)) -> 'hilos';
  if (l->0->>'id')::uuid = (select id from _t where k='t1') and (l->1->>'id')::uuid = (select id from _t where k='t2') and l->0->>'motivo'='para_ti'
    then perform pg_temp.ok('115 sin filtros: primero lo dirigido a mí, el más antiguo primero'); else perform pg_temp.falla('115 '||l::text); end if;
  r := l->0;
  if not r ? 'mensajes' and r->>'estado_texto'='Abierto' and r->>'para'='Codex' and r->>'creado_por'='Claude'
     and r->>'creado_en' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-06:00$' and r->>'ultima_actividad_cdmx' like '% (hora de CDMX)'
    then perform pg_temp.ok('116 resumen corto: título, estado sencillo, para, creador y horas ISO con desfase y CDMX'); else perform pg_temp.falla('116 '||r::text); end if;
  if not exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('v',30))->'hilos') x where (x->>'id')::uuid in (select id from _t))
    then perform pg_temp.ok('117 a Claude no le toca lo que dirigió a Codex'); else perform pg_temp.falla('117'); end if;
  insert into _t values ('x', (public.mcp_crear('bz_'||repeat('v',30),'tarea','Sin destinatario')->>'id')::uuid);
  if exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('w',30))->'hilos') x where (x->>'id')::uuid=(select id from _t where k='x') and x->>'motivo'='hilo_nuevo')
    then perform pg_temp.ok('118 hilo nuevo sin destinatario aparece hasta que lo abro'); else perform pg_temp.falla('118'); end if;
  perform public.mcp_leer('bz_'||repeat('w',30), (select id from _t where k='x'));
  perform public.mcp_responder('bz_'||repeat('w',30), (select id from _t where k='x'), 'mi propio mensaje');
  if not exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('w',30))->'hilos') x where (x->>'id')::uuid=(select id from _t where k='x'))
     and exists (select 1 from public.lecturas where agente_id='bbbbbbbb-0000-0000-0000-000000000002' and hilo_id=(select id from _t where k='x'))
    then perform pg_temp.ok('119 abrirlo registra la lectura; mis propios mensajes no me lo regresan'); else perform pg_temp.falla('119'); end if;
  update public.lecturas set leido_en = now() - interval '1 minute' where hilo_id=(select id from _t where k='x');
  update public.mensajes set creado_en = now() - interval '2 minutes' where hilo_id=(select id from _t where k='x');
  perform public.mcp_responder('bz_'||repeat('v',30), (select id from _t where k='x'), 'respuesta de Claude');
  if exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('w',30))->'hilos') x where (x->>'id')::uuid=(select id from _t where k='x') and x->>'motivo'='mensajes_nuevos' and (x->>'mensajes_sin_leer')::int=1)
    then perform pg_temp.ok('120 un mensaje nuevo de otra IA lo regresa a mi lista'); else perform pg_temp.falla('120'); end if;
  perform public.mcp_responder('bz_'||repeat('w',30), (select id from _t where k='t2'), 'terminé', 'pedir_cierre');
end $$;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin perform public.decidir_cierre((select id from _t where k='t2'), true); end $$;
reset role;
do $$ declare l jsonb; begin
  l := public.mcp_leer('bz_'||repeat('w',30)) -> 'hilos';
  if not exists (select 1 from jsonb_array_elements(l) x where (x->>'id')::uuid=(select id from _t where k='t2'))
     and exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('w',30), null, 'todos', 100)->'hilos') x where (x->>'id')::uuid=(select id from _t where k='t2') and x->>'estado_texto'='Cerrado')
    then perform pg_temp.ok('121 lo cerrado no sale por defecto; con estado "todos" sí'); else perform pg_temp.falla('121'); end if;
end $$;
set role anon;
do $$ begin
  begin perform 1 from public.lecturas limit 1; perform pg_temp.falla('122');
    exception when insufficient_privilege then perform pg_temp.ok('122 anon (una IA) no lee el registro de lecturas'); end;
end $$;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.lecturas)=0 then perform pg_temp.ok('123 un intruso no ve las lecturas de Erik'); else perform pg_temp.falla('123'); end if;
end $$;
reset role;
-- 124-128 Lo tomado se queda; lo dirigido a otra IA no es mío; horas en el historial
reset role;
insert into public.agentes(id,buzon_id,nombre) values ('bbbbbbbb-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-000000000001','Gemini');
insert into public.tokens(agente_id,hash_token) values ('bbbbbbbb-0000-0000-0000-0000000000a3', encode(sha256(convert_to('bz_'||repeat('g',30),'UTF8')),'hex'));
do $$ declare y uuid; z uuid; l jsonb; m jsonb; begin
  y := (public.mcp_crear('bz_'||repeat('v',30),'tarea','Para tomar')->>'id')::uuid;
  perform public.mcp_leer('bz_'||repeat('w',30), y);
  perform public.mcp_responder('bz_'||repeat('w',30), y, 'Lo tomo', 'tomar');
  if exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('w',30))->'hilos') x where (x->>'id')::uuid=y and x->>'motivo'='tomado_por_ti')
    then perform pg_temp.ok('124 lo que la IA tomó sigue en su lista aunque no haya nada nuevo'); else perform pg_temp.falla('124'); end if;
  z := (public.mcp_crear('bz_'||repeat('v',30),'tarea','Solo para Codex',null,null,'Codex')->>'id')::uuid;
  perform public.mcp_responder('bz_'||repeat('w',30), z, 'Codex trabajando');
  if not exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('g',30))->'hilos') x where (x->>'id')::uuid=z)
    then perform pg_temp.ok('125 lo dirigido a otra IA no aparece aunque tenga mensajes nuevos'); else perform pg_temp.falla('125'); end if;
  perform public.mcp_responder('bz_'||repeat('g',30), z, 'Gemini opina');
  update public.lecturas set leido_en = now() - interval '1 minute' where hilo_id = z;
  update public.mensajes set creado_en = now() - interval '2 minutes' where hilo_id = z;
  perform public.mcp_responder('bz_'||repeat('w',30), z, 'Codex responde a Gemini');
  if exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('g',30))->'hilos') x where (x->>'id')::uuid=z and x->>'motivo'='mensajes_nuevos')
    then perform pg_temp.ok('126 si la IA ya escribió en un hilo ajeno, sí le avisan las respuestas'); else perform pg_temp.falla('126'); end if;
  perform public.mcp_responder('bz_'||repeat('g',30), y, 'Gemini mete su cuchara');
  if exists (select 1 from jsonb_array_elements(public.mcp_leer('bz_'||repeat('w',30))->'hilos') x where (x->>'id')::uuid=y and x->>'motivo'='tomado_por_ti')
    then perform pg_temp.ok('127 lo tomado se ordena antes que lo demás y conserva su motivo'); else perform pg_temp.falla('127'); end if;
  m := public.mcp_leer('bz_'||repeat('w',30), z);
  if m->'mensajes'->0->>'creado_en_cdmx' like '% (hora de CDMX)' and m->'mensajes'->0->>'creado_en' ~ '[-+]\d\d:\d\d$' and m->'hilo'->>'creado_en_cdmx' like '% (hora de CDMX)'
    then perform pg_temp.ok('128 al abrir un hilo, cada mensaje trae la hora legible de CDMX'); else perform pg_temp.falla('128'); end if;
end $$;
reset role;
-- 129-138 Avisos confiables (013): clave del receptor, destinatarios por hilo, freno anti ping-pong
reset role;
update public.agentes set webhook_url='https://hooks.ejemplo.dev/' || nombre, webhook_secreto='whsec_x'
 where id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000a3');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ declare g boolean; begin
  g := public.guardar_clave_webhook('bbbbbbbb-0000-0000-0000-000000000001', 'clave-de-grok-123456');
  if g and (select webhook_tiene_clave from public.agentes where id='bbbbbbbb-0000-0000-0000-000000000001')
    then perform pg_temp.ok('129 el dueño guarda la clave del receptor y la PWA solo ve que existe'); else perform pg_temp.falla('129'); end if;
  begin perform webhook_clave from public.agentes limit 1; perform pg_temp.falla('130');
    exception when insufficient_privilege then perform pg_temp.ok('130 nadie puede leer la clave guardada'); end;
  begin perform public.guardar_clave_webhook('bbbbbbbb-0000-0000-0000-000000000001', 'con espacio x'); perform pg_temp.falla('131');
    exception when sqlstate '22023' then perform pg_temp.ok('131 una clave con espacios se rechaza'); end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  begin perform public.guardar_clave_webhook('bbbbbbbb-0000-0000-0000-000000000001', 'clave-de-intruso-123'); perform pg_temp.falla('132');
    exception when insufficient_privilege then perform pg_temp.ok('132 un intruso no puede poner la clave de otro buzón'); end;
end $$;
set role anon;
do $$ begin
  begin perform public._destinos_webhook(1); perform pg_temp.falla('133');
    exception when insufficient_privilege then perform pg_temp.ok('133 una IA no puede consultar destinos ni el secreto de la BD'); end;
  begin perform public._secreto_bd(); perform pg_temp.falla('133b'); exception when insufficient_privilege then null; end;
end $$;
reset role;
create temp table _d(k text primary key, id uuid);
grant all on _d to anon, authenticated, service_role;
do $$ declare h uuid; n bigint; ds uuid[]; i int; begin
  -- Hilo dirigido a Codex: solo se despierta a Codex
  h := (public.mcp_crear('bz_'||repeat('v',30),'tarea','Para Codex (013)',null,null,'Codex')->>'id')::uuid;
  insert into _d values ('h', h);
  select max(id) into n from public.notificaciones where hilo_id=h and evento='hilo_nuevo';
  select array_agg(id) into ds from public._destinos_webhook(n);
  if ds = array['bbbbbbbb-0000-0000-0000-000000000002'::uuid] then perform pg_temp.ok('134 hilo dirigido: solo despierta a la destinataria'); else perform pg_temp.falla('134 ' || coalesce(ds::text,'null')); end if;
  -- Codex responde: se despierta al creador, no a Codex (autor) ni a Gemini (ajena al hilo)
  update public.notificaciones set entregados = array['wh:bbbbbbbb-0000-0000-0000-000000000002'] where id = n;
  perform public.mcp_leer('bz_'||repeat('w',30), h);
  perform public.mcp_responder('bz_'||repeat('w',30), h, 'Codex responde');
  select max(id) into n from public.notificaciones where hilo_id=h and evento='mensaje_nuevo';
  select array_agg(id) into ds from public._destinos_webhook(n);
  if ds = array['bbbbbbbb-0000-0000-0000-000000000001'::uuid] then perform pg_temp.ok('135 mensaje: solo despierta a las IAs del hilo, nunca al autor'); else perform pg_temp.falla('135 ' || coalesce(ds::text,'null')); end if;
  -- Ya se despertó al creador y no ha abierto el hilo: un segundo mensaje no lo vuelve a despertar
  update public.notificaciones set entregados = array['wh:bbbbbbbb-0000-0000-0000-000000000001'], creado_en = now() - interval '10 seconds' where id = n;
  perform public.mcp_responder('bz_'||repeat('w',30), h, 'Codex otra vez');
  select max(id) into n from public.notificaciones where hilo_id=h and evento='mensaje_nuevo';
  if not exists (select 1 from public._destinos_webhook(n)) then perform pg_temp.ok('136 a quien ya avisamos y no ha abierto el hilo no se le vuelve a despertar'); else perform pg_temp.falla('136'); end if;
  -- 20 mensajes seguidos entre IAs: el hilo deja de despertar IAs hasta que el dueño escriba
  update public.lecturas set leido_en = now() + interval '1 hour' where hilo_id = h;
  update public.notificaciones set entregados = '{}' where hilo_id = h;
  for i in 1..20 loop perform public.mcp_responder('bz_'||repeat(case when i % 2 = 0 then 'v' else 'w' end,30), h, 'ping ' || i); end loop;
  select max(id) into n from public.notificaciones where hilo_id=h and evento='mensaje_nuevo';
  if not exists (select 1 from public._destinos_webhook(n)) then perform pg_temp.ok('137 freno anti ping-pong: 20 mensajes seguidos entre IAs ya no despiertan a nadie'); else perform pg_temp.falla('137'); end if;
  insert into public.mensajes(hilo_id, autor_humano, cuerpo) values (h, '11111111-1111-1111-1111-111111111111', 'Erik: sigan así');
  select max(id) into n from public.notificaciones where hilo_id=h and evento='mensaje_nuevo';
  select array_agg(id order by id) into ds from public._destinos_webhook(n);
  if (select origen_humano from public.notificaciones where id=n)
     and ds = array['bbbbbbbb-0000-0000-0000-000000000001'::uuid,'bbbbbbbb-0000-0000-0000-000000000002'::uuid]
    then perform pg_temp.ok('138 un mensaje del dueño despierta a las IAs del hilo y reinicia el freno'); else perform pg_temp.falla('138 ' || coalesce(ds::text,'null')); end if;
end $$;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin perform public.borrar_agentes(array['bbbbbbbb-0000-0000-0000-000000000001'::uuid]); end $$;
reset role;
do $$ begin
  if (select webhook_clave is null and webhook_url is null from public.agentes where id='bbbbbbbb-0000-0000-0000-000000000001')
    then perform pg_temp.ok('139 al borrar un agente se olvida su clave del receptor'); else perform pg_temp.falla('139'); end if;
end $$;
reset role;
\echo TODAS_LAS_PRUEBAS_PASARON
