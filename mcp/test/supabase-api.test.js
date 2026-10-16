// Pruebas contra la API real de un Supabase LOCAL (PostgREST + GoTrue), levantado con `supabase start`.
// Se saltan si no hay SUPABASE_API_URL / SUPABASE_ANON_KEY (p. ej. en un Postgres simple).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { crearServicio, rpcSupabase } from '../lib/servicio.js';
import { hashToken, nuevoToken } from '../lib/token.js';

const URL_ = process.env.SUPABASE_API_URL, ANON = process.env.SUPABASE_ANON_KEY;
const local = URL_ && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_);
const opts = { skip: !local && 'sin Supabase local' };
let humano, intruso, servicio, buzonId, hilo;
const A = nuevoToken(), B = nuevoToken();
const correo = (n) => `ci-${n}-${Date.now()}@buzon.test`;

async function usuario(n) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: correo(n), password: 'Prueba-' + nuevoToken() });
  if (error) throw error; assert.ok(data.session, 'GoTrue local debe devolver sesión (sin confirmación)');
  return { c, id: data.user.id };
}

before(async () => {
  if (!local) return;
  humano = await usuario('erik'); intruso = await usuario('intruso');
  const { data: bz } = await humano.c.from('buzones').insert({ dueno_id: humano.id, nombre: 'CI' }).select().single();
  buzonId = bz.id;
  for (const [n, t] of [['Agente A', A], ['Agente B', B]]) {
    const { data: ag, error } = await humano.c.from('agentes').insert({ buzon_id: buzonId, nombre: n }).select().single();
    assert.ifError(error);
    assert.ifError((await humano.c.from('tokens').insert({ agente_id: ag.id, hash_token: hashToken(t) })).error);
  }
  servicio = crearServicio(rpcSupabase(createClient, URL_, ANON));
}, opts);

after(async () => { await humano?.c.from('buzones').delete().eq('id', buzonId ?? '00000000-0000-0000-0000-000000000000'); });

test('API: A crea, B toma y pide aprobación', opts, async () => {
  hilo = await servicio.crear(A, { tipo: 'tarea', titulo: 'CI: tarea' });
  assert.equal((await servicio.responder(B, { hilo_id: hilo.id, cuerpo: 'tomo', accion: 'tomar' })).estado, 'tomado');
  assert.equal((await servicio.responder(B, { hilo_id: hilo.id, cuerpo: 'listo', accion: 'pedir_aprobacion' })).estado, 'pide_aprobacion');
});

test('API: la IA no puede aprobar (ni por RPC ni por tabla)', opts, async () => {
  await assert.rejects(() => servicio.responder(B, { hilo_id: hilo.id, cuerpo: 'x', accion: 'aprobar' }), (e) => e.codigo === 400);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const r = await anon.from('aprobaciones').insert({ hilo_id: hilo.id, humano_id: humano.id, decision: 'aprobado' });
  assert.ok(r.error, 'anon no debe poder insertar aprobaciones');
});

test('API: anon no lee tablas ni hashes', opts, async () => {
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  for (const t of ['hilos', 'tokens', 'auditoria', 'estado_agentes']) assert.ok((await anon.from(t).select('*').limit(1)).error, t);
});

test('API: el intruso no ve el buzón ni puede aprobar', opts, async () => {
  assert.equal((await intruso.c.from('hilos').select('*')).data.length, 0);
  const r = await intruso.c.from('aprobaciones').insert({ hilo_id: hilo.id, humano_id: intruso.id, decision: 'aprobado' });
  assert.ok(r.error);
});

test('API: el dueño no puede leer hash_token pero sí el último uso (Probar conexión)', opts, async () => {
  assert.ok((await humano.c.from('tokens').select('hash_token')).error);
  const { data } = await humano.c.from('estado_agentes').select('nombre,ultimo_uso').order('nombre');
  assert.equal(data.length, 2); assert.ok(data.every((a) => a.ultimo_uso));
});

test('API: el dueño aprueba como en la PWA y el hilo queda aprobado', opts, async () => {
  assert.ifError((await humano.c.from('aprobaciones').insert({ hilo_id: hilo.id, humano_id: humano.id, decision: 'aprobado', nota: 'ok' })).error);
  assert.equal((await servicio.leer(A, { hilo_id: hilo.id })).hilo.estado, 'aprobado');
});

test('API: token revocado falla al instante', opts, async () => {
  const { data } = await humano.c.from('tokens').update({ revocado_en: new Date().toISOString() }).not('id', 'is', null).select('id');
  assert.equal(data.length, 2);
  await assert.rejects(() => servicio.leer(A, {}), (e) => e.codigo === 403);
});
