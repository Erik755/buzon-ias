-- Endurecimiento tras la auditoría.
-- 1) validar_token ya no se usa (lo reemplazó _mcp_ctx).
drop function if exists public.validar_token(text, text);

-- 2) Los agentes de un hilo deben ser del mismo buzón.
create or replace function public.hilos_agentes_mismo_buzon() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.creado_por_agente is not null and not exists (select 1 from public.agentes where id = new.creado_por_agente and buzon_id = new.buzon_id))
  or (new.tomado_por_agente is not null and not exists (select 1 from public.agentes where id = new.tomado_por_agente and buzon_id = new.buzon_id)) then
    raise exception 'el agente no pertenece a este buzon' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hilos_agentes_mismo_buzon before insert or update of creado_por_agente, tomado_por_agente, buzon_id on public.hilos
  for each row execute function public.hilos_agentes_mismo_buzon();

-- 3) Límites anti-abuso: 1 buzón por dueño y 20 agentes por buzón.
create unique index if not exists buzones_un_buzon_por_dueno on public.buzones(dueno_id);
create or replace function public.limite_agentes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.agentes where buzon_id = new.buzon_id) >= 20 then
    raise exception 'maximo 20 agentes por buzon' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger agentes_limite before insert on public.agentes for each row execute function public.limite_agentes();

revoke execute on function public.hilos_agentes_mismo_buzon(), public.limite_agentes() from public, anon, authenticated;
