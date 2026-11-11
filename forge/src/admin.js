// Lógica del resolver de ADMINISTRACIÓN, con dependencias inyectadas.
// Ambas operaciones exigen primero requireAdmin() (permiso global ADMINISTER del usuario que
// llama, verificado con mypermissions asUser en el wiring). Este módulo no conoce las
// operaciones del panel.
import { leerEnBuzon, ErrorPanel, TOKEN_RE, KVS_TOKEN } from './comun.js';

// Guarda el token como secreto KVS (por instalación); nunca lo devuelve.
// deps: { requireAdmin, guardarSecreto }
export async function guardarToken({ token }, deps) {
  await deps.requireAdmin();
  if (!TOKEN_RE.test(token || '')) throw new ErrorPanel('formato de token inválido (bz_…)');
  await deps.guardarSecreto(KVS_TOKEN, token);
  return { guardado: true }; // jamás incluir el token en la respuesta
}

// Prueba el token guardado listando un hilo (sin exponer datos: solo éxito/fracaso).
// deps: { requireAdmin, leerToken, fetchImpl }
export async function probarToken(_args, deps) {
  await deps.requireAdmin();
  const token = await deps.leerToken();
  if (!token) return { ok: false, detalle: 'sin token configurado' };
  try {
    await leerEnBuzon(deps.fetchImpl, token, { limite: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, detalle: e.message };
  }
}

// Definiciones que expone el resolver de administración. Las pruebas verifican que no incluye
// operaciones del panel.
export function adminOps(deps) {
  return {
    guardarToken: (req) => guardarToken(req.payload, deps),
    probarToken: (req) => probarToken(req.payload, deps),
  };
}
