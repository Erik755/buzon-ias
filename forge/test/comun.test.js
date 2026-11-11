// Pruebas del cliente MCP compartido (sin entorno Forge ni red: fetch simulado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerEnBuzon, ErrorPanel, MCP_URL } from '../src/comun.js';

const TOKEN = 'bz_' + 'x'.repeat(30);

function respJson(cuerpoInterno, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(cuerpoInterno) }] } }),
  };
}

test('leerEnBuzon: respuesta JSON plana', async () => {
  const hilo = { titulo: 'X', estado: 'abierto', mensajes: [] };
  const fetchImpl = async (url, opts) => {
    assert.equal(url, MCP_URL);
    assert.equal(opts.headers.authorization, `Bearer ${TOKEN}`);
    return respJson(hilo);
  };
  const r = await leerEnBuzon(fetchImpl, TOKEN, { hilo_id: 'c' });
  assert.equal(r.titulo, 'X');
});

test('leerEnBuzon: respuesta SSE se interpreta', async () => {
  const hilo = { titulo: 'X', estado: 'abierto', mensajes: [] };
  const fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(hilo) }] } }) + '\n',
  });
  const r = await leerEnBuzon(fetchImpl, TOKEN, { limite: 1 });
  assert.equal(r.titulo, 'X');
});

test('leerEnBuzon: 401/403 => token inválido o revocado', async () => {
  for (const status of [401, 403]) {
    const fetchImpl = async () => ({ ok: false, status, text: async () => '' });
    await assert.rejects(() => leerEnBuzon(fetchImpl, TOKEN, {}), (e) => e instanceof ErrorPanel && /token inválido o revocado/.test(e.message));
  }
});

test('leerEnBuzon: error del buzón => "sin acceso"', async () => {
  const fetchImpl = async () => respJson({ error: '404:hilo no encontrado' });
  await assert.rejects(() => leerEnBuzon(fetchImpl, TOKEN, {}), /sin acceso/);
});

test('leerEnBuzon: red caída => error de red, sin filtrar detalles internos', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED interno'); };
  await assert.rejects(() => leerEnBuzon(fetchImpl, TOKEN, {}), (e) => e instanceof ErrorPanel && e.message === 'red: no se pudo contactar el buzón');
});

test('leerEnBuzon: HTTP 500 => error con código', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' });
  await assert.rejects(() => leerEnBuzon(fetchImpl, TOKEN, {}), /HTTP 500/);
});
