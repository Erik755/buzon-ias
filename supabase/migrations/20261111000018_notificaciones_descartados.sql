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

