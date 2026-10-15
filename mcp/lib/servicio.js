// Las 3 acciones llaman a funciones SQL (mcp_crear/leer/responder) que validan el token.
// `rpc(nombre, args)` es supabase-js con la clave pública en producción, o pg con rol anon en pruebas.
export class ErrorBuzon extends Error { constructor(codigo, msg) { super(msg); this.codigo = codigo; } }

export function crearServicio(rpc) {
  const llamar = async (fn, token, args, ip) => {
    if (!token) throw new ErrorBuzon(401, 'Falta token Bearer bz_...');
    try { return await rpc(fn, { p_token: token, ...args, p_ip: ip ?? null }); }
    catch (e) {
      const m = /^(\d{3}):(.*)$/s.exec(e.message || '');
      if (m) throw new ErrorBuzon(+m[1], m[2]);
      throw e;
    }
  };
  return {
    crear: (t, { tipo, titulo, contexto, enlaces = [] }, ip) =>
      llamar('mcp_crear', t, { p_tipo: tipo, p_titulo: titulo,
        p_contexto: [contexto, ...enlaces.map((e) => '🔗 ' + e)].filter(Boolean).join('\n') || null }, ip),
    leer: (t, { hilo_id, estado, limite = 20 }, ip) =>
      llamar('mcp_leer', t, { p_hilo_id: hilo_id ?? null, p_estado: estado ?? null, p_limite: limite }, ip),
    responder: (t, { hilo_id, cuerpo, accion = 'comentar' }, ip) =>
      llamar('mcp_responder', t, { p_hilo_id: hilo_id, p_cuerpo: cuerpo, p_accion: accion }, ip),
  };
}

export function rpcSupabase(createClient, url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY) {
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; };
}

export function rpcPg(pool) {
  return async (fn, args) => {
    const c = await pool.connect();
    try {
      await c.query('set role anon');
      const ks = Object.keys(args);
      const sql = `select public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(',')}) r`;
      return (await c.query(sql, ks.map((k) => args[k]))).rows[0].r;
    } finally { await c.query('reset role').catch(() => {}); c.release(); }
  };
}
