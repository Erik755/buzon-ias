// Prompts para que cada agente active sus avisos del Buzón (pwa/prompts-agentes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIAS } from '../../pwa/guias.js';
import { ETIQUETA_PROMPT, PROMPT_DE_GUIA, AGENTES_PROMPT, promptAgente, promptDeGuia } from '../../pwa/prompts-agentes.js';
import { rellenarPlantilla, guiaPorNombre } from '../../pwa/conectar.js';

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
  assert.match(sw, /buzon-v27-foco/);
  assert.match(readFileSync(raiz + 'pwa/build-config.mjs', 'utf8'), /'prompts-agentes\.js'/);
});

test('el nombre del agente elige su guía aunque lleve más palabras; nombres sin relación no', () => {
  const id = (n) => guiaPorNombre(n, GUIAS)?.id ?? null;
  assert.equal(id('Grok'), 'grok');
  assert.equal(id('Grok Bot'), 'grok');
  assert.equal(id('Claude'), 'claude-code');
  assert.equal(id('Mi Cursor de casa'), 'cursor');
  assert.equal(id('Instinct'), 'instinct');
  assert.equal(id('Claude Desktop'), 'claude-desktop');
  assert.equal(id('Gemini CLI'), 'gemini-cli');
  assert.equal(id('Copilot Bot'), 'vscode');
  assert.equal(id('Agente MCP de casa'), null);
  assert.equal(id('Agente con avisos'), null);
  assert.equal(id('Agent with alerts'), null);
  assert.equal(id('xAI Bot'), 'grok');
  assert.equal(id('Zorro'), null);
});

test('la guía elegida no es una región viva (no lee el prompt entero) y se enfoca por su título', () => {
  const app = readFileSync(raiz + 'pwa/app.js', 'utf8');
  assert.doesNotMatch(app, /id="guia-detalle"[^>]*aria-live/);
  assert.match(app, /id="guia-detalle"[^>]*aria-labelledby="guia-titulo"/);
});

test('cada prompt abre el espacio seguro real de su herramienta y nunca pide la clave en el chat', () => {
  const mecanismo = {
    claude: /"Bearer \$\{BUZON_TOKEN\}"/, codex: /bearer_token_env_var = "BUZON_TOKEN"/, gemini: /"Bearer \$BUZON_TOKEN"/,
    grok: /tarjeta de secreto \(secret request\)/, cursor: /Bearer \$\{env:BUZON_TOKEN\}/, copilot: /"password": true/,
    windsurf: /Bearer \$\{env:BUZON_TOKEN\}/, antigravity: /PEGA_AQUI_TU_CLAVE/, generico: /campo de secreto, bóveda/,
  };
  for (const id of AGENTES_PROMPT) {
    const es = promptAgente(id, 'es'), en = promptAgente(id, 'en');
    assert.match(es, /ábreme tu espacio seguro/, id);
    assert.match(en, /open your secure input for me/, id);
    assert.match(es, /^1\. Clave del MCP en un espacio seguro\./m, id);
    assert.match(es, mecanismo[id], id);
  }
  assert.match(promptAgente('grok', 'en'), /secret request card/);
  assert.match(promptAgente('claude', 'es'), /read -rs BUZON_TOKEN; echo; export BUZON_TOKEN/);
  assert.doesNotMatch(promptAgente('claude', 'es'), /read -rs -p/); // -p en zsh lee de un coproceso
  assert.match(promptAgente('claude', 'en'), /\$env:BUZON_TOKEN = Read-Host/); // también en la sesión actual de PowerShell
});
