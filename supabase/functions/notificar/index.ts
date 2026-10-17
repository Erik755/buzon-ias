// Edge Function "notificar": vacía la cola de notificaciones (push VAPID + webhooks firmados).
// Acepta x-buzon-interno = BUZON_SECRETO_INTERNO (lo manda el MCP) o x-buzon-bd = secreto de Vault
// (lo manda la propia BD con pg_net al encolar un aviso y pg_cron cada minuto; ver migración 013).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { procesar } from '../_shared/notificar_core.js';
import { postFijo } from '../_shared/http_fijo.js';
import { secretoValido } from '../_shared/interno.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SECRETO = Deno.env.get('BUZON_SECRETO_INTERNO') ?? '';
const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY'), sujeto = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:buzon@example.invalid';
// TCP a la IP validada + TLS con el nombre original (SNI y certificado): sin segunda resolución DNS.
const conectar = async (ip: string, puerto: number, nombre: string) => {
  const tcp = await Deno.connect({ hostname: ip, port: puerto });
  return await Deno.startTls(tcp, { hostname: nombre });
};
const deps = {
  rpc: async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; },
  suscripciones: async (b: string) => (await db.from('push_suscripciones').select('id,endpoint,p256dh,auth').eq('buzon_id', b)).data ?? [],
  borrarSuscripcion: async (id: string) => { await db.from('push_suscripciones').delete().eq('id', id); },
  // Solo las IAs involucradas en el hilo, sin re-despertar a quien no lo ha abierto y con freno anti ping-pong.
  webhooks: async (_b: string, _excepto: string | null, n: { id: number }) => {
    const { data, error } = await db.rpc('_destinos_webhook', { p_id: n.id });
    if (error) throw new Error('destinos');
    return data ?? [];
  },
  resolver: async (h: string) => [
    ...(await Deno.resolveDns(h, 'A').catch(() => [])), ...(await Deno.resolveDns(h, 'AAAA').catch(() => [])),
  ],
  enviar: (url: string, ip: string, headers: Record<string, string>, body: Uint8Array | string) => postFijo({ url, ip, headers, body, conectar }),
  claves: pub && priv ? { publica: pub, privada: priv, sujeto } : null,
};
let secretoBd: { v: string; t: number } | null = null;
const deLaBd = async (recibido: string) => {
  if (!recibido) return false;
  if (!secretoBd || Date.now() - secretoBd.t > 300_000) {
    const { data } = await db.rpc('_secreto_bd');
    secretoBd = { v: typeof data === 'string' ? data : '', t: Date.now() };
  }
  return secretoValido(recibido, secretoBd.v);
};
let corriendo = false;
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST', { status: 405 });
  if (!secretoValido(req.headers.get('x-buzon-interno') ?? '', SECRETO) && !(await deLaBd(req.headers.get('x-buzon-bd') ?? '')))
    return new Response('no autorizado', { status: 401 });
  if (corriendo) return Response.json({ ocupado: true });
  corriendo = true;
  try { return Response.json(await procesar(deps)); } finally { corriendo = false; }
});
