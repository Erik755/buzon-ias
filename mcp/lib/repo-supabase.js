// Acceso a datos en producción: supabase-js con service_role (solo en el servidor).
import { createClient } from '@supabase/supabase-js';

export function repoSupabase(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async validarToken(hash, alcance) {
      const rows = ok(await db.rpc('validar_token', { p_hash: hash, p_alcance: alcance }));
      return rows?.[0] ?? null;
    },
    async llamadasUltimoMinuto(agenteId) {
      const { count, error } = await db.from('auditoria').select('id', { count: 'exact', head: true })
        .eq('actor', 'agente:' + agenteId).gte('creado_en', new Date(Date.now() - 60_000).toISOString());
      if (error) throw new Error(error.message); return count ?? 0;
    },
    async crearHilo(h) { return ok(await db.from('hilos').insert(h).select().single()); },
    async listarHilos(buzonId, { estado, limite }) {
      let q = db.from('hilos').select('id,tipo,titulo,estado,creado_en').eq('buzon_id', buzonId)
        .order('creado_en', { ascending: false }).limit(limite);
      if (estado) q = q.eq('estado', estado);
      return ok(await q);
    },
    async obtenerHilo(buzonId, hiloId) {
      return ok(await db.from('hilos').select('*').eq('buzon_id', buzonId).eq('id', hiloId).maybeSingle());
    },
    async mensajes(hiloId) {
      return ok(await db.from('mensajes').select('id,autor_agente,autor_humano,cuerpo,creado_en,agentes(nombre)')
        .eq('hilo_id', hiloId).order('creado_en'));
    },
    async aprobaciones(hiloId) {
      return ok(await db.from('aprobaciones').select('decision,nota,creado_en').eq('hilo_id', hiloId).order('creado_en'));
    },
    async insertarMensaje(m) { return ok(await db.from('mensajes').insert(m).select().single()); },
    async cambiarEstado(buzonId, hiloId, cambios) {
      return ok(await db.from('hilos').update(cambios).eq('buzon_id', buzonId).eq('id', hiloId).select().single());
    },
    async auditar(e) { ok(await db.from('auditoria').insert(e)); },
  };
}
