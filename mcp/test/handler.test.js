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
  const g = await llamar({ host: 'buzon-ias-mcp.vercel.app' }, 'GET'); assert.equal(JSON.parse(g.body).mcp_url, 'https://buzon-ias-mcp.vercel.app/api/mcp'); assert.ok(!/bz_[0-9a-f]{20}/.test(g.body)); assert.match((await llamar({ accept: 'text/plain' }, 'GET')).body, /Instrucciones para IAs/); assert.equal((await llamar({}, 'PUT')).status, 405);
});
