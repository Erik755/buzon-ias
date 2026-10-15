-- Ajustes tras la prueba en producción:
-- 1) Borrar un agente o usuario deja sus mensajes con autor NULL (antes chocaba con el CHECK).
alter table public.mensajes drop constraint if exists mensajes_check;
alter table public.mensajes add constraint mensajes_un_autor check (num_nonnulls(autor_agente, autor_humano) <= 1);
-- 2) search_path fijo en funciones de trigger (linter de Supabase).
alter function public.auditoria_inmutable() set search_path = public;
alter function public.hilos_estado_guard() set search_path = public;
-- Nota: mcp_crear/leer/responder son ejecutables por anon A PROPÓSITO: el token bz_ (256 bits) es la credencial
-- y cada función lo valida. No exponen tablas ni validar_token/_mcp_ctx.
