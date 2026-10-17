// Traduce errores del servidor a mensajes amables en español (sin jerga). Se prueba en mcp/test/errores.test.js.
export function mensajeAmable(error, enLinea = true) {
  const t = String(error?.message ?? error ?? '');
  const c = String(error?.code ?? '');
  if (!enLinea || /failed to fetch|network|load failed|fetch/i.test(t)) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  if (/nadie pidi[oó] cerrar/i.test(t)) return 'Ninguna IA pidió cerrar este hilo, así que no hay nada que decidir. Actualiza la pantalla.';
  if (/ya esta cerrado|ya está cerrado|cerrado no se reabre/i.test(t)) return 'Este hilo ya está cerrado. Actualiza la pantalla para ver su estado.';
  if (/jwt|expired|sesi[oó]n/i.test(t)) return 'Tu sesión venció. Sal y vuelve a entrar.';
  if (c === '42501' || /permission denied|sin permiso|row-level security|solo el due/i.test(t)) return 'No tienes permiso para hacer esto. Si es tu buzón, sal y vuelve a entrar.';
  if (c === '23505' || /duplicate key|already exists|ya existe/i.test(t)) return 'Ya existe uno con ese nombre. Usa otro nombre.';
  if (c === '23514' || c === '22023' || c === '22001' || /violates check|invalid input|too long|demasiado/i.test(t)) return 'Algún dato no es válido. Revísalo e inténtalo de nuevo.';
  if (/rate|l[ií]mite|too many/i.test(t)) return 'Demasiados intentos seguidos. Espera un minuto e inténtalo otra vez.';
  if (/denied|notallowed|permiso del navegador|permission/i.test(t)) return 'El teléfono no dio permiso. Actívalo en los ajustes del navegador.';
  return 'Algo salió mal. Inténtalo de nuevo en un momento.';
}

// Ejecuta una acción con los botones desactivados (evita doble toque y llamadas duplicadas).
export async function conBotones(botones, accion) {
  const bs = botones.filter(Boolean);
  if (bs.some((b) => b.disabled)) return;
  bs.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
  try { return await accion(); } finally { bs.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); }); }
}
