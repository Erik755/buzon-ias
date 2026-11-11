// Lógica del resolver del PANEL, con dependencias inyectadas para probar sin entorno Forge.
// Este módulo NO conoce guardarToken ni probarToken: esas operaciones viven en admin.js y el
// resolver del panel nunca las expone (separación exigida en la revisión de Grok).
import { leerEnBuzon, ErrorPanel, PWA_URL, PROP_ISSUE_HILO, UUID_RE } from './comun.js';

// Resumen de solo lectura para el panel.
// deps: { fetchImpl, leerToken, leerPropiedad }
export async function hiloResumen({ issueKey }, deps) {
  const hiloId = await deps.leerPropiedad(issueKey, PROP_ISSUE_HILO);
  if (!hiloId) return { vinculado: false };
  const token = await deps.leerToken();
  if (!token) throw new ErrorPanel('falta configurar el token (página de administración)');
  const h = await leerEnBuzon(deps.fetchImpl, token, { hilo_id: hiloId });
  const mensajes = h.mensajes || [];
  return {
    vinculado: true,
    hiloId,
    titulo: h.titulo || '(sin título)',
    estado: h.estado || 'desconocido',
    totalMensajes: mensajes.length,
    ultimos: mensajes.slice(-5).map((m) => ({ autor: m.autor, creado_en: m.creado_en, cuerpo: (m.cuerpo || '').slice(0, 280) })),
    enlacePwa: `${PWA_URL}?hilo=${hiloId}`,
  };
}

// Vincula el issue con un hilo. Exige, en orden:
// 1. UUID bien formado;
// 2. permiso EDIT_ISSUES del usuario que llama sobre ese issue (mypermissions asUser);
// 3. token de la instalación configurado;
// 4. que el token pueda leer el hilo (pertenencia hilo<->buzón). Solo entonces escribe.
// deps: { fetchImpl, leerToken, requireEditIssue, guardarPropiedad }
export async function vincularHilo({ issueKey, hiloId }, deps) {
  if (!UUID_RE.test(hiloId || '')) throw new ErrorPanel('hilo_id no es un UUID');
  await deps.requireEditIssue(issueKey);
  const token = await deps.leerToken();
  if (!token) throw new ErrorPanel('falta configurar el token (página de administración)');
  await leerEnBuzon(deps.fetchImpl, token, { hilo_id: hiloId }); // lanza si no hay acceso
  await deps.guardarPropiedad(issueKey, PROP_ISSUE_HILO, hiloId);
  return { vinculado: true, hiloId };
}

// Desvincular también escribe en el issue: mismo requisito de EDIT_ISSUES.
// deps: { requireEditIssue, borrarPropiedad }
export async function desvincularHilo({ issueKey }, deps) {
  await deps.requireEditIssue(issueKey);
  await deps.borrarPropiedad(issueKey, PROP_ISSUE_HILO);
  return { vinculado: false };
}

// Definiciones que expone el resolver del panel. Las llaves de este objeto SON la superficie
// pública del panel: las pruebas verifican que no incluye operaciones de administración.
export function panelOps(deps) {
  return {
    hiloResumen: (req) => hiloResumen({ issueKey: req.context.extension.issue.key }, deps),
    vincularHilo: (req) => vincularHilo({ issueKey: req.context.extension.issue.key, ...req.payload }, deps),
    desvincularHilo: (req) => desvincularHilo({ issueKey: req.context.extension.issue.key }, deps),
  };
}
