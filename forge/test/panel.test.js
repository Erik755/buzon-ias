// Pruebas del resolver del PANEL con dependencias simuladas (sin entorno Forge ni red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiloResumen, vincularHilo, desvincularHilo, panelOps } from '../src/panel.js';
import { ErrorPanel, MCP_URL, PWA_URL, PROP_ISSUE_HILO } from '../src/comun.js';

const HILO = 'cccccccc-0000-0000-0000-000000000002';
const TOKEN = 'bz_' + 'x'.repeat(30);
const reqPanel = (payload = {}) => ({ context: { extension: { issue: { key: 'ABC-1' } } }, payload });

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
  const props = new Map();
  let secreto = TOKEN;
  return {
    fetchImpl: fetchOk(),
    leerToken: async () => secreto,
    requireEditIssue: async () => {},
    leerPropiedad: async (issue, prop) => props.get(`${issue}/${prop}`) ?? null,
    guardarPropiedad: async (issue, prop, v) => { props.set(`${issue}/${prop}`, v); },
    borrarPropiedad: async (issue, prop) => { props.delete(`${issue}/${prop}`); },
    _props: props,
    _setSecreto: (v) => { secreto = v; },
    ...sobre,
  };
}

test('resumen: sin vínculo no llama al buzón', async () => {
  let llamadas = 0;
  const deps = depsBase({ fetchImpl: async () => { llamadas++; return fetchOk()(); } });
  const r = await hiloResumen({ issueKey: 'ABC-1' }, deps);
  assert.equal(r.vinculado, false);
  assert.equal(llamadas, 0);
});

test('resumen: devuelve datos de solo lectura y enlace a la PWA', async () => {
  const deps = depsBase();
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  const r = await hiloResumen({ issueKey: 'ABC-1' }, deps);
  assert.equal(r.vinculado, true);
  assert.equal(r.titulo, 'Cierre con evidencia');
  assert.equal(r.estado, 'pide_aprobacion');
  assert.equal(r.totalMensajes, 2);
  assert.equal(r.enlacePwa, `${PWA_URL}?hilo=${HILO}`);
  // Solo lectura: el resumen no incluye acciones de cierre
  assert.ok(!('acciones' in r) && !('decidir' in r));
});

test('resumen: hilo ajeno o token revocado => "sin acceso"', async () => {
  const deps = depsBase({ fetchImpl: fetchSinAcceso() });
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  await assert.rejects(() => hiloResumen({ issueKey: 'ABC-1' }, deps), (e) => e instanceof ErrorPanel && /sin acceso/.test(e.message));
});

test('resumen: 401 del buzón => token inválido', async () => {
  const deps = depsBase({ fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) });
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  await assert.rejects(() => hiloResumen({ issueKey: 'ABC-1' }, deps), /token inválido o revocado/);
});

test('resumen: sin token configurado pide la página de administración', async () => {
  const deps = depsBase();
  deps._setSecreto(null);
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  await assert.rejects(() => hiloResumen({ issueKey: 'ABC-1' }, deps), /administración/);
});

test('vincular: UUID inválido se rechaza sin permisos ni buzón', async () => {
  let llamadas = 0, permisos = 0;
  const deps = depsBase({
    fetchImpl: async () => { llamadas++; return fetchOk()(); },
    requireEditIssue: async () => { permisos++; },
  });
  await assert.rejects(() => vincularHilo({ issueKey: 'ABC-1', hiloId: 'no-es-uuid' }, deps), /UUID/);
  assert.equal(llamadas, 0);
  assert.equal(permisos, 0, 'no consulta permisos con un UUID inválido');
});

test('vincular: sin EDIT_ISSUES se rechaza antes de llamar al buzón y no guarda nada', async () => {
  let llamadas = 0;
  const deps = depsBase({
    fetchImpl: async () => { llamadas++; return fetchOk()(); },
    requireEditIssue: async () => { throw new ErrorPanel('se requiere el permiso EDIT_ISSUES en este issue'); },
  });
  await assert.rejects(() => vincularHilo({ issueKey: 'ABC-1', hiloId: HILO }, deps), (e) => e instanceof ErrorPanel && /EDIT_ISSUES/.test(e.message));
  assert.equal(llamadas, 0, 'no debe consultar el buzón sin permiso de edición');
  assert.equal(await deps.leerPropiedad('ABC-1', PROP_ISSUE_HILO), null, 'no debe guardar el vínculo');
});

test('vincular: con EDIT_ISSUES pero hilo ajeno no guarda (pertenencia hilo-buzón)', async () => {
  const deps = depsBase({ fetchImpl: fetchSinAcceso() });
  await assert.rejects(() => vincularHilo({ issueKey: 'ABC-1', hiloId: HILO }, deps), /sin acceso/);
  assert.equal(await deps.leerPropiedad('ABC-1', PROP_ISSUE_HILO), null, 'no debe guardar el vínculo sin acceso');
});

test('vincular: con permiso y acceso guarda la propiedad', async () => {
  const deps = depsBase();
  const r = await vincularHilo({ issueKey: 'ABC-1', hiloId: HILO }, deps);
  assert.equal(r.vinculado, true);
  assert.equal(await deps.leerPropiedad('ABC-1', PROP_ISSUE_HILO), HILO);
});

test('desvincular: sin EDIT_ISSUES se rechaza y la propiedad queda intacta', async () => {
  const deps = depsBase({
    requireEditIssue: async () => { throw new ErrorPanel('se requiere el permiso EDIT_ISSUES en este issue'); },
  });
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  await assert.rejects(() => desvincularHilo({ issueKey: 'ABC-1' }, deps), /EDIT_ISSUES/);
  assert.equal(await deps.leerPropiedad('ABC-1', PROP_ISSUE_HILO), HILO);
});

test('desvincular: con EDIT_ISSUES borra la propiedad', async () => {
  const deps = depsBase();
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  const r = await desvincularHilo({ issueKey: 'ABC-1' }, deps);
  assert.equal(r.vinculado, false);
  assert.equal(await deps.leerPropiedad('ABC-1', PROP_ISSUE_HILO), null);
});

test('aislamiento: el resolver del panel NO expone operaciones de administración', () => {
  const ops = panelOps(depsBase());
  assert.deepEqual(Object.keys(ops).sort(), ['desvincularHilo', 'hiloResumen', 'vincularHilo']);
  assert.ok(!('guardarToken' in ops), 'el panel no debe exponer guardarToken');
  assert.ok(!('probarToken' in ops), 'el panel no debe exponer probarToken');
});

test('panelOps: toma el issueKey del contexto del issue panel', async () => {
  const deps = depsBase();
  await deps.guardarPropiedad('ABC-1', PROP_ISSUE_HILO, HILO);
  const r = await panelOps(deps).hiloResumen(reqPanel());
  assert.equal(r.vinculado, true);
});
