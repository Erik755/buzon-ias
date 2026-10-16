-- "Probar conexión" en la PWA: el dueño ve cuándo usó el MCP cada token, pero nunca el hash.
revoke select on public.tokens from authenticated;
grant select (id, agente_id, alcances, vence_en, revocado_en, ultimo_uso, creado_en) on public.tokens to authenticated;

-- Resumen por agente (respeta RLS: security invoker).
create or replace view public.estado_agentes with (security_invoker = true) as
  select a.id as agente_id, a.buzon_id, a.nombre,
         max(t.ultimo_uso) as ultimo_uso,
         count(*) filter (where t.revocado_en is null and t.vence_en > now()) as tokens_activos,
         (select max(au.creado_en) from public.auditoria au where au.actor = 'agente:' || a.id) as ultima_accion,
         (select au.accion from public.auditoria au where au.actor = 'agente:' || a.id order by au.creado_en desc limit 1) as accion
  from public.agentes a left join public.tokens t on t.agente_id = a.id
  group by a.id;
revoke all on public.estado_agentes from anon, public;
grant select on public.estado_agentes to authenticated;
