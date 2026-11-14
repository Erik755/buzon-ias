// Prompts para que cada agente active sus avisos del Buzón (pwa/prompts-agentes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIAS } from '../../pwa/guias.js';
import { ETIQUETA_PROMPT, PROMPT_DE_GUIA, AGENTES_PROMPT, promptAgente, promptDeGuia } from '../../pwa/prompts-agentes.js';
import { rellenarPlantilla } from '../../pwa/conectar.js';

const raiz = new URL('../../', import.meta.url).pathname;

test('la etiqueta en español es exactamente la pedida', () => {
  assert.equal(ETIQUETA_PROMPT.es, 'Prompt para configurar tu agente — copia y pega en la conversación, y listo.');
  assert.ok(ETIQUETA_PROMPT.en.length > 20);
});

test('cada guía conectable tiene prompt en los dos idiomas; Instinct y ChatGPT no', () => {
  for (const g of GUIAS) {
    const tiene = !['instinct', 'chatgpt'].includes(g.id);
    for (const idioma of ['es', 'en']) assert.equal(Boolean(promptDeGuia(g.id, idioma)), tiene, `${g.id} ${idioma}`);
  }
  for (const id of Object.keys(PROMPT_DE_GUIA)) assert.ok(GUIAS.some((g) => g.id === id), `guía inexistente: ${id}`);
});

test('los prompts llevan el MCP, el contrato del aviso y nunca una clave', () => {
  for (const id of AGENTES_PROMPT) for (const idioma of ['es', 'en']) {
    const p = promptAgente(id, idioma);
    assert.ok(p.includes('{URL}'), `${id} ${idioma}: falta {URL}`);
    assert.ok(!p.includes('{TOKEN}') && !p.includes('{CANJE}'), `${id} ${idioma}: no debe llevar la clave`);
    assert.ok(!/bz_[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9]{8,}|sk-ant-[a-z0-9]+-[A-Za-z0-9]{8,}/.test(p), `${id} ${idioma}: parece un secreto`);
    for (const x of ['tarea_nueva', 'mensaje_nuevo', 'hilo_id', 'X-Buzon-Firma', 'Authorization: Bearer', 'leer', 'responder', 'pedir_aprobacion']) assert.ok(p.includes(x), `${id} ${idioma}: falta ${x}`);
    assert.match(p, idioma === 'es' ? /Nunca me pidas ni escribas en este chat/ : /Never ask me for, or write in this chat/);
    assert.match(p, idioma === 'es' ? /«Dirección \(https\)»/ : /“Address \(https\)”/);
    const lleno = rellenarPlantilla(p, { url: 'https://ejemplo.test/mcp' });
    assert.ok(!lleno.includes('{URL}') && lleno.includes('https://ejemplo.test/mcp'));
  }
});

test('honestidad: sin receptor propio se dice revisión periódica', () => {
  assert.match(promptAgente('windsurf', 'es'), /no puede tener aviso inmediato/);
  assert.match(promptAgente('antigravity', 'es'), /no aviso inmediato/);
  assert.match(promptAgente('cursor', 'es'), /api2\.cursor\.sh\/automations\/webhook/);
  assert.match(promptAgente('claude', 'es'), /anthropic-version: 2023-06-01/);
});

test('el service worker cachea el módulo de prompts y cambió de versión', () => {
  const sw = readFileSync(raiz + 'pwa/sw.js', 'utf8');
  assert.match(sw, /'prompts-agentes\.js'/);
  assert.match(sw, /buzon-v25-prompts-agentes/);
  assert.match(readFileSync(raiz + 'pwa/build-config.mjs', 'utf8'), /'prompts-agentes\.js'/);
});
