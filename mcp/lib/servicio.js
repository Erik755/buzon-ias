// Las acciones llaman a funciones SQL (mcp_crear/leer/responder) que validan el token.
// `rpc(nombre, args)` es supabase-js con la clave pública en producción, o pg con rol anon en pruebas.
// `funciones` (opcional) llama a las Edge Functions "adjuntos" y "notificar" de Supabase.
export class ErrorBuzon extends Error { constructor(codigo, msg) { super(msg); this.codigo = codigo; } }
const aError = (e) => { const m = /^(\d{3}):(.*)$/s.exec(e.message || ''); return m ? new ErrorBuzon(+m[1], m[2]) : e; };
export const MAX_ADJUNTOS = 3;

export function crearServicio(rpc, funciones = null) {
  const llamar = async (fn, token, args, ip) => {
    if (!token) throw new ErrorBuzon(401, 'Falta token Bearer bz_...');
    try { return await rpc(fn, { p_token: token, ...args, p_ip: ip ?? null }); } catch (e) { throw aError(e); }
  };
  const avisar = () => { funciones?.notificar().catch(() => {}); };
  const adjuntar = async (token, hiloId, mensajeId, lista, ip) => {
    if (!lista?.length) return undefined;
    if (!funciones) throw new ErrorBuzon(501, 'Adjuntos no configurados en este servidor');
    const out = [];
    for (const a of lista) {
      const r = await funciones.adjuntos({ accion: 'subir', hilo_id: hiloId, mensaje_id: mensajeId, nombre: a.nombre, base64: a.base64 }, token, ip);
      out.push(r.error ? { nombre: a.nombre, error: `[${r.status}] ${r.error}` } : r);
    }
    return out;
  };
  return {
    crear: async (t, { tipo, titulo, contexto, enlaces = [], adjuntos, para }, ip) => {
      const r = await llamar('mcp_crear', t, { p_tipo: tipo, p_titulo: titulo, p_para: para ?? null,
        p_contexto: [contexto, ...enlaces.map((e) => '🔗 ' + e)].filter(Boolean).join('\n') || null }, ip);
      const adj = await adjuntar(t, r?.id ?? r?.hilo?.id, null, adjuntos, ip);
      avisar();
      return adj ? { ...r, adjuntos: adj } : r;
    },
    leer: async (t, { hilo_id, estado, limite = 20, adjunto_id }, ip) => {
      if (adjunto_id) {
        if (!funciones) throw new ErrorBuzon(501, 'Adjuntos no configurados en este servidor');
        const r = await funciones.adjuntos({ accion: 'firmar', adjunto_id }, t, ip);
        if (r.error) throw new ErrorBuzon(r.status, r.error);
        return r;
      }
      return llamar('mcp_leer', t, { p_hilo_id: hilo_id ?? null, p_estado: estado ?? null, p_limite: limite }, ip);
    },
    responder: async (t, { hilo_id, cuerpo, accion = 'comentar', adjuntos }, ip) => {
      const r = await llamar('mcp_responder', t, { p_hilo_id: hilo_id, p_cuerpo: cuerpo, p_accion: accion }, ip);
      const adj = await adjuntar(t, hilo_id, r?.mensaje_id ?? r?.mensaje?.id ?? null, adjuntos, ip);
      avisar();
      return adj ? { ...r, adjuntos: adj } : r;
    },
  };
}

// Edge Functions de Supabase. Se identifican con la clave pública + el token bz_ en X-Buzon-Token.
// BUZON_SECRETO_INTERNO (Vercel, mismo valor que el secret de Supabase) autentica al MCP ante las funciones.
export function funcionesSupabase(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY, f = fetch, interno = process.env.BUZON_SECRETO_INTERNO) {
  if (!url || !key) return null;
  const llamar = async (nombre, cuerpo, token, ip) => {
    const r = await f(`${url}/functions/v1/${nombre}`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: {
      'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`,
      ...(token ? { 'X-Buzon-Token': token } : {}), ...(interno ? { 'X-Buzon-Interno': interno, ...(ip ? { 'X-Buzon-IP': ip } : {}) } : {}) }, body: JSON.stringify(cuerpo ?? {}) });
    const j = await r.json().catch(() => ({ error: 'respuesta invalida' }));
    return r.ok ? j : { status: r.status, error: j.error || 'error' };
  };
  return { adjuntos: (c, t, ip) => llamar('adjuntos', c, t, ip), notificar: async () => (interno ? llamar('notificar', {}) : { omitido: true }) };
}

export function rpcSupabase(createClient, url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY) {
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; };
}

// Igual que supabase-js: compuestos como objeto y funciones "setof"/"table" como arreglo.
export function rpcPg(pool, rol = 'anon') {
  const conjunto = new Map();
  return async (fn, args) => {
    const c = await pool.connect();
    try {
      if (!conjunto.has(fn)) conjunto.set(fn, (await c.query("select bool_or(proretset) s from pg_proc where proname=$1 and pronamespace='public'::regnamespace", [fn])).rows[0].s);
      await c.query(`set role ${rol}`);
      const ks = Object.keys(args);
      const sql = `select to_jsonb(x) r from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(',')}) x`;
      const rows = (await c.query(sql, ks.map((k) => args[k]))).rows.map((r) => r.r);
      return conjunto.get(fn) ? rows : rows[0];
    } finally { await c.query('reset role').catch(() => {}); c.release(); }
  };
}
