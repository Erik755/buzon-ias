// Pruebas del resolver del PANEL con dependencias simuladas (sin entorno Forge ni red).
// El vínculo vive en un almacenamiento tipo KVS (Map), no en propiedades del issue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiloResumen, vincularHilo, desvincularHilo, panelOps } from '../src/panel.js';
import { ErrorPanel, MCP_URL, PWA_URL } from '../src/comun.js';

const HILO = 'cccccccc-0000-0000-0000-000000000002';
const TOKEN = 'bz_' + 'x'.repeat(30);
const ISSUE = '10042'; // issue.id, no la key
const reqPanel = (payload = {}) => ({ context: { extension: { issue: { id: ISSUE } } }, payload });

// fetch simulado que responde un hilo con dos mensajes
function fetchOk(extra = {}) {
  const hilo = {
    titulo: 'Cierre con evidencia', estado: 'pide_aprobacion',
    mensajes: [
      { autor: 'Codex', creado_en: '2026-11-09T20:00:00Z', cuerpo: 'Listo el cambio.' },
      { autor: 'Instinct', creado_en: '2026-11-09T20:05:00Z', cuerpo: 'Revisado.' },
    ],
    ...extra,
  };
  return async (url, opts) => {
    assert.equal(url, MCP_URL);
    assert.equal(opts.headers.authorization, `Bearer ${TOKEN}`);
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(hilo) }] } }),
    };
  };
}

function fetchSinAcceso() {
  return async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ error: '404:hilo no encontrado' }) }] } }),
  });
}

function depsBase(sobre = {}) {
  const vinculos = new Map();
  let secreto = TOKEN;
  return {
    fetchImpl: fetchOk(),
    leerToken: async () => secreto,
    requireAdmin: async () => {},
    esAdmin: async () => true,
    leerVinculo: async (issueId) => vinculos.get(issueId) ?? null,
    guardarVinculo: async (issueId, hiloId) => { vinculos.set(issueId, hiloId); },
    borrarVinculo: async (issueId) => { vinculos.delete(issueId); },
    _vinculos: vinculos,
    _setSecreto: (v) => { secreto = v; },
    ...sobre,
  };
}

test('resumen: sin vínculo no llama al buzón e informa esAdmin', async () => {
  let llamadas = 0;
  const deps = depsBase({ fetchImpl: async () => { llamadas++; return fetchOk()(); }, esAdmin: async () => false });
  const r = await hiloResumen({ issueId: ISSUE }, deps);
  assert.equal(r.vinculado, false);
  assert.equal(r.esAdmin, false);
  assert.equal(llamadas, 0);
});

test('resumen: devuelve datos de solo lectura, enlace a la PWA y esAdmin', async () => {
  const deps = depsBase();
  await deps.guardarVinculo(ISSUE, HILO);
  const r = await hiloResumen({ issueId: ISSUE }, deps);
  assert.equal(r.vinculado, true);
  assert.equal(r.esAdmin, true);
  assert.equal(r.titulo, 'Cierre con evidencia');
  assert.equal(r.estado, 'pide_aprobacion');
  assert.equal(r.totalMensajes, 2);
  assert.equal(r.enlacePwa, `${PWA_URL}?hilo=${HILO}`);
  // Solo lectura: el resumen no incluye acciones de cierre
  assert.ok(!('acciones' in r) && !('decidir' in r));
});

test('resumen: vínculo almacenado que no es UUID se rechaza (defensa en profundidad)', async () => {
  const deps = depsBase();
  await deps.guardarVinculo(ISSUE, 'no-es-un-uuid');
  await assert.rejects(() => hiloResumen({ issueId: ISSUE }, deps), /vínculo corrupto/);
});

test('resumen: esAdmin sale false si la consulta de permisos falla (fail-closed)', async () => {
  const deps = depsBase({ esAdmin: async () => { throw new Error('jira caído'); } });
  await deps.guardarVinculo(ISSUE, HILO);
  const r = await hiloResumen({ issueId: ISSUE }, deps);
  assert.equal(r.vinculado, true);
  assert.equal(r.esAdmin, false);
});

test('resumen: hilo ajeno o token revocado => "sin acceso"', async () => {
  const deps = depsBase({ fetchImpl: fetchSinAcceso() });
  await deps.guardarVinculo(ISSUE, HILO);
  await assert.rejects(() => hiloResumen({ issueId: ISSUE }, deps), (e) => e instanceof ErrorPanel && /sin acceso/.test(e.message));
});

test('resumen: 401 del buzón => token inválido', async () => {
  const deps = depsBase({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) });
  await deps.guardarVinculo(ISSUE, HILO);
  await assert.rejects(() => hiloResumen({ issueId: ISSUE }, deps), /token inválido o revocado/);
});

test('resumen: sin token configurado pide la página de administración', async () => {
  const deps = depsBase();
  deps._setSecreto(null);
  await deps.guardarVinculo(ISSUE, HILO);
  await assert.rejects(() => hiloResumen({ issueId: ISSUE }, deps), /administración/);
});

test('vincular: UUID inválido se rechaza sin verificar rol ni llamar al buzón', async () => {
  let llamadas = 0, admins = 0;
  const deps = depsBase({
    fetchImpl: async () => { llamadas++; return fetchOk()(); },
    requireAdmin: async () => { admins++; },
  });
  await assert.rejects(() => vincularHilo({ issueId: ISSUE, hiloId: 'no-es-uuid' }, deps), /UUID/);
  assert.equal(llamadas, 0);
  assert.equal(admins, 0, 'no consulta el rol con un UUID inválido');
});

test('vincular: sin rol admin se rechaza antes de llamar al buzón y no guarda nada', async () => {
  let llamadas = 0;
  const deps = depsBase({
    fetchImpl: async () => { llamadas++; return fetchOk()(); },
    requireAdmin: async () => { throw new ErrorPanel('se requiere rol de administrador del sitio'); },
  });
  await assert.rejects(() => vincularHilo({ issueId: ISSUE, hiloId: HILO }, deps), (e) => e instanceof ErrorPanel && /administrador/.test(e.message));
  assert.equal(llamadas, 0, 'no debe consultar el buzón sin rol admin');
  assert.equal(await deps.leerVinculo(ISSUE), null, 'no debe guardar el vínculo');
});

test('vincular: con admin pero hilo ajeno no guarda (pertenencia hilo-buzón)', async () => {
  const deps = depsBase({ fetchImpl: fetchSinAcceso() });
  await assert.rejects(() => vincularHilo({ issueId: ISSUE, hiloId: HILO }, deps), /sin acceso/);
  assert.equal(await deps.leerVinculo(ISSUE), null, 'no debe guardar el vínculo sin acceso');
});

test('vincular: con admin y acceso guarda el vínculo por issue.id', async () => {
  const deps = depsBase();
  const r = await vincularHilo({ issueId: ISSUE, hiloId: HILO }, deps);
  assert.equal(r.vinculado, true);
  assert.equal(await deps.leerVinculo(ISSUE), HILO);
});

test('desvincular: sin rol admin se rechaza y el vínculo queda intacto', async () => {
  const deps = depsBase({
    requireAdmin: async () => { throw new ErrorPanel('se requiere rol de administrador del sitio'); },
  });
  await deps.guardarVinculo(ISSUE, HILO);
  await assert.rejects(() => desvincularHilo({ issueId: ISSUE }, deps), /administrador/);
  assert.equal(await deps.leerVinculo(ISSUE), HILO);
});

test('desvincular: con admin borra el vínculo', async () => {
  const deps = depsBase();
  await deps.guardarVinculo(ISSUE, HILO);
  const r = await desvincularHilo({ issueId: ISSUE }, deps);
  assert.equal(r.vinculado, false);
  assert.equal(await deps.leerVinculo(ISSUE), null);
});

test('aislamiento: el resolver del panel NO expone operaciones de administración', () => {
  const ops = panelOps(depsBase());
  assert.deepEqual(Object.keys(ops).sort(), ['desvincularHilo', 'hiloResumen', 'vincularHilo']);
  assert.ok(!('guardarToken' in ops), 'el panel no debe exponer guardarToken');
  assert.ok(!('probarToken' in ops), 'el panel no debe exponer probarToken');
});

test('panelOps: toma el issue.id (no la key) del contexto del issue panel', async () => {
  const deps = depsBase();
  await deps.guardarVinculo(ISSUE, HILO);
  const r = await panelOps(deps).hiloResumen(reqPanel());
  assert.equal(r.vinculado, true);
});
