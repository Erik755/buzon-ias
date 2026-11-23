// Cada módulo de la PWA debe parsear: un error de sintaxis en app.js deja la app en blanco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PWA = fileURLToPath(new URL('../../pwa/', import.meta.url));

test('todos los pwa/*.js pasan node --check como módulos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-sintaxis-'));
  const archivos = readdirSync(PWA).filter((f) => f.endsWith('.js'));
  assert.ok(archivos.includes('app.js'));
  for (const f of archivos) {
    const copia = join(dir, f.replace(/\.js$/, '.mjs'));
    copyFileSync(join(PWA, f), copia);
    const r = spawnSync(process.execPath, ['--check', copia], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});
