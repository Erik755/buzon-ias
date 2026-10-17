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
\echo TODAS_LAS_PRUEBAS_PASARON
