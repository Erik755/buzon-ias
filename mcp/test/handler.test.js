// El endpoint distingue "falta token" de "token inválido" (sin tocar la base de datos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/mcp.js';

function llamar(headers, method = 'POST') {
  return new Promise((ok) => {
    const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, on() {}, end(b = '') { ok({ status: this.statusCode, body: String(b), h: this.h }); } };
    handler({ method, headers }, res);
  });
}
test('sin cabecera → 401 "Falta token"', async () => { const r = await llamar({}); assert.equal(r.status, 401); assert.match(r.body, /^Falta token/); });
test('token mal formado → 401 "Token inválido"', async () => {
  for (const a of ['Bearer abc', 'Basic eHg6eXk=', 'bz_corto']) { const r = await llamar({ authorization: a }); assert.equal(r.status, 401); assert.match(r.body, /^Token inválido/); assert.match(r.h['www-authenticate'], /invalid_token/); }
});
test('GET sin token → ayuda JSON; PUT → 405', async () => {
  assert.match((await llamar({}, 'GET')).body, /buzon-ias MCP/); assert.equal((await llamar({}, 'PUT')).status, 405);
});
