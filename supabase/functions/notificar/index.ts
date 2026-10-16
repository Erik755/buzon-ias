// Edge Function "notificar": vacía la cola de notificaciones (push VAPID + webhooks firmados).
// Idempotente y sin entrada: se puede llamar desde el MCP tras crear/responder, o con pg_cron cada minuto.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { procesar } from '../_shared/notificar_core.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY'), sujeto = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:buzon@example.invalid';
const deps = {
  rpc: async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; },
  suscripciones: async (b: string) => (await db.from('push_suscripciones').select('id,endpoint,p256dh,auth').eq('buzon_id', b)).data ?? [],
  borrarSuscripcion: async (id: string) => { await db.from('push_suscripciones').delete().eq('id', id); },
  webhooks: async (b: string, excepto: string | null) => {
    let q = db.from('agentes').select('id,webhook_url,webhook_secreto').eq('buzon_id', b).not('webhook_url', 'is', null);
    if (excepto) q = q.neq('id', excepto);
    return (await q).data ?? [];
  },
  resolver: async (h: string) => [
    ...(await Deno.resolveDns(h, 'A').catch(() => [])), ...(await Deno.resolveDns(h, 'AAAA').catch(() => [])),
  ],
  fetch,
  claves: pub && priv ? { publica: pub, privada: priv, sujeto } : null,
};
let corriendo = false;
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST', { status: 405 });
  if (corriendo) return Response.json({ ocupado: true });
  corriendo = true;
  try { return Response.json(await procesar(deps)); } finally { corriendo = false; }
});
