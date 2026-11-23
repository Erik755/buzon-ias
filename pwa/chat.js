// Lógica del Chat de la PWA: enviar, fusionar mensajes y decidir cuándo sondear.
// Se prueba en mcp/test/chat.test.js. Sin acceso a la red ni a Supabase.

export const INTERVALO_SONDEO_MS = 5000;

// Une dos listas de mensajes por id (ganan los más recientes) y las ordena por fecha.
export function fusionarMensajes(actuales, entrantes) {
  const mapa = new Map();
  for (const m of [...(actuales ?? []), ...(entrantes ?? [])]) {
    if (m && m.id != null) mapa.set(String(m.id), m);
  }
  return [...mapa.values()].sort((a, b) => {
    const ta = new Date(a.creado_en).getTime();
    const tb = new Date(b.creado_en).getTime();
    if (ta !== tb) return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    return String(a.id).localeCompare(String(b.id));
  });
}

export function idsMensajes(lista) {
  return (lista ?? []).map((m) => String(m.id)).join(',');
}

// Firma estable de una lista (hilos o mensajes) para no redibujar si no hubo cambio.
export function firmaLista(items, campos = ['id']) {
  return (items ?? []).map((x) => campos.map((c) => String(x?.[c] ?? '')).join(':')).join('|');
}

// El sondeo solo corre con la pestaña visible y un hilo de chat abierto.
export function debeEncuestar({ oculto, vista, hilo }) {
  return !oculto && vista === 'chat' && !!hilo;
}

export function debeEncuestarLista({ oculto, vista }) {
  return !oculto && (vista === 'pendientes' || vista === 'todos');
}

// Envía el texto. Limpia solo si el servidor aceptó el alta (alExito).
// Si falla, el texto se queda y se avisa (alError). Si el botón ya está ocupado, no vuelve a enviar.
// Misma idea que mencion_norm en la base: minúsculas, sin tildes ni signos.
export function normMencion(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Token de una sola pieza para insertar tras @ (el servidor ignora espacios y tildes).
export function tokenMencion(nombre) {
  return String(nombre ?? '').normalize('NFKC').replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ_-]+/g, '').slice(0, 40);
}

// Si el cursor está escribiendo una @mencion (inicio o tras espacio, no un correo).
export function consultaMencion(texto, cursor) {
  const src = String(texto ?? '');
  const pos = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : src.length, src.length));
  const m = /(?:^|[\s\u00A0])@([A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ][0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ_-]{0,39})?$/.exec(src.slice(0, pos));
  if (!m) return null;
  const consulta = m[1] || '';
  return { inicio: pos - consulta.length - 1, consulta };
}

export function sugerenciasMencion(filas, consulta, limite = 8) {
  const q = normMencion(consulta);
  const vistos = new Set();
  const lista = [];
  for (const f of filas ?? []) {
    const etiqueta = String(f?.etiqueta || f?.nombre || '').trim();
    const nombre = String(f?.nombre || etiqueta).trim();
    const id = f?.id;
    if (!id || !etiqueta) continue;
    const nEt = normMencion(etiqueta);
    const nNom = normMencion(nombre);
    if (!nEt || nEt.length < 2) continue;
    if (q && !nEt.startsWith(q) && !nNom.startsWith(q) && !nEt.includes(q) && !nNom.includes(q)) continue;
    const key = `${id}:${nEt}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    lista.push({ id, nombre, etiqueta, token: tokenMencion(etiqueta), pref: !q || nEt.startsWith(q) || nNom.startsWith(q) });
  }
  lista.sort((a, b) => (a.pref === b.pref ? a.nombre.localeCompare(b.nombre, 'es') || a.etiqueta.localeCompare(b.etiqueta, 'es') : (a.pref ? -1 : 1)));
  return lista.slice(0, limite).map(({ pref, ...r }) => r);
}

export function aplicarMencion(texto, inicio, etiqueta) {
  const src = String(texto ?? '');
  const tok = tokenMencion(etiqueta);
  if (!tok || inicio < 0 || inicio > src.length) return { texto: src, cursor: Math.max(0, Math.min(inicio, src.length)) };
  const antes = src.slice(0, inicio);
  const resto = src.slice(inicio).replace(/^@[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ_-]{0,40}/, '');
  const pieza = `@${tok} `;
  return { texto: antes + pieza + resto.replace(/^ /, ''), cursor: (antes + pieza).length };
}

// avisado | descartado | pendiente | ambigua | desconocida | excedida | sin_aviso
export function claseMencion(m) {
  if (!m) return null;
  if (m.entrega === 'avisado') return 'avisado';
  if (m.entrega === 'descartado') return 'descartado';
  if (m.estado === 'notificada') return 'pendiente';
  if (m.estado === 'ambigua') return 'ambigua';
  if (m.estado === 'desconocida') return 'desconocida';
  if (m.estado === 'excedida') return 'excedida';
  if (['autor', 'sin_webhook', 'limitada', 'bucle', 'rafaga'].includes(m.estado)) return 'sin_aviso';
  return null;
}

export function firmaMenciones(lista) {
  return (lista ?? []).map((m) => [m.mensaje_id ?? '', m.token ?? '', m.estado ?? '', m.entrega ?? ''].join(':')).join('|');
}

export async function enviarMensajeChat({ cuerpo, insertar, alExito, alError, conBotones, boton }) {
  const texto = String(cuerpo ?? '').trim();
  if (!texto) return { enviado: false };
  const resultado = await conBotones([boton], async () => {
    const res = (await insertar(texto)) ?? {};
    if (res.error) {
      if (alError) alError(res.error);
      return { enviado: false, error: res.error };
    }
    if (alExito) await alExito(res.data);
    return { enviado: true, data: res.data };
  });
  return resultado ?? { enviado: false };
}
