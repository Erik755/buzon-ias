-- 018: descartes definitivos de destinos, separados de las entregas reales.
-- Antes los fallos definitivos (destino prohibido, 4xx definitivo) se marcaban en
-- entregados como si se hubieran avisado; eso inflaba los frenos anti rebote de
-- _destinos_webhook y borraba el rastro del problema. Ahora van a `descartados`
-- con su motivo: no cuentan como entrega y no se reintentan.

alter table public.notificaciones add column if not exists descartados text[] not null default '{}';
comment on column public.notificaciones.descartados is
  'Destinos descartados sin entregar, con motivo (p. ej. wh:<id>|http:404). No son entregas; los reintentos los omiten.';

-- _tomar_notificaciones devuelve también descartados (cambia la firma: hay que recrearla).
drop function if exists public._tomar_notificaciones(int);
create function public._tomar_notificaciones(p_limite int default 20)
returns table(id bigint, buzon_id uuid, hilo_id uuid, evento text, intentos int, creado_por_agente uuid, entregados text[], descartados text[])
language sql security definer set search_path = public as $$
  update public.notificaciones n set intentos = n.intentos + 1,
         proximo_intento = now() + (interval '1 minute' * power(4, n.intentos))
  from public.hilos h
  where n.id in (select id from public.notificaciones where estado = 'pendiente' and proximo_intento <= now()
                 order by id limit least(p_limite, 50) for update skip locked)
    and h.id = n.hilo_id
  returning n.id, n.buzon_id, n.hilo_id, n.evento, n.intentos, coalesce(n.agente_origen, h.creado_por_agente), n.entregados, n.descartados;
$$;
revoke all on function public._tomar_notificaciones(int) from public, anon, authenticated;
grant execute on function public._tomar_notificaciones(int) to service_role;

-- Marca un descarte definitivo con motivo (no es una entrega).
create or replace function public._marcar_descartado(p_id bigint, p_destino text)
returns void language sql security definer set search_path = public as $$
  update public.notificaciones set descartados = array_append(descartados, left(p_destino, 120))
   where id = p_id and not (left(p_destino, 120) = any(descartados));
$$;
revoke all on function public._marcar_descartado(bigint, text) from public, anon, authenticated;
grant execute on function public._marcar_descartado(bigint, text) to service_role;

-- Detalles menores de la 017 (sin tocar esa migración, ya aplicada): p_activo null ya no borra
-- en silencio, y la auditoría solo se escribe cuando hubo cambio real.
-- El dueño marca o desmarca una IA en un hilo suyo. Escribe solo esta RPC (no hay INSERT directo).
create or replace function public.suscribir_agente_hilo(p_hilo uuid, p_agente uuid, p_activo boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare b uuid; cambio uuid;
begin
  if auth.uid() is null then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'p_activo requerido' using errcode = '22004';
  end if;
  select h.buzon_id into b
    from public.hilos h
    join public.agentes a on a.id = p_agente and a.buzon_id = h.buzon_id and a.eliminado_en is null
   where h.id = p_hilo and public.es_dueno(h.buzon_id);
  if b is null then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  if p_activo then
    insert into public.hilo_suscripciones(hilo_id, agente_id, buzon_id)
      values (p_hilo, p_agente, b)
      on conflict (hilo_id, agente_id) do nothing
      returning hilo_id into cambio;
    if cambio is not null then
      insert into public.auditoria(buzon_id, actor, accion, objeto_id)
        values (b, 'humano:' || auth.uid(), 'hilo:suscribir', p_agente);
    end if;
  else
    delete from public.hilo_suscripciones where hilo_id = p_hilo and agente_id = p_agente
      returning hilo_id into cambio;
    if cambio is not null then
      insert into public.auditoria(buzon_id, actor, accion, objeto_id)
        values (b, 'humano:' || auth.uid(), 'hilo:desuscribir', p_agente);
    end if;
  end if;
  return p_activo;
end $$;
revoke all on function public.suscribir_agente_hilo(uuid, uuid, boolean) from public, anon;
grant execute on function public.suscribir_agente_hilo(uuid, uuid, boolean) to authenticated;
