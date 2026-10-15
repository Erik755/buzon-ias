-- Auditoría solo de inserción + funciones para el servidor MCP
create or replace function public.auditoria_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'auditoria es solo de insercion (% bloqueado)', tg_op using errcode = '42501';
end $$;
create trigger auditoria_no_update before update or delete on public.auditoria
  for each row execute function public.auditoria_inmutable();
create trigger auditoria_no_truncate before truncate on public.auditoria
  for each statement execute function public.auditoria_inmutable();
revoke update, delete, truncate on public.auditoria from public, anon, authenticated, service_role;

-- Una aprobación cambia el estado del hilo y queda auditada
create or replace function public.tras_aprobacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  update public.hilos set estado = new.decision where id = new.hilo_id returning buzon_id into b;
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    values (b, 'humano:' || new.humano_id, 'aprobacion:' || new.decision, new.hilo_id);
  return new;
end $$;
create trigger aprobaciones_aplicar after insert on public.aprobaciones
  for each row execute function public.tras_aprobacion();

-- Solo un humano (rol authenticated con auth.uid()) puede aprobar.
-- El servidor MCP usa service_role: se le niega explícitamente.
revoke insert on public.aprobaciones from service_role;
-- Y nadie salvo la PWA marca un hilo como aprobado/rechazado directamente
create or replace function public.hilos_estado_guard() returns trigger
language plpgsql as $$
begin
  if new.estado in ('aprobado','rechazado') and new.estado is distinct from old.estado
     and pg_trigger_depth() < 2 then
    raise exception 'solo una aprobacion humana puede aprobar/rechazar' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hilos_estado_guard before update on public.hilos
  for each row execute function public.hilos_estado_guard();

-- Validación de token (la usa el servidor MCP). Devuelve agente y buzón solo si es válido.
create or replace function public.validar_token(p_hash text, p_alcance text)
returns table(agente_id uuid, buzon_id uuid, agente_nombre text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    update public.tokens t set ultimo_uso = now()
    from public.agentes a
    where t.hash_token = p_hash and a.id = t.agente_id
      and t.revocado_en is null and t.vence_en > now()
      and p_alcance = any(t.alcances)
    returning a.id, a.buzon_id, a.nombre;
end $$;
revoke all on function public.validar_token(text, text) from public, anon, authenticated;
revoke execute on function public.auditoria_inmutable(), public.tras_aprobacion(), public.hilos_estado_guard() from public, anon, authenticated;
grant execute on function public.validar_token(text, text) to service_role;
