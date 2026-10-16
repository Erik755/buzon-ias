// Lógica del notificador (push + webhooks). Dependencias inyectadas para probarla en Node.
// deps: { rpc, suscripciones(buzon) -> [{id,endpoint,p256dh,auth}], borrarSuscripcion(id),
//         webhooks(buzon, excepto) -> [{id,webhook_url,webhook_secreto}], resolver(host), fetch, claves? }
import { validarDestino } from './ssrf.js';
import { firmar, payloadTarea } from './hmac.js';
import { enviarPush, payloadPush } from './webpush.js';

export async function procesar(deps, limite = 20) {
  const lote = (await deps.rpc('_tomar_notificaciones', { p_limite: limite })) || [];
  const resumen = { procesadas: 0, ok: 0, errores: 0 };
  for (const n of lote) {
    resumen.procesadas++;
    const fallos = [];
    if (deps.claves) {
      for (const s of await deps.suscripciones(n.buzon_id)) {
        try {
          const r = await enviarPush(s, payloadPush(n.evento, n.titulo, n.hilo_id), deps.claves, deps.fetch);
          if (r.status === 404 || r.status === 410) await deps.borrarSuscripcion(s.id); // suscripción caducada
          else if (r.status >= 500 || r.status === 429) fallos.push(`push ${r.status}`);
        } catch (e) { fallos.push('push red'); }
      }
    }
    if (n.evento === 'hilo_nuevo') {
      for (const w of await deps.webhooks(n.buzon_id, n.creado_por_agente)) {
        const r = await enviarWebhook(w, n.hilo_id, deps);
        if (!r.ok) fallos.push(`webhook ${w.id}: ${r.motivo}`);
      }
    }
    await deps.rpc('_cerrar_notificacion', { p_id: n.id, p_ok: fallos.length === 0, p_error: fallos.join('; ') || null });
    fallos.length ? resumen.errores++ : resumen.ok++;
  }
  return resumen;
}

export async function enviarWebhook(w, hiloId, deps) {
  if (!w.webhook_secreto) return { ok: false, motivo: 'sin_secreto' };
  const v = await validarDestino(w.webhook_url, deps.resolver);
  if (!v.ok) return v;
  const cuerpo = payloadTarea(hiloId);
  try {
    const r = await deps.fetch(w.webhook_url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'buzon-ias-webhook/1', 'X-Buzon-Firma': await firmar(w.webhook_secreto, cuerpo) }, body: cuerpo });
    if (r.status >= 300 && r.status < 400) return { ok: false, motivo: 'redireccion_no_permitida' };
    return r.ok ? { ok: true } : { ok: false, motivo: `http_${r.status}` };
  } catch { return { ok: false, motivo: 'red_o_timeout' }; }
}
