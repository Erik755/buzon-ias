// Cliente MCP del Buzón y constantes compartidas entre el panel y la administración.
// Seguridad:
// - El token bz_ vive en KVS secrets (kvs.setSecret), por instalación; nunca sale al front.
// - Antes de mostrar nada se llama `leer` con ese token: si el hilo no pertenece al buzón del
//   token (o el token está revocado), el MCP responde error y el panel muestra "sin acceso".
//   Esa llamada ES la validación hilo<->buzón (Grok, review FASE 2).
// - El panel nunca escribe en el buzón: no hay acciones de cierre aquí; el enlace abre la PWA
//   del dueño, donde decide con su propia sesión.

export const MCP_URL = 'https://buzon-ias-mcp.vercel.app/api/mcp';
export const PWA_URL = 'https://buzon-ias-pwa.vercel.app/';
export const KVS_TOKEN = 'buzon_token';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^bz_[A-Za-z0-9_-]{20,}$/;
export { UUID_RE, TOKEN_RE };

export class ErrorPanel extends Error {}

// Llama tools/call `leer` del MCP con el token de la instalación.
export async function leerEnBuzon(fetchImpl, token, args) {
  let resp;
  try {
    resp = await fetchImpl(MCP_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leer', arguments: args } }),
    });
  } catch (e) {
    throw new ErrorPanel('red: no se pudo contactar el buzón');
  }
  if (resp.status === 401 || resp.status === 403) throw new ErrorPanel('token inválido o revocado');
  if (!resp.ok) throw new ErrorPanel(`buzón: HTTP ${resp.status}`);
  const crudo = await resp.text();
  let data;
  try {
    data = JSON.parse(crudo);
  } catch {
    // Respuesta SSE: tomar el último "data: {...}".
    const lineas = crudo.split('\n').filter((l) => l.startsWith('data: '));
    if (!lineas.length) throw new ErrorPanel('buzón: respuesta ilegible');
    try {
      data = JSON.parse(lineas[lineas.length - 1].slice(6));
    } catch {
      throw new ErrorPanel('buzón: respuesta ilegible');
    }
  }
  if (data.error) throw new ErrorPanel('sin acceso al hilo con este token');
  let contenido;
  try {
    contenido = JSON.parse(data.result.content[0].text);
  } catch {
    throw new ErrorPanel('sin acceso al hilo con este token');
  }
  if (contenido.error) throw new ErrorPanel('sin acceso al hilo con este token');
  return contenido;
}
