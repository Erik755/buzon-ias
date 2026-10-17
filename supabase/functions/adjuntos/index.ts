// Edge Function "adjuntos": sube (base64, validado) y firma descargas de 5 min. Única vía al bucket privado.
// Usa SUPABASE_SERVICE_ROLE_KEY (la inyecta Supabase; nunca sale de aquí).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { manejar } from '../_shared/adjuntos_core.js';
import { secretoValido } from '../_shared/interno.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SECRETO = Deno.env.get('BUZON_SECRETO_INTERNO') ?? '';
const ORIGENES = (Deno.env.get('BUZON_ORIGENES') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const bucket = db.storage.from('adjuntos');
const deps = {
  rpc: async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; },
  subir: async (ruta: string, bytes: Uint8Array, tipo: string) => { const { error } = await bucket.upload(ruta, bytes, { contentType: tipo, upsert: false }); if (error) throw new Error('500:No se pudo guardar'); },
  borrar: async (ruta: string) => { await bucket.remove([ruta]); },
  firmar: async (ruta: string, seg: number, nombre: string) => { const { data, error } = await bucket.createSignedUrl(ruta, seg, { download: nombre }); if (error) throw new Error('500:No se pudo firmar'); return data.signedUrl; },
  usuario: async (jwt: string) => { const { data } = await db.auth.getUser(jwt); return data.user?.id ?? null; },
  uuid: () => crypto.randomUUID(),
};

Deno.serve(async (req) => {
  const origen = req.headers.get('origin') ?? '';
  const cors: Record<string, string> = ORIGENES.includes(origen)
    ? { 'Access-Control-Allow-Origin': origen, 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', Vary: 'Origin' } : {};
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('POST', { status: 405, headers: cors });
  if (Number(req.headers.get('content-length') ?? 0) > 4_500_000) return Response.json({ error: 'Peticion demasiado grande' }, { status: 413, headers: cors });
  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = req.headers.get('x-buzon-token') ?? undefined;
  // x-buzon-ip (IP real de la IA) solo se cree si viene del MCP con el secreto interno; si no, la del borde.
  const interno = secretoValido(req.headers.get('x-buzon-interno') ?? '', SECRETO);
  const ip = ((interno ? req.headers.get('x-buzon-ip') : null) ?? req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  let entrada; try { entrada = await req.json(); } catch { return Response.json({ error: 'JSON invalido' }, { status: 400, headers: cors }); }
  const r = await manejar(entrada, { token, jwt: token ? undefined : auth, ip }, deps);
  return Response.json(r.cuerpo, { status: r.status, headers: { ...cors, 'Cache-Control': 'no-store' } });
});
