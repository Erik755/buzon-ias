// Firma HMAC-SHA256 de webhooks: X-Buzon-Firma: t=<unix>,v1=<hex(HMAC(secreto, t + "." + cuerpo))>
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function firmar(secreto, cuerpo, t = Math.floor(Date.now() / 1000)) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `t=${t},v1=${hex(await crypto.subtle.sign('HMAC', k, enc.encode(`${t}.${cuerpo}`)))}`;
}
// Para el receptor (y las pruebas): verifica firma y antigüedad (5 min por defecto).
export async function verificar(secreto, cuerpo, cabecera, ahora = Math.floor(Date.now() / 1000), tolerancia = 300) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecera || ''); if (!m) return false;
  if (Math.abs(ahora - +m[1]) > tolerancia) return false;
  const esperada = (await firmar(secreto, cuerpo, +m[1])).split('v1=')[1];
  let d = 0; for (let i = 0; i < 64; i++) d |= esperada.charCodeAt(i) ^ m[2].charCodeAt(i); return d === 0;
}
// Payload mínimo: sin títulos ni contenido.
export function payloadTarea(hiloId) {
  return JSON.stringify({ evento: 'tarea_nueva', hilo_id: hiloId, aviso: 'Tienes una tarea nueva en el Buzón. Llama a la herramienta "leer" con este hilo_id.' });
}
