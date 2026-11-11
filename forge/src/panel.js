// Lógica del resolver del PANEL, con dependencias inyectadas para probar sin entorno Forge.
// Este módulo NO conoce guardarToken ni probarToken: esas operaciones viven en admin.js y el
// resolver del panel nunca las expone (separación exigida en la revisión de Grok).
//
// El vínculo issue<->hilo vive en Forge KVS (clave hilo:<issue.id>), NO en una propiedad del
// issue: las propiedades las puede escribir cualquier usuario con EDIT_ISSUES por REST,
// saltándose las validaciones, y las puede leer cualquiera con BROWSE. Solo la app escribe KVS.
// Se usa issue.id (estable al mover el issue entre proyectos), no la key.
import { leerEnBuzon, ErrorPanel, PWA_URL, UUID_RE } from './comun.js';

// Resumen de solo lectura para el panel. Incluye esAdmin para que el front oculte las
// acciones de vincular/desvincular a quien no es admin (la verificación real es del servidor).
// deps: { fetchImpl, leerToken, leerVinculo, esAdmin }
export async function hiloResumen({ issueId }, deps) {
  const esAdmin = await deps.esAdmin().catch(() => false);
  const hiloId = await deps.leerVinculo(issueId);
  if (!hiloId) return { vinculado: false, esAdmin };
  if (!UUID_RE.test(hiloId)) throw new ErrorPanel('vínculo corrupto en el almacenamiento');
  const token = await deps.leerToken();
  if (!token) throw new ErrorPanel('falta configurar el token (página de administración)');
  const h = await leerEnBuzon(deps.fetchImpl, token, { hilo_id: hiloId });
  const mensajes = h.mensajes || [];
  return {
    vinculado: true,
    esAdmin,
    hiloId,
    titulo: h.titulo || '(sin título)',
    estado: h.estado || 'desconocido',
    totalMensajes: mensajes.length,
    ultimos: mensajes.slice(-5).map((m) => ({ autor: m.autor, creado_en: m.creado_en, cuerpo: (m.cuerpo || '').slice(0, 280) })),
    enlacePwa: `${PWA_URL}?hilo=${hiloId}`,
  };
}

// Vincula el issue con un hilo. Solo administradores del sitio (rev4: un editor podría
// exponer cualquier hilo del buzón a todo el que pueda ver el issue). Exige, en orden:
// 1. UUID bien formado; 2. rol admin; 3. token configurado;
// 4. que el token pueda leer el hilo (pertenencia hilo<->buzón). Solo entonces escribe.
// deps: { fetchImpl, leerToken, requireAdmin, guardarVinculo }
export async function vincularHilo({ issueId, hiloId }, deps) {
  if (!UUID_RE.test(hiloId || '')) throw new ErrorPanel('hilo_id no es un UUID');
  await deps.requireAdmin();
  const token = await deps.leerToken();
  if (!token) throw new ErrorPanel('falta configurar el token (página de administración)');
  await leerEnBuzon(deps.fetchImpl, token, { hilo_id: hiloId }); // lanza si no hay acceso
  await deps.guardarVinculo(issueId, hiloId);
  return { vinculado: true, hiloId };
}

// Desvincular también es administración del vínculo: mismo requisito de rol admin.
// deps: { requireAdmin, borrarVinculo }
export async function desvincularHilo({ issueId }, deps) {
  await deps.requireAdmin();
  await deps.borrarVinculo(issueId);
  return { vinculado: false };
}

// Definiciones que expone el resolver del panel. Las llaves de este objeto SON la superficie
// pública del panel: las pruebas verifican que no incluye operaciones de administración.
export function panelOps(deps) {
  return {
    hiloResumen: (req) => hiloResumen({ issueId: req.context.extension.issue.id }, deps),
    vincularHilo: (req) => vincularHilo({ issueId: req.context.extension.issue.id, ...req.payload }, deps),
    desvincularHilo: (req) => desvincularHilo({ issueId: req.context.extension.issue.id }, deps),
  };
}
