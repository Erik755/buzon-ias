import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIAS } from '../../pwa/guias.js';
import { GUIAS_EN } from '../../pwa/guias-i18n.js';
import { buscarGuias, puntuacionGuia, normalizar, rellenarPlantilla, enmascararToken, SUGERENCIAS, ALIAS } from '../../pwa/conectar.js';
import { filtrarHilos, inicialDe, hiloCerrado } from '../../pwa/layout.js';

test('búsqueda vacía no lista todas las guías, solo sugerencias', () => {
  const r = buscarGuias('', GUIAS);
  assert.equal(r.vacio, true);
  assert.deepEqual(r.resultados, []);
  assert.ok(r.sugerencias.length >= 4);
  assert.ok(r.sugerencias.length < GUIAS.length, 'no es el muro de texto completo');
  for (const id of ['cursor', 'claude-code', 'chatgpt']) {
    assert.ok(r.sugerencias.some((g) => g.id === id), id);
  }
});

test('coincidencia parcial y difusa devuelve el agente y no un muro', () => {
  const cursor = buscarGuias('curs', GUIAS);
  assert.equal(cursor.vacio, false);
  assert.equal(cursor.resultados[0].id, 'cursor');
  const claude = buscarGuias('claude', GUIAS);
  assert.ok(claude.resultados.every((g) => g.id.startsWith('claude') || /claude/i.test(g.nombre)));
  assert.ok(claude.resultados.length < GUIAS.length);
  const gem = buscarGuias('gemini', GUIAS);
  assert.equal(gem.resultados[0].id, 'gemini-cli');
  const anti = buscarGuias('antigrav', GUIAS);
  assert.equal(anti.resultados[0].id, 'antigravity');
  const gpt = buscarGuias('chat gpt', GUIAS);
  assert.ok(gpt.resultados.some((g) => g.id === 'chatgpt'));
  // Acento y mayúsculas
  assert.ok(buscarGuias('CÓDEX', GUIAS).resultados.some((g) => g.id === 'codex' || g.id === 'nl-codex'));
});

test('Perplexity no está: el servidor no lo documenta', () => {
  assert.ok(!GUIAS.some((g) => /perplexity/i.test(g.id + g.nombre)));
  const r = buscarGuias('perplexity', GUIAS);
  assert.equal(r.resultados.length, 0);
});

test('hay guía genérica MCP y ChatGPT explica que aún no se puede', () => {
  const gen = GUIAS.find((g) => g.id === 'mcp-generico');
  assert.ok(gen);
  assert.match(gen.codigo, /Authorization: Bearer \{TOKEN\}/);
  assert.match(gen.codigo, /\{URL\}/);
  const r = buscarGuias('cliente mcp', GUIAS);
  assert.equal(r.resultados[0].id, 'mcp-generico');
  const gpt = GUIAS.find((g) => g.id === 'chatgpt');
  assert.equal(gpt.estado, 'no');
  assert.match(gpt.pasos.join(' '), /Codex/);
});

test('todas las guías tienen traducción inglesa y Instinct no incluye \{TOKEN\}', () => {
  for (const g of GUIAS) {
    assert.ok(GUIAS_EN[g.id], g.id);
    assert.ok(GUIAS_EN[g.id].nombre);
    assert.ok(Array.isArray(GUIAS_EN[g.id].pasos));
  }
  assert.ok(!JSON.stringify(GUIAS_EN.instinct).includes('{TOKEN}'));
  assert.ok(!JSON.stringify(GUIAS.find((g) => g.id === 'instinct')).includes('{TOKEN}'));
});

test('la plantilla rellena la URL del usuario y enmascara un token real', () => {
  // Cadena ficticia, no es un token del servicio (evita un falso positivo de gitleaks).
  const tok = 'CLAVE_DE_PRUEBA_NO_SECRETA';
  const out = rellenarPlantilla('url={URL} tok={TOKEN}', { url: 'https://ejemplo.test/api/mcp', token: tok });
  assert.equal(out, 'url=https://ejemplo.test/api/mcp tok=' + tok);
  assert.equal(enmascararToken(out, tok), 'url=https://ejemplo.test/api/mcp tok=' + tok.slice(0, 3) + '••••••••');
  assert.ok(!enmascararToken(out, tok).includes('DE_PRUEBA'));
});

test('filtrar hilos por texto y Por aprobar; inicial y cerrado', () => {
  const hs = [
    { id: 1, titulo: 'Chat', estado: 'abierto', contexto: '' },
    { id: 2, titulo: 'Revisar README', estado: 'pide_aprobacion', contexto: 'por favor' },
    { id: 3, titulo: 'Cierre', estado: 'pide_cierre', contexto: '' },
    { id: 4, titulo: 'Viejo', estado: 'cerrado', contexto: '' },
  ];
  assert.deepEqual(filtrarHilos(hs, { filtro: 'pendientes' }).map((h) => h.id), [2, 3]);
  assert.deepEqual(filtrarHilos(hs, { q: 'readme' }).map((h) => h.id), [2]);
  assert.equal(inicialDe('claude'), 'C');
  assert.equal(inicialDe('  '), '?');
  assert.equal(hiloCerrado('cerrado'), true);
  assert.equal(hiloCerrado('abierto'), false);
  assert.equal(hiloCerrado('aprobado'), true);
});

test('alias conocidos y puntuación: "cursor" gana sobre coincidencias flojas', () => {
  assert.ok((ALIAS.cursor || []).includes('cursor'));
  const sCursor = puntuacionGuia('cursor', GUIAS.find((g) => g.id === 'cursor'));
  const sClaude = puntuacionGuia('cursor', GUIAS.find((g) => g.id === 'claude-code'));
  assert.ok(sCursor > sClaude);
  assert.ok(puntuacionGuia('', GUIAS[0]) === 0);
  assert.equal(normalizar('CÓDEX'), 'codex');
});

test('la PWA no trae un token real en estáticos; el SW precarga los módulos nuevos', () => {
  const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../../pwa/sw.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../pwa/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /bz_[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(html, /bz_[A-Za-z0-9_-]{20,}/);
  assert.match(app, /type = 'password'/);
  assert.match(app, /secreto\.revelar/);
  assert.match(app, /probarConexion/);
  assert.match(sw, /buzon-v23-rediseno/);
  assert.match(sw, /'i18n\.js'/);
  assert.match(sw, /'conectar\.js'/);
  assert.match(sw, /'avisos\.js'/);
  assert.match(sw, /'chat\.js'/);
  assert.match(html, /data-idioma="es"/);
  assert.match(html, /data-idioma="en"/);
  assert.match(html, /lang="es"/);
  assert.match(app, /conectar-pregunta/);
  assert.match(app, /conectar\.pregunta/);
});

test('Labelbox Recursion está en las guías y se encuentra al buscar', () => {
  const g = GUIAS.find((x) => x.id === 'labelbox-recursion');
  assert.ok(g);
  assert.equal(g.estado, 'directo');
  assert.equal(g.codigo, '{URL}');
  assert.ok(!JSON.stringify(g).includes('bz_') || g.codigo === '{URL}');
  assert.match(g.pasos.join(' '), /Add custom MCP server/);
  assert.match(g.pasos.join(' '), /bearer_token/);
  assert.match(g.pasos.join(' '), /defaultVaultIds/);
  assert.match(g.pasos.join(' '), /probe|Test/);
  assert.match(g.pasos.join(' '), /__leer/);
  assert.match(g.nota, /Authorization: Bearer/);
  assert.match(g.nota, /Streamable HTTP/);
  const en = GUIAS_EN['labelbox-recursion'];
  assert.ok(en);
  assert.match(en.pasos.join(' '), /Add custom MCP server/);
  assert.match(en.pasos.join(' '), /bearer_token/);
  const r = buscarGuias('labelbox', GUIAS);
  assert.equal(r.resultados[0].id, 'labelbox-recursion');
  assert.equal(buscarGuias('recursion', GUIAS).resultados[0].id, 'labelbox-recursion');
  assert.equal(buscarGuias('managed agents', GUIAS).resultados[0].id, 'labelbox-recursion');
  // Ningún token real en la guía
  assert.doesNotMatch(JSON.stringify(g) + JSON.stringify(en), /bz_[A-Za-z0-9_-]{8,}/);
});
