// Contra Supabase LOCAL real (supabase start + supabase functions serve): Storage privado, Edge Function
// "adjuntos", URLs firmadas reales que caducan y canje de códigos por la API pública.
// Se salta si no hay SUPABASE_API_URL local o SUPABASE_FUNCIONES=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { crearServicio, rpcSupabase, funcionesSupabase } from '../lib/servicio.js';
import { crearCanje } from '../lib/canje.js';
import { hashToken, nuevoToken } from '../lib/token.js';

const URL_ = process.env.SUPABASE_API_URL, ANON = process.env.SUPABASE_ANON_KEY, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const local = URL_ && /^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_) && process.env.SUPABASE_FUNCIONES === '1';
const opts = { skip: !local && 'sin Supabase local con Edge Functions' };
const A = nuevoToken(), B = nuevoToken(), X = nuevoToken();
const PDF = Buffer.from('%PDF-1.4\n%prueba CI\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
// Dentro de Docker la función ve SUPABASE_URL=http://kong:8000; en la nube es la URL pública. Aquí se reescribe el origen.
const publica = (u) => { const x = new URL(u); return URL_ + x.pathname + x.search; };
let erik, intruso, servicio, buzon, hilo, adj;

async function usuario(n) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: `ci-v2-${n}-${Date.now()}@buzon.test`, password: 'Prueba-' + nuevoToken() });
  if (error) throw error; return { c, id: data.user.id, jwt: data.session.access_token };
}
async function agente(u, b, nombre, tok) {
  const { data: ag, error } = await u.c.from('agentes').insert({ buzon_id: b, nombre }).select('id').single(); assert.ifError(error);
  assert.ifError((await u.c.from('tokens').insert({ agente_id: ag.id, hash_token: hashToken(tok) })).error);
}
before(async () => {
  if (!local) return;
  erik = await usuario('erik'); intruso = await usuario('intruso');
  buzon = (await erik.c.from('buzones').insert({ dueno_id: erik.id, nombre: 'CI v2' }).select().single()).data.id;
  const b2 = (await intruso.c.from('buzones').insert({ dueno_id: intruso.id, nombre: 'Ajeno' }).select().single()).data.id;
  await agente(erik, buzon, 'A', A); await agente(erik, buzon, 'B', B); await agente(intruso, b2, 'X', X);
  servicio = crearServicio(rpcSupabase(createClient, URL_, ANON), funcionesSupabase(URL_, ANON));
}, opts);
after(async () => { if (local) { await erik?.c.from('buzones').delete().eq('id', buzon); } });

test('Storage real: A sube un PDF, B lo descarga con URL firmada', opts, async () => {
  const r = await servicio.crear(A, { tipo: 'tarea', titulo: 'CI: PDF', adjuntos: [{ nombre: 'doc.pdf', base64: PDF.toString('base64') }] });
  hilo = r.id; adj = r.adjuntos[0]; assert.equal(adj.tipo, 'application/pdf', JSON.stringify(r.adjuntos));
  const d = await servicio.leer(B, { adjunto_id: adj.id });
  const f = await fetch(publica(d.url)); assert.equal(f.status, 200);
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), PDF);
});
test('Storage real: el bucket es privado (sin URL firmada no hay acceso)', opts, async () => {
  const ruta = new URL((await servicio.leer(B, { adjunto_id: adj.id })).url).pathname.split('/sign/adjuntos/')[1];
  assert.notEqual((await fetch(`${URL_}/storage/v1/object/public/adjuntos/${ruta}`)).status, 200);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  assert.ok((await anon.storage.from('adjuntos').download(ruta)).error);
  assert.ok((await erik.c.storage.from('adjuntos').download(ruta)).error, 'ni el dueño directo: solo vía la función');
});
test('Storage real: URL firmada vencida devuelve error', opts, async () => {
  const sr = createClient(URL_, SR, { auth: { persistSession: false } });
  const ruta = new URL((await servicio.leer(B, { adjunto_id: adj.id })).url).pathname.split('/sign/adjuntos/')[1];
  const { data } = await sr.storage.from('adjuntos').createSignedUrl(decodeURIComponent(ruta), 1);
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok((await fetch(data.signedUrl)).status >= 400);
});
test('Edge Function: la PWA (sesión de Erik) firma; el intruso y el agente ajeno reciben 404', opts, async () => {
  const llamar = (jwt, extra = {}) => fetch(`${URL_}/functions/v1/adjuntos`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${jwt}`, ...extra }, body: JSON.stringify({ accion: 'firmar', adjunto_id: adj.id }) });
  assert.equal((await llamar(erik.jwt)).status, 200);
  assert.equal((await llamar(intruso.jwt)).status, 404);
  assert.equal((await llamar(ANON, { 'X-Buzon-Token': X })).status, 404);
  assert.equal((await llamar(ANON)).status, 401);
});
test('Edge Function: rechaza tipo disfrazado y SVG', opts, async () => {
  const r = await servicio.responder(B, { hilo_id: hilo, cuerpo: 'x', adjuntos: [{ nombre: 'a.png', base64: PDF.toString('base64') }, { nombre: 'a.svg', base64: Buffer.from('<svg/>').toString('base64') }] });
  assert.match(r.adjuntos[0].error, /\[415\]/); assert.match(r.adjuntos[1].error, /\[415\]/);
});
test('API real: Erik genera código y se canjea una vez por la clave pública', opts, async () => {
  const { data, error } = await erik.c.rpc('crear_codigo_config', { p_buzon: buzon, p_nombre: 'Grok', p_minutos: 5 }); assert.ifError(error);
  const canje = crearCanje(rpcSupabase(createClient, URL_, ANON));
  const pedir = (codigo) => new Promise((ok) => { const res = { statusCode: 200, setHeader() {}, end(b) { ok({ status: this.statusCode, body: String(b) }); } }; canje({ method: 'POST', headers: { accept: 'text/plain' }, body: { codigo } }, res); });
  const r1 = await pedir(data.codigo); assert.equal(r1.status, 200); assert.match(r1.body, /^bz_/);
  assert.ok(Array.isArray((await servicio.leer(r1.body, {})).hilos));
  assert.equal((await pedir(data.codigo)).status, 403);
  const { error: e2 } = await intruso.c.rpc('crear_codigo_config', { p_buzon: buzon, p_nombre: 'Malo' }); assert.ok(e2);
});
