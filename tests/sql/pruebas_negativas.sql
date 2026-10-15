-- Pruebas negativas. Cada prueba imprime OK o lanza error (psql -v ON_ERROR_STOP=1).
\set QUIET on
-- Datos semilla (como superusuario)
insert into auth.users values ('11111111-1111-1111-1111-111111111111','erik@ejemplo'),
                              ('22222222-2222-2222-2222-222222222222','intruso@ejemplo');
insert into public.buzones(id,dueno_id,nombre) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Buzón de Erik'),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Buzón ajeno');
insert into public.agentes(id,buzon_id,nombre) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Claude');
insert into public.tokens(agente_id,hash_token,vence_en,revocado_en) values
  ('bbbbbbbb-0000-0000-0000-000000000001', encode(sha256('bz_valido'),'hex'),   now()+interval '1 day', null),
  ('bbbbbbbb-0000-0000-0000-000000000001', encode(sha256('bz_revocado'),'hex'), now()+interval '1 day', now()),
  ('bbbbbbbb-0000-0000-0000-000000000001', encode(sha256('bz_vencido'),'hex'),  now()-interval '1 minute', null);
insert into public.tokens(agente_id,hash_token,alcances) values
  ('bbbbbbbb-0000-0000-0000-000000000001', encode(sha256('bz_sololeer'),'hex'), '{leer}');
insert into public.hilos(id,buzon_id,tipo,titulo,estado) values
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','tarea','Secreto de Erik','pide_aprobacion');
insert into public.mensajes(hilo_id,autor_agente,cuerpo) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','contexto privado');
insert into public.auditoria(buzon_id,actor,accion) values ('aaaaaaaa-0000-0000-0000-000000000001','sistema','semilla');

create or replace function pg_temp.ok(t text) returns void language plpgsql as $$ begin raise notice 'OK  %', t; end $$;
create or replace function pg_temp.falla(t text) returns void language plpgsql as $$ begin raise exception 'FALLA  %', t; end $$;

-- 1. Otro usuario no ve el buzón de Erik (lectura cruzada en todas las tablas)
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.buzones where id='aaaaaaaa-0000-0000-0000-000000000001')=0
   and (select count(*) from public.hilos)=0 and (select count(*) from public.mensajes)=0
   and (select count(*) from public.agentes)=0 and (select count(*) from public.tokens)=0
   and (select count(*) from public.auditoria)=0
  then perform pg_temp.ok('01 intruso no lee buzón/hilos/mensajes/agentes/tokens/auditoría de Erik');
  else perform pg_temp.falla('01 lectura cruzada'); end if; end $$;
-- 2. Buzón ajeno por id directo (como por URL) y sin poder escribir en él
do $$ begin
  if not exists (select 1 from public.hilos where id='cccccccc-0000-0000-0000-000000000001') then perform pg_temp.ok('02 hilo de Erik por id directo = vacío'); else perform pg_temp.falla('02'); end if;
  begin insert into public.hilos(buzon_id,tipo,titulo) values ('aaaaaaaa-0000-0000-0000-000000000001','tarea','inyectado');
    perform pg_temp.falla('03 intruso insertó hilo'); exception when insufficient_privilege then perform pg_temp.ok('03 intruso no puede insertar hilos en buzón de Erik'); end;
  begin insert into public.aprobaciones(hilo_id,humano_id,decision) values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aprobado');
    perform pg_temp.falla('04 intruso aprobó'); exception when insufficient_privilege then perform pg_temp.ok('04 intruso no puede aprobar en buzón de Erik'); end;
  update public.hilos set titulo='x';
  if (select count(*) from public.hilos)=0 then perform pg_temp.ok('05 update cruzado no afecta filas'); end if;
end $$;
reset role;
-- 6. anon (sin sesión) no lee nada
set role anon;
do $$ begin
  begin perform 1 from public.hilos; perform pg_temp.falla('06 anon leyó'); exception when insufficient_privilege then perform pg_temp.ok('06 anon sin acceso (no hay enlaces públicos)'); end;
  begin perform public._mcp_ctx('bz_valido_xxxxxxxxxxxxxxxxxxxx','leer',null); perform pg_temp.falla('07 anon llamó _mcp_ctx'); exception when insufficient_privilege then perform pg_temp.ok('07 anon no puede llamar _mcp_ctx'); end;
end $$;
reset role;
-- Tokens: se prueban por la API pública mcp_leer/mcp_crear (rol anon), igual que el servidor MCP
update public.tokens set hash_token = encode(sha256(convert_to('bz_valido_' || repeat('a',30),'UTF8')),'hex') where hash_token = encode(sha256('bz_valido'),'hex');
update public.tokens set hash_token = encode(sha256(convert_to('bz_revocado_' || repeat('a',30),'UTF8')),'hex') where hash_token = encode(sha256('bz_revocado'),'hex');
update public.tokens set hash_token = encode(sha256(convert_to('bz_vencido_' || repeat('a',30),'UTF8')),'hex') where hash_token = encode(sha256('bz_vencido'),'hex');
update public.tokens set hash_token = encode(sha256(convert_to('bz_sololeer_' || repeat('a',30),'UTF8')),'hex') where hash_token = encode(sha256('bz_sololeer'),'hex');
set role anon;
do $$ declare t text := repeat('a',30); begin
  if (public.mcp_leer('bz_valido_' || t) -> 'hilos') is not null then perform pg_temp.ok('08 control positivo: token válido funciona'); else perform pg_temp.falla('08'); end if;
  begin perform public.mcp_leer('bz_revocado_' || t); perform pg_temp.falla('09'); exception when others then if sqlerrm like '403:%' then perform pg_temp.ok('09 token revocado falla'); else raise; end if; end;
  begin perform public.mcp_leer('bz_vencido_' || t); perform pg_temp.falla('10'); exception when others then if sqlerrm like '403:%' then perform pg_temp.ok('10 token vencido falla'); else raise; end if; end;
  begin perform public.mcp_leer('bz_inventado_' || t); perform pg_temp.falla('11'); exception when others then if sqlerrm like '403:%' then perform pg_temp.ok('11 token inexistente falla'); else raise; end if; end;
  begin perform public.mcp_crear('bz_sololeer_' || t, 'tarea', 'x'); perform pg_temp.falla('12'); exception when others then if sqlerrm like '403:%' then perform pg_temp.ok('12 token sin alcance "crear" falla'); else raise; end if; end;
  begin perform public.mcp_responder('bz_valido_' || t, 'cccccccc-0000-0000-0000-000000000001', 'x', 'aprobar'); perform pg_temp.falla('12b'); exception when others then if sqlerrm like '400:%' then perform pg_temp.ok('12b IA no puede aprobar por la API MCP'); else raise; end if; end;
end $$;
reset role;
set role service_role;
do $$ begin
  -- IA (servidor MCP) no puede aprobar
  begin insert into public.aprobaciones(hilo_id,humano_id,decision) values ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aprobado');
    perform pg_temp.falla('13 IA aprobó'); exception when insufficient_privilege then perform pg_temp.ok('13 IA no puede insertar aprobaciones'); end;
  begin update public.hilos set estado='aprobado' where id='cccccccc-0000-0000-0000-000000000001';
    perform pg_temp.falla('14 IA cambió estado a aprobado'); exception when insufficient_privilege then perform pg_temp.ok('14 IA no puede marcar un hilo como aprobado'); end;
  -- auditoría inmutable para el servidor
  begin update public.auditoria set accion='borrado'; perform pg_temp.falla('15'); exception when insufficient_privilege then perform pg_temp.ok('15 service_role no edita auditoría'); end;
  begin delete from public.auditoria; perform pg_temp.falla('16'); exception when insufficient_privilege then perform pg_temp.ok('16 service_role no borra auditoría'); end;
end $$;
reset role;
-- Erik (dueño)
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin
  if (select count(*) from public.hilos)=1 then perform pg_temp.ok('17 control positivo: Erik ve su hilo'); else perform pg_temp.falla('17'); end if;
  begin update public.hilos set estado='aprobado'; perform pg_temp.falla('18'); exception when insufficient_privilege then perform pg_temp.ok('18 ni Erik se salta la tabla aprobaciones'); end;
  begin insert into public.aprobaciones(hilo_id,humano_id,decision) values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aprobado');
    perform pg_temp.falla('19'); exception when insufficient_privilege then perform pg_temp.ok('19 no se puede aprobar suplantando a otro humano'); end;
  insert into public.aprobaciones(hilo_id,humano_id,decision,nota) values ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aprobado','ok');
  if (select estado from public.hilos)='aprobado' and exists(select 1 from public.auditoria where accion='aprobacion:aprobado')
    then perform pg_temp.ok('20 control positivo: Erik aprueba y queda auditado'); else perform pg_temp.falla('20'); end if;
  begin update public.auditoria set accion='x'; perform pg_temp.falla('21'); exception when insufficient_privilege then perform pg_temp.ok('21 Erik no edita auditoría'); end;
  begin delete from public.auditoria; perform pg_temp.falla('22'); exception when insufficient_privilege then perform pg_temp.ok('22 Erik no borra auditoría'); end;
  begin insert into public.mensajes(hilo_id,autor_agente,cuerpo) values ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','falso');
    perform pg_temp.falla('23'); exception when insufficient_privilege then perform pg_temp.ok('23 humano no puede firmar como IA'); end;
end $$;
reset role;
-- 24. Ni el superusuario/owner puede editar o borrar auditoría (trigger)
do $$ begin
  begin update public.auditoria set accion='x'; perform pg_temp.falla('24'); exception when insufficient_privilege then perform pg_temp.ok('24 owner no edita auditoría (trigger)'); end;
  begin delete from public.auditoria; perform pg_temp.falla('25'); exception when insufficient_privilege then perform pg_temp.ok('25 owner no borra auditoría (trigger)'); end;
  begin truncate public.auditoria; perform pg_temp.falla('26'); exception when insufficient_privilege then perform pg_temp.ok('26 owner no trunca auditoría (trigger)'); end;
end $$;
-- 28-30. Endurecimiento
do $$ begin
  if not exists (select 1 from pg_proc where proname='validar_token') then perform pg_temp.ok('28 validar_token eliminada'); else perform pg_temp.falla('28'); end if;
  begin insert into public.hilos(buzon_id,tipo,titulo,creado_por_agente) values ('aaaaaaaa-0000-0000-0000-000000000002','tarea','x','bbbbbbbb-0000-0000-0000-000000000001');
    perform pg_temp.falla('29'); exception when insufficient_privilege then perform pg_temp.ok('29 agente de otro buzón no se puede asignar a un hilo'); end;
  begin insert into public.buzones(dueno_id,nombre) values ('11111111-1111-1111-1111-111111111111','segundo');
    perform pg_temp.falla('30'); exception when unique_violation then perform pg_temp.ok('30 máximo 1 buzón por dueño'); end;
end $$;
-- 27. RLS activo en las 7 tablas
do $$ begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity)=7
  then perform pg_temp.ok('27 RLS forzado en las 7 tablas'); else perform pg_temp.falla('27'); end if; end $$;
\echo TODAS_LAS_PRUEBAS_PASARON
