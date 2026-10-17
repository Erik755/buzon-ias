// Lógica del notificador (push + webhooks). Dependencias inyectadas para probarla en Node.
// deps: { rpc, suscripciones(buzon), borrarSuscripcion(id), webhooks(buzon, excepto), resolver(host),
//         enviar(url, ip, headers, body) -> status   (POST a la IP ya validada; ver http_fijo.js), claves? }
// * Cada destino entregado se marca (_marcar_entregado): los reintentos solo van a los que fallaron.
// * En ultimo_error solo se guarda 'push_fallo' / 'webhook_fallo' (sin códigos HTTP: no sirve de oráculo).
import { validarDestino } from './ssrf.js';
import { firmar, payloadTarea, payloadMensaje } from './hmac.js';
import { enviarPush, payloadPush } from './webpush.js';

export async function procesar(deps, limite = 20) {
  const lote = (await deps.rpc('_tomar_notificaciones', { p_limite: limite })) || [];
  const resumen = { procesadas: 0, ok: 0, errores: 0 };
  for (const n of lote) {
    resumen.procesadas++;
    const hechos = new Set(n.entregados || []), fallos = new Set();
    const marcar = (d) => deps.rpc('_marcar_entregado', { p_id: n.id, p_destino: d });
    // Los mensajes entre IAs no hacen sonar el teléfono del dueño: solo avisan a las otras IAs.
    if (deps.claves && n.evento !== 'mensaje_nuevo') {
      for (const s of await deps.suscripciones(n.buzon_id)) {
        const d = `push:${s.id}`; if (hechos.has(d)) continue;
        try {
          const r = await enviarPush(s, payloadPush(n.evento, n.hilo_id), deps.claves, deps);
          if (r.ok) await marcar(d);
          else if (r.status === 404 || r.status === 410) await deps.borrarSuscripcion(s.id);
          else if (r.motivo) await marcar(d); // destino no permitido: no se reintenta
          else fallos.add('push_fallo');
        } catch { fallos.add('push_fallo'); }
      }
    }
    if (n.evento === 'hilo_nuevo' || n.evento === 'mensaje_nuevo') {
      for (const w of await deps.webhooks(n.buzon_id, n.creado_por_agente)) {
        const d = `wh:${w.id}`; if (hechos.has(d)) continue;
        const r = await enviarWebhook(w, n.hilo_id, deps, n.evento);
        if (r.ok) await marcar(d); else fallos.add('webhook_fallo');
      }
    }
    await deps.rpc('_cerrar_notificacion', { p_id: n.id, p_ok: fallos.size === 0, p_error: [...fallos].join(',') || null });
    fallos.size ? resumen.errores++ : resumen.ok++;
  }
  return resumen;
}

export async function enviarWebhook(w, hiloId, deps, evento = 'hilo_nuevo') {
  if (!w.webhook_secreto) return { ok: false, motivo: 'sin_secreto' };
  const v = await validarDestino(w.webhook_url, deps.resolver);
  if (!v.ok) return v;
  const cuerpo = evento === 'mensaje_nuevo' ? payloadMensaje(hiloId) : payloadTarea(hiloId);
  try {
    const status = await deps.enviar(w.webhook_url, v.ips[0], { 'Content-Type': 'application/json', 'User-Agent': 'buzon-ias-webhook/1', 'X-Buzon-Firma': await firmar(w.webhook_secreto, cuerpo) }, cuerpo);
    if (status >= 300 && status < 400) return { ok: false, motivo: 'redireccion_no_permitida' };
    return status >= 200 && status < 300 ? { ok: true } : { ok: false, motivo: 'http' };
  } catch { return { ok: false, motivo: 'red_o_timeout' }; }
}
