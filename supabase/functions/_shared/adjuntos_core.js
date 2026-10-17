// Lógica de la Edge Function "adjuntos" con dependencias inyectadas (para probarla en Node).
// deps: { rpc(fn,args), subir(ruta, bytes, tipo), borrar(ruta), firmar(ruta, segundos, nombre), usuario(jwt) -> uuid|null, uuid() }
import { detectarTipo, deBase64, nombreSeguro, MAX_BYTES } from './tipos.js';

export const SEGUNDOS_URL = 300; // URLs firmadas de descarga: 5 minutos
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const err = (status, error) => ({ status, cuerpo: { error } });
const codigo = (e) => { const m = /^(\d{3}):(.*)$/s.exec(e?.message || ''); return m ? err(+m[1], m[2]) : null; };

export async function manejar(entrada, { token, jwt, ip }, deps) {
  try {
    if (entrada?.accion === 'subir') return await subir(entrada, token, ip, deps);
    if (entrada?.accion === 'firmar') return await firmar(entrada, token, jwt, ip, deps);
    return err(400, 'accion debe ser subir o firmar');
  } catch (e) { return codigo(e) ?? (console.error(e), err(500, 'Error interno')); }
}

async function agente(token, alcance, ip, deps) {
  if (!token || !/^bz_[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('401:Falta token bz_ valido');
  const a = await deps.rpc('_mcp_ctx', { p_token: token, p_alcance: alcance, p_ip: ip });
  return a;
}

async function subir({ hilo_id, mensaje_id, nombre, base64 }, token, ip, deps) {
  const a = await agente(token, mensaje_id ? 'responder' : 'crear', ip, deps);
  if (!/^[0-9a-f-]{36}$/i.test(hilo_id || '')) return err(400, 'hilo_id invalido');
  if (mensaje_id != null && !/^[0-9a-f-]{36}$/i.test(mensaje_id)) return err(400, 'mensaje_id invalido');
  const bytes = deBase64(base64);
  if (bytes === 'grande' || (bytes && bytes.length > MAX_BYTES)) return err(413, `Archivo mayor a ${MAX_BYTES / 1048576} MB`);
  if (!bytes || bytes.length === 0) return err(400, 'base64 invalido o vacio');
  const limpio = nombreSeguro(nombre);
  const tipo = detectarTipo(bytes, limpio);
  if (!tipo) return err(415, 'Tipo no permitido o no coincide con el contenido. Permitidos: pdf, png, jpg, webp, txt, md');
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  // Hilo, mensaje y cuota se revisan ANTES de subir; _registrar_adjunto lo repite con candado (carreras).
  await deps.rpc('_verificar_adjunto', { p_agente: a.id, p_hilo: hilo_id, p_mensaje: mensaje_id ?? null, p_tamano: bytes.length });
  const ruta = `${a.buzon_id}/${deps.uuid()}`;
  await deps.subir(ruta, bytes, tipo);
  try {
    const id = await deps.rpc('_registrar_adjunto', { p_agente: a.id, p_hilo: hilo_id, p_mensaje: mensaje_id ?? null, p_nombre: limpio,
      p_tipo: tipo, p_tamano: bytes.length, p_sha256: sha, p_ruta: ruta, p_ip: ip });
    return { status: 200, cuerpo: { id, nombre: limpio, tipo, tamano: bytes.length, sha256: sha } };
  } catch (e) { await deps.borrar(ruta).catch(() => {}); throw e; }
}

async function firmar({ adjunto_id }, token, jwt, ip, deps) {
  if (!/^[0-9a-f-]{36}$/i.test(adjunto_id || '')) return err(400, 'adjunto_id invalido');
  let pAgente = null, pHumano = null;
  if (token) pAgente = (await agente(token, 'leer', ip, deps)).id;
  else if (jwt) { pHumano = await deps.usuario(jwt); if (!pHumano) return err(401, 'Sesion invalida'); }
  else return err(401, 'Falta token bz_ o sesion');
  const filas = await deps.rpc('_autorizar_descarga', { p_adjunto: adjunto_id, p_agente: pAgente, p_humano: pHumano, p_ip: ip });
  const f = Array.isArray(filas) ? filas[0] : filas;
  const url = await deps.firmar(f.ruta, SEGUNDOS_URL, f.nombre);
  return { status: 200, cuerpo: { url, nombre: f.nombre, tipo: f.tipo, caduca_en_segundos: SEGUNDOS_URL } };
}
