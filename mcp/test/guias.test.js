// Los fragmentos que el usuario copia (codigo) son técnicos y no deben traducirse:
// nombres de opciones, variables de entorno, cabeceras y claves JSON/TOML quedan exactos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIAS } from '../../pwa/guias.js';

const g = (id) => GUIAS.find((x) => x.id === id);
const raiz = new URL('../../', import.meta.url).pathname;

test('ningún bloque copiable contiene "clave"', () => {
  for (const x of GUIAS) if (x.codigo) assert.ok(!/clave/i.test(x.codigo), `${x.id}: ${x.codigo}`);
});
test('Codex: bearer_token_env_var y BUZON_TOKEN exactos', () => {
  assert.match(g('codex').codigo, /^bearer_token_env_var = "BUZON_TOKEN"$/m);
  assert.match(g('codex').codigo, /^\[mcp_servers\.buzon\]$/m);
  for (const id of ['nl-codex', 'codex']) assert.ok([g(id).donde, ...g(id).pasos, g(id).nota ?? ''].join(' ').includes('bearer_token_env_var') || g(id).codigo.includes('bearer_token_env_var'), id);
});
test('canje y Grok: BUZON_TOKEN y Authorization exactos', () => {
  for (const id of ['nl-codex', 'nl-grok']) {
    assert.match(g(id).codigo, /export BUZON_TOKEN="\$\(curl -fsS -X POST \{CANJE\}/);
    assert.match(g(id).codigo, /-H 'Accept: text\/plain' -H 'Content-Type: application\/json' -d "\{\\"codigo\\":\\"\$C\\"\}"/);
  }
  assert.equal(g('grok').codigo, "grok mcp add --transport http buzon {URL} --header 'Authorization: Bearer ${BUZON_TOKEN}'");
  for (const id of ['claude-code', 'cursor', 'gemini-cli', 'vscode', 'windsurf', 'antigravity', 'claude-desktop']) assert.match(g(id).codigo, /Authorization/, id);
});
test('textos de guías y docs no tienen identificadores traducidos', () => {
  const todo = [readFileSync(raiz + 'pwa/guias.js', 'utf8'), readFileSync(raiz + 'README.md', 'utf8'), readFileSync(raiz + 'docs/CONECTAR.md', 'utf8')].join('\n');
  for (const malo of [/bearer_clave/i, /BUZON_CLAVE/, /clave_env/i, /\{CLAVE\}/, /Bearer clave/i, /--clave/i, /"clave"\s*:/i, /http_clave/i])
    assert.ok(!malo.test(todo), String(malo));
  assert.match(todo, /bearer_token_env_var/);
});
