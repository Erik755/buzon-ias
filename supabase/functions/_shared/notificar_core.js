// Lógica del notificador (push + webhooks). Dependencias inyectadas para probarla en Node.
// deps: { rpc, suscripciones(buzon), borrarSuscripcion(id), detalleHilo?(hilo, evento, creador) -> { tituloHilo, quien } | null,
//         webhooks(buzon, excepto), resolver(host),
//         enviar(url, ip, headers, body) -> status   (POST a la IP ya validada; ver http_fijo.js), claves? }
// * webhooks(buzon, excepto, n): en producción usa _destinos_webhook(n.id) (solo IAs del hilo + freno anti ping-pong).
// * Un fallo temporal (DNS, red, 408/429/5xx) se reintenta; uno definitivo (destino prohibido, sin secreto,
//   redirección, otro 4xx) se DESCARTA con motivo (_marcar_descartado): nunca cuenta como entregado y no se reintenta.
// * Cada destino entregado se marca (_marcar_entregado): los reintentos solo van a los que fallaron.
// * Los descartes previos vuelven a entrar en `fallos`: un aviso con destinos descartados cierra como fallo
//   visible (estado 'fallida' con el motivo), nunca como entregado.
// * En la BD (legible por el dueño) solo se guarda la CATEGORÍA del motivo, nunca el código HTTP;
//   el status numérico va solo al log de la función, no a ninguna columna legible por el dueño.
// * Cada destino deja una línea de log JSON con notif, destino, motivo, status y ms: sin URLs, secretos ni contenido.
import { validarDestino, definitivoHttp, DNS_TEMPORALES } from './ssrf.js';
import { firmar, payloadTarea, payloadMensaje } from './hmac.js';
import { enviarPush, payloadPush } from './webpush.js';

export async function procesar(deps, limite = 20) {
  const lote = (await deps.rpc('_tomar_notificaciones', { p_limite: limite })) || [];
  const resumen = { procesadas: 0, ok: 0, errores: 0 };
  for (const n of lote) {
    resumen.procesadas++;
    // Una excepción en un aviso no puede abortar el lote: se cierra como fallo y se sigue.
    try {
      (await procesarUna(n, deps)) ? resumen.ok++ : resumen.errores++;
    } catch (e) {
      try { await deps.rpc('_cerrar_notificacion', { p_id: n.id, p_ok: false, p_error: 'interno' }); } catch { /* queda pendiente para el próximo pase */ }
      console.error(JSON.stringify({ paso: 'notificacion', notif: n.id, error: 'interno' }));
      resumen.errores++;
    }
  }
  return resumen;
}

async function procesarUna(n, deps) {
  const hechos = new Set(n.entregados || []);
  const previos = n.descartados || [];
  const descartados = new Set(previos.map((x) => x.split('|')[0]));
  // Los descartes definitivos ya registrados siguen contando como error: el aviso no llegó a ese destino.
  const fallos = new Set(previos.map((x) => `descartado:${x}`));
  const marcar = (d) => deps.rpc('_marcar_entregado', { p_id: n.id, p_destino: d });
  const descartar = async (d, motivo) => { await deps.rpc('_marcar_descartado', { p_id: n.id, p_destino: `${d}|${motivo}` }); fallos.add(`descartado:${d}|${motivo}`); };
  // En la BD solo la categoría ('http', 'sin_secreto'...); el código HTTP va solo al log.
  const motivoDb = (r) => (!r.motivo || r.motivo.startsWith('http_') ? 'http' : r.motivo);
  const bitacora = (d, r, t1) => console.log(JSON.stringify({ paso: 'destino', notif: n.id, destino: d, motivo: r.motivo ?? null, status: r.status ?? null, ms: Date.now() - t1 }));

  // Los mensajes entre IAs no hacen sonar el teléfono del dueño: solo avisan a las otras IAs.
  // Tope de push (QA): máx. 10 push de hilos nuevos por hora y buzón; si la consulta falla, se envía.
  let pushOk = true;
  if (n.evento === 'hilo_nuevo') { try { pushOk = (await deps.rpc('_permitir_push', { p_id: n.id })) !== false; } catch { pushOk = true; } }
  if (deps.claves && n.evento !== 'mensaje_nuevo' && pushOk) {
    let subs = [];
    try { subs = await deps.suscripciones(n.buzon_id); } catch { fallos.add('push_fallo'); }
    // Título del hilo y quién pide (sin contenido); si la consulta falla, el aviso sale con texto genérico.
    let detalle = null;
    if (subs.length && deps.detalleHilo) { try { detalle = await deps.detalleHilo(n.hilo_id, n.evento, n.creado_por_agente); } catch { detalle = null; } }
    for (const s of subs) {
      const d = `push:${s.id}`;
      if (hechos.has(d) || descartados.has(d)) continue;
      const t1 = Date.now();
      try {
        const r = await enviarPush(s, payloadPush(n.evento, n.hilo_id, detalle), deps.claves, deps);
        bitacora(d, r, t1);
        if (r.ok) await marcar(d);
        else if (r.status === 404 || r.status === 410) { await deps.borrarSuscripcion(s.id); await descartar(d, 'http'); } // suscripción muerta: se borra y consta el descarte
        else if (r.definitivo) await descartar(d, motivoDb(r));
        else fallos.add('push_fallo');
      } catch { fallos.add('push_fallo'); }
    }
  }
  if (n.evento === 'hilo_nuevo' || n.evento === 'mensaje_nuevo') {
    let destinos = [];
    try { destinos = await deps.webhooks(n.buzon_id, n.creado_por_agente, n); } catch { fallos.add('webhook_fallo'); }
    for (const w of destinos) {
      const d = `wh:${w.id}`;
      if (hechos.has(d) || descartados.has(d)) continue;
      const t1 = Date.now();
      try {
        const r = await enviarWebhook(w, n.hilo_id, deps, n.evento);
        bitacora(d, r, t1);
        if (r.ok) await marcar(d);
        else if (r.definitivo) await descartar(d, motivoDb(r));
        else fallos.add('webhook_fallo');
      } catch { fallos.add('webhook_fallo'); }
    }
  }
  await deps.rpc('_cerrar_notificacion', { p_id: n.id, p_ok: fallos.size === 0, p_error: [...fallos].join(',').slice(0, 400) || null });
  return fallos.size === 0;
}

// Motivos que ameritan reintento (los demás son definitivos). Los http_* se clasifican con definitivoHttp.
export const TEMPORALES = new Set(['dns_fallo', 'dns_vacio', 'red_o_timeout', 'http']);

// Cabeceras: X-Buzon-Firma (HMAC con el secreto whsec_, si existe) y Authorization: Bearer <clave del receptor>
// (si el dueño pegó la clave de su receptor, p. ej. la "Webhook key" de una rutina de Grok Bot).
export async function enviarWebhook(w, hiloId, deps, evento = 'hilo_nuevo') {
  if (!w.webhook_secreto && !w.webhook_clave) return { ok: false, motivo: 'sin_secreto', definitivo: true };
  const v = await validarDestino(w.webhook_url, deps.resolver);
  if (!v.ok) return { ...v, definitivo: !DNS_TEMPORALES.has(v.motivo) };
  const cuerpo = evento === 'mensaje_nuevo' ? payloadMensaje(hiloId) : payloadTarea(hiloId);
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'buzon-ias-webhook/1' };
  if (w.webhook_secreto) headers['X-Buzon-Firma'] = await firmar(w.webhook_secreto, cuerpo);
  if (w.webhook_clave) headers.Authorization = `Bearer ${w.webhook_clave}`;
  let ultimo = { ok: false, motivo: 'red_o_timeout', definitivo: false };
  for (const ip of v.ips.slice(0, 3)) { // si una IP no responde, se prueba la siguiente (todas ya validadas)
    try {
      const status = await deps.enviar(w.webhook_url, ip, headers, cuerpo);
      if (status >= 300 && status < 400) return { ok: false, motivo: 'redireccion_no_permitida', status, definitivo: true };
      if (status >= 200 && status < 300) return { ok: true, status };
      return { ok: false, motivo: `http_${status}`, status, definitivo: definitivoHttp(status) };
    } catch { ultimo = { ok: false, motivo: 'red_o_timeout', definitivo: false }; }
  }
  return ultimo;
}
