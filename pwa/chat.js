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
