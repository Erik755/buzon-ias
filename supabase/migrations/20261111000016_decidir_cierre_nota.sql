-- La nota de decidir_cierre se valida una sola vez, antes de tocar el hilo.
-- Depende de 20261109000015 (tabla cierres). Tiene que aplicarse después: si la 15
-- se volviera a ejecutar encima, repondría la función anterior.
-- El texto guardado en el mensaje y en cierres.motivo es el mismo: trim() de espacios
-- ASCII (igual que el motivo de antes), vacío como null, y como máximo 2000 caracteres,
-- el tope del CHECK. Si se pasa, se rechaza el veredicto entero. No se recorta en
-- silencio (eso hacía que el mensaje perdiera el final y el motivo no) ni se llega al
-- CHECK con la nota ya escrita en el detalle del error.

create or replace function public.decidir_cierre(p_hilo uuid, p_cerrar boolean, p_nota text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  h public.hilos;
  nota text;
begin
  if auth.uid() is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into h from public.hilos where id = p_hilo for update;
  if not found or not public.es_dueno(h.buzon_id) then raise exception 'sin permiso' using errcode = '42501'; end if;
  if h.estado = 'cerrado' then raise exception 'el hilo ya esta cerrado' using errcode = '22023'; end if;
  if not p_cerrar and h.estado <> 'pide_cierre' then raise exception 'nadie pidio cerrar este hilo' using errcode = '22023'; end if;
  nota := nullif(trim(p_nota), '');
  if nota is not null and length(nota) > 2000 then
    raise exception 'la nota supera 2000 caracteres' using errcode = '22023';
  end if;
  if nota is not null then
    insert into public.mensajes(hilo_id, autor_humano, cuerpo) values (h.id, auth.uid(), nota);
  end if;
  if p_cerrar then
    perform set_config('buzon.cierre_humano', 'si', true);
    update public.hilos set estado = 'cerrado' where id = h.id;
    perform set_config('buzon.cierre_humano', '', true);
  else
    update public.hilos set estado = 'abierto' where id = h.id;
  end if;
  insert into public.cierres(hilo_id, humano_id, veredicto, motivo)
    values (h.id, auth.uid(), case when p_cerrar then 'aceptado' else 'rechazado' end, nota);
  insert into public.auditoria(buzon_id, actor, accion, objeto_id)
    values (h.buzon_id, 'humano:' || auth.uid(), case when p_cerrar then 'cierre:aprobado' else 'cierre:rechazado' end, h.id);
  return case when p_cerrar then 'cerrado' else 'abierto' end;
end $$;
revoke all on function public.decidir_cierre(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_cierre(uuid, boolean, text) to authenticated;
