// Pruebas del resolver de ADMINISTRACIÓN con dependencias simuladas (sin entorno Forge ni red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardarToken, probarToken, adminOps } from '../src/admin.js';
import { ErrorPanel } from '../src/comun.js';

const TOKEN = 'bz_' + 'x'.repeat(30);

function depsBase(sobre = {}) {
  let secreto = TOKEN;
  return {
    fetchImpl: async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ titulo: 'X', estado: 'abierto', mensajes: [] }) }] } }),
    }),
    leerToken: async () => secreto,
    guardarSecreto: async (k, v) => { secreto = v; },
    requireAdmin: async () => {},
    _getSecreto: () => secreto,
    _setSecreto: (v) => { secreto = v; },
    ...sobre,
  };
}

function sinAdmin() {
  return async () => { throw new ErrorPanel('site administrator role required'); };
}

test('guardarToken: sin rol admin se rechaza y NO escribe el secreto', async () => {
  const deps = depsBase({ requireAdmin: sinAdmin() });
  deps._setSecreto(null);
  await assert.rejects(() => guardarToken({ token: TOKEN }, deps), (e) => e instanceof ErrorPanel && /administrator/.test(e.message));
  assert.equal(deps._getSecreto(), null, 'no debe escribir el token sin rol admin');
});

test('guardarToken: con admin, formato inválido se rechaza sin escribir', async () => {
  const deps = depsBase();
  deps._setSecreto(null);
  await assert.rejects(() => guardarToken({ token: 'corto' }, deps), /format/);
  assert.equal(deps._getSecreto(), null);
});

test('guardarToken: con admin guarda y nunca devuelve el token', async () => {
  const deps = depsBase();
  const r = await guardarToken({ token: TOKEN }, deps);
  assert.deepEqual(r, { guardado: true });
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.equal(deps._getSecreto(), TOKEN);
});

test('guardarToken: el formato se valida DESPUÉS del rol (un no-admin no sondea el formato)', async () => {
  const deps = depsBase({ requireAdmin: sinAdmin() });
  await assert.rejects(() => guardarToken({ token: 'corto' }, deps), /administrator/);
});

test('probarToken: sin rol admin se rechaza', async () => {
  const deps = depsBase({ requireAdmin: sinAdmin() });
  await assert.rejects(() => probarToken({}, deps), /administrator/);
});

test('probarToken: éxito y fracaso sin exponer datos', async () => {
  const deps = depsBase();
  assert.deepEqual(await probarToken({}, deps), { ok: true });
  const depsMalo = depsBase({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) });
  const r = await probarToken({}, depsMalo);
  assert.equal(r.ok, false);
  assert.ok(/invalid or revoked token/.test(r.detalle));
  const depsSin = depsBase();
  depsSin._setSecreto(null);
  assert.deepEqual(await probarToken({}, depsSin), { ok: false, detalle: 'no token configured' });
});

test('aislamiento: el resolver de administración NO expone operaciones del panel', () => {
  const ops = adminOps(depsBase());
  assert.deepEqual(Object.keys(ops).sort(), ['guardarToken', 'probarToken']);
  assert.ok(!('hiloResumen' in ops), 'admin no debe exponer hiloResumen');
  assert.ok(!('vincularHilo' in ops), 'admin no debe exponer vincularHilo');
  assert.ok(!('desvincularHilo' in ops), 'admin no debe exponer desvincularHilo');
});
