// Selector de destinatario: lista base, agente recién conectado, sin duplicados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENTES_BASE, listaDestinatarios, idAgentePorNombre,
  claveNombre, mismaClave, nombresDeHilos,
} from '../../pwa/destinatarios.js';

const pwa = (f) => readFileSync(new URL('../../pwa/' + f, import.meta.url), 'utf8');

test('la lista base trae los agentes comunes pedidos', () => {
  const pedidos = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Copilot', 'Cursor', 'Perplexity', 'Labelbox Recursion', 'Instinct'];
  assert.deepEqual(AGENTES_BASE, pedidos);
  const lista = listaDestinatarios({});
  assert.deepEqual(lista.map((x) => x.nombre).sort(), [...pedidos].sort());
  assert.equal(lista.length, pedidos.length);
  assert.ok(lista.every((x) => !x.conectado && x.fuente === 'base'));
});

test('un agente recién conectado aparece y va primero', () => {
  const antes = listaDestinatarios({ agentes: [], remitentes: [] });
  assert.equal(antes.filter((x) => claveNombre(x.nombre) === 'novabot').length, 0);

  const despues = listaDestinatarios({
    agentes: [{ id: 'aaaaaaaa-0000-0000-0000-000000000099', nombre: 'NovaBot' }],
    remitentes: [],
  });
  const novas = despues.filter((x) => claveNombre(x.nombre) === 'novabot');
  assert.equal(novas.length, 1);
  assert.equal(novas[0].conectado, true);
  assert.equal(novas[0].nombre, 'NovaBot');
  assert.equal(novas[0].id, 'aaaaaaaa-0000-0000-0000-000000000099');
  assert.equal(despues[0].nombre, 'NovaBot', 'los conectados van primero');
  assert.ok(despues[0].conectado);
  assert.ok(despues.some((x) => x.nombre === 'Claude' && !x.conectado));
});

test('sin duplicados: normaliza mayúsculas y espacios, y prefiere el nombre guardado', () => {
  const lista = listaDestinatarios({
    agentes: [{ id: '1', nombre: '  CLAUDE ' }],
    remitentes: ['Claude', 'claude', ' CLAUDE'],
  });
  const claudes = lista.filter((x) => mismaClave(x.nombre, 'Claude'));
  assert.equal(claudes.length, 1);
  assert.equal(claudes[0].conectado, true);
  assert.equal(claudes[0].nombre, 'CLAUDE');
  assert.equal(claudes[0].id, '1');
});

test('un alias de un agente base (Copilot / VS Code) no se duplica', () => {
  const lista = listaDestinatarios({
    agentes: [{ id: 'c', nombre: 'VS Code con Copilot' }],
  });
  const cops = lista.filter((x) => mismaClave(x.nombre, 'Copilot') || mismaClave(x.nombre, 'VS Code con Copilot'));
  assert.equal(cops.length, 1);
  assert.equal(cops[0].nombre, 'VS Code con Copilot');
  assert.equal(cops[0].conectado, true);
});

test('un remitente visto en el buzón aparece aunque no esté en la configuración', () => {
  const lista = listaDestinatarios({
    agentes: [{ id: '1', nombre: 'Claude' }],
    remitentes: ['Orion', 'Claude'],
    consulta: '',
  });
  const orion = lista.find((x) => claveNombre(x.nombre) === 'orion');
  assert.ok(orion);
  assert.equal(orion.conectado, false);
  assert.equal(orion.fuente, 'remitente');
  const idxOrion = lista.indexOf(orion);
  const idxClaude = lista.findIndex((x) => x.conectado);
  assert.ok(idxClaude < idxOrion, 'conectado antes que remitente no conectado');
});

test('nombresDeHilos saca creadores y destinos; idAgentePorNombre resuelve uno solo', () => {
  const hs = [
    { creador: { nombre: 'Claude' }, destino: { nombre: 'Codex' } },
    { creador: { nombre: 'Grok' } },
  ];
  assert.deepEqual(nombresDeHilos(hs), ['Claude', 'Codex', 'Grok']);
  const ags = [{ id: 'a', nombre: 'Claude' }, { id: 'b', nombre: 'Grok' }];
  assert.equal(idAgentePorNombre(ags, 'claude'), 'a');
  assert.equal(idAgentePorNombre(ags, '  Grok '), 'b');
  assert.equal(idAgentePorNombre(ags, 'NovaBot'), null);
  assert.equal(idAgentePorNombre(ags, ''), null);
  assert.equal(idAgentePorNombre([{ id: '1', nombre: 'Claude' }, { id: '2', nombre: 'claude' }], 'Claude'), null);
});

test('al escribir se filtra y un nombre libre se puede usar si no coincide', () => {
  const filtrada = listaDestinatarios({ consulta: 'cla' });
  assert.ok(filtrada.some((x) => x.nombre === 'Claude'));
  assert.ok(!filtrada.some((x) => x.nombre === 'Grok'));
  const libre = listaDestinatarios({ agentes: [{ id: '1', nombre: 'Claude' }], consulta: 'NovaBot' });
  assert.equal(libre.at(-1).fuente, 'libre');
  assert.equal(libre.at(-1).nombre, 'NovaBot');
  const noLibre = listaDestinatarios({ agentes: [{ id: '1', nombre: 'NovaBot' }], consulta: 'novabot' });
  assert.ok(!noLibre.some((x) => x.fuente === 'libre'));
  assert.equal(noLibre.length, 1);
});

test('la PWA tiene el selector, lo llena con la lista y guarda para_agente si está conectado', () => {
  const html = pwa('index.html');
  const app = pwa('app.js');
  const sw = pwa('sw.js');
  const build = pwa('build-config.mjs');
  const css = pwa('estilo.css');
  const i18n = pwa('i18n.js');
  assert.match(html, /id="nuevo-para"/);
  assert.match(html, /id="nuevo-para"[^>]*role="combobox"/);
  assert.match(html, /id="nuevo-para-lista"[^>]*role="listbox"/);
  assert.match(app, /listaDestinatarios/);
  assert.match(app, /idAgentePorNombre/);
  assert.match(app, /para_agente/);
  assert.match(app, /cargarAgentesDestino/);
  assert.match(css, /#nuevo-para-lista/);
  assert.match(css, /\[data-theme=/);
  assert.match(i18n, /hilo\.paraPlaceholder/);
  assert.match(i18n, /hilo\.conectado/);
  assert.match(sw, /buzon-v23-rediseno/);
  assert.match(sw, /'destinatarios\.js'/);
  assert.match(build, /'destinatarios\.js'/);
});
