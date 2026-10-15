-- RLS en TODAS las tablas. anon no tiene acceso a nada (sin enlaces públicos).
alter table public.buzones      enable row level security;
alter table public.agentes      enable row level security;
alter table public.tokens       enable row level security;
alter table public.hilos        enable row level security;
alter table public.mensajes     enable row level security;
alter table public.aprobaciones enable row level security;
alter table public.auditoria    enable row level security;
alter table public.buzones      force row level security;
alter table public.agentes      force row level security;
alter table public.tokens       force row level security;
alter table public.hilos        force row level security;
alter table public.mensajes     force row level security;
alter table public.aprobaciones force row level security;
alter table public.auditoria    force row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- buzones
grant select, insert, update, delete on public.buzones to authenticated;
create policy buzones_dueno on public.buzones for all to authenticated
  using (dueno_id = auth.uid()) with check (dueno_id = auth.uid());

-- agentes
grant select, insert, update, delete on public.agentes to authenticated;
create policy agentes_dueno on public.agentes for all to authenticated
  using (public.es_dueno(buzon_id)) with check (public.es_dueno(buzon_id));

-- tokens: el humano ve/crea/revoca, nunca lee hash de otro buzón
grant select, insert on public.tokens to authenticated;
grant update (revocado_en) on public.tokens to authenticated;
create policy tokens_dueno on public.tokens for all to authenticated
  using (public.es_dueno((select buzon_id from public.agentes a where a.id = agente_id)))
  with check (public.es_dueno((select buzon_id from public.agentes a where a.id = agente_id)));

-- hilos
grant select, insert, update on public.hilos to authenticated;
create policy hilos_dueno on public.hilos for all to authenticated
  using (public.es_dueno(buzon_id)) with check (public.es_dueno(buzon_id));

-- mensajes (humano solo firma como sí mismo)
grant select, insert on public.mensajes to authenticated;
create policy mensajes_leer on public.mensajes for select to authenticated
  using (public.es_dueno((select buzon_id from public.hilos h where h.id = hilo_id)));
create policy mensajes_escribir on public.mensajes for insert to authenticated
  with check (autor_humano = auth.uid() and autor_agente is null
    and public.es_dueno((select buzon_id from public.hilos h where h.id = hilo_id)));

-- aprobaciones: solo INSERT de humano autenticado dueño del buzón
grant select, insert on public.aprobaciones to authenticated;
create policy aprob_leer on public.aprobaciones for select to authenticated
  using (public.es_dueno((select buzon_id from public.hilos h where h.id = hilo_id)));
create policy aprob_insert on public.aprobaciones for insert to authenticated
  with check (humano_id = auth.uid()
    and public.es_dueno((select buzon_id from public.hilos h where h.id = hilo_id)));

-- auditoria: el dueño solo LEE; escritura vía triggers/servidor
grant select on public.auditoria to authenticated;
create policy audit_leer on public.auditoria for select to authenticated
  using (public.es_dueno(buzon_id));
