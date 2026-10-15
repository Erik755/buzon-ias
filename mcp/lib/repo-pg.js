// Acceso a datos para pruebas: Postgres directo con el rol service_role (igual que en Supabase).
export function repoPg(pool) {
  const q = async (sql, params) => {
    const c = await pool.connect();
    try { await c.query('set role service_role'); return (await c.query(sql, params)).rows; }
    finally { await c.query('reset role').catch(() => {}); c.release(); }
  };
  return {
    async validarToken(h, a) { return (await q('select * from public.validar_token($1,$2)', [h, a]))[0] ?? null; },
    async llamadasUltimoMinuto(id) {
      return +(await q("select count(*) n from public.auditoria where actor=$1 and creado_en > now()-interval '1 minute'", ['agente:' + id]))[0].n;
    },
    async crearHilo(h) {
      return (await q('insert into public.hilos(buzon_id,tipo,titulo,contexto,creado_por_agente) values($1,$2,$3,$4,$5) returning *',
        [h.buzon_id, h.tipo, h.titulo, h.contexto, h.creado_por_agente]))[0];
    },
    async listarHilos(b, { estado, limite }) {
      return q('select id,tipo,titulo,estado,creado_en from public.hilos where buzon_id=$1 and ($2::text is null or estado=$2) order by creado_en desc limit $3', [b, estado ?? null, limite]);
    },
    async obtenerHilo(b, id) { return (await q('select * from public.hilos where buzon_id=$1 and id=$2', [b, id]))[0] ?? null; },
    async mensajes(id) { return q('select m.id,m.autor_agente,m.autor_humano,m.cuerpo,m.creado_en,json_build_object(\'nombre\',a.nombre) agentes from public.mensajes m left join public.agentes a on a.id=m.autor_agente where hilo_id=$1 order by m.creado_en', [id]); },
    async aprobaciones(id) { return q('select decision,nota,creado_en from public.aprobaciones where hilo_id=$1 order by creado_en', [id]); },
    async insertarMensaje(m) { return (await q('insert into public.mensajes(hilo_id,autor_agente,cuerpo) values($1,$2,$3) returning *', [m.hilo_id, m.autor_agente, m.cuerpo]))[0]; },
    async cambiarEstado(b, id, c) {
      return (await q('update public.hilos set estado=coalesce($3,estado), tomado_por_agente=coalesce($4,tomado_por_agente) where buzon_id=$1 and id=$2 returning *', [b, id, c.estado ?? null, c.tomado_por_agente ?? null]))[0];
    },
    async auditar(e) { await q('insert into public.auditoria(buzon_id,actor,accion,objeto_id,ip) values($1,$2,$3,$4,$5)', [e.buzon_id, e.actor, e.accion, e.objeto_id ?? null, e.ip ?? null]); },
  };
}
