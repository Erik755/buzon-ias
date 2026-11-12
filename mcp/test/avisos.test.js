// Avisos por agente en el Chat: etiquetas, RPCs del dueño, y la lista no usa innerHTML con datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { etiquetaAviso } from '../../pwa/avisos.js';

const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
const avisos = readFileSync(new URL('../../pwa/avisos.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../pwa/sw.js', import.meta.url), 'utf8');
const mig = readFileSync(new URL('../../supabase/migrations/20261111000017_hilo_suscripciones.sql', import.meta.url), 'utf8');

test('etiquetaAviso: con webhook es aviso inmediato; sin él, se enterará cuando revise', () => {
  assert.equal(etiquetaAviso(true), 'Aviso inmediato');
  assert.equal(etiquetaAviso(false), 'Se enterará cuando revise');
  assert.equal(etiquetaAviso(1), 'Aviso inmediato');
  assert.equal(etiquetaAviso(0), 'Se enterará cuando revise');
});

test('el Chat pide las IAs con la RPC del dueño y guarda con suscribir_agente_hilo', () => {
  assert.match(app, /sb\.rpc\('agentes_para_avisos',\s*\{\s*p_hilo:/);
  assert.match(app, /sb\.rpc\('suscribir_agente_hilo',\s*\{\s*p_hilo:.*p_agente:.*p_activo:/s);
  assert.match(app, /pintarAvisosHilo/);
  assert.match(avisos, /Se enterará cuando revise/);
  assert.match(avisos, /Aviso inmediato/);
  assert.match(app, /En esta conversación/);
  assert.match(app, /Otra IA de tu buzón/);
  // El texto de error y los nombres van por textContent / createElement, no innerHTML con datos del servidor.
  const fn = app.split('async function pintarAvisosHilo')[1].split('const ESTADO')[0];
  assert.match(fn, /textContent/);
  assert.match(fn, /createElement/);
  assert.doesNotMatch(fn, /innerHTML/);
  // Si falla la RPC, se revierte la casilla y se avisa en la página.
  assert.match(fn, /cb\.checked = !cb\.checked/);
  assert.match(fn, /avisar\('No se pudo guardar el aviso'/);
});

test('la migración reusa la cola de notificar, fuerza RLS y no cambia el payload', () => {
  assert.match(mig, /create table public\.hilo_suscripciones/);
  assert.match(mig, /force row level security/);
  assert.match(mig, /es_dueno/);
  assert.match(mig, /suscribir_agente_hilo/);
  assert.match(mig, /agentes_para_avisos/);
  assert.match(mig, /_destinos_webhook/);
  assert.match(mig, /interval '10 seconds'/);
  assert.match(mig, /a\.id is distinct from origen/);
  assert.match(mig, /El payload del webhook no cambia/);
  // Escritura solo por la RPC: authenticated no tiene INSERT.
  assert.match(mig, /revoke all on public\.hilo_suscripciones from public, anon, authenticated/);
  assert.match(mig, /grant select on public\.hilo_suscripciones to authenticated/);
  assert.match(sw, /buzon-v21-temas/);
});
