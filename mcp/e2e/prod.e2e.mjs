// Prueba de punta a punta contra PRODUCCIÓN, aislada en un usuario de prueba.
// Requiere: E2E_EMAIL, E2E_PASSWORD (usuario de prueba creado a mano en Supabase, nunca el de Erik),
//           SUPABASE_URL, SUPABASE_ANON_KEY, CHROME (ruta a Chromium). Opcional: SALIDA (carpeta de video/capturas).
// Qué hace: el usuario de prueba crea su buzón y 2 agentes con tokens de 1 h → A crea una tarea por MCP →
// B la toma y pide aprobación → la IA intenta aprobar (debe fallar) → se aprueba en la PWA (viewport móvil, con video) →
// se verifica el estado final por MCP → se borra el buzón de prueba (agentes, tokens, hilos y mensajes en cascada).
import { chromium, devices } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import assert from 'node:assert/strict';

const { E2E_EMAIL, E2E_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, CHROME } = process.env;
const MCP = process.env.MCP_URL || 'https://buzon-ias-mcp.vercel.app/api/mcp';
const PWA = process.env.PWA_URL || 'https://buzon-ias-pwa.vercel.app';
const SALIDA = process.env.SALIDA || './e2e-salida';
if (!E2E_EMAIL?.endsWith('@buzon.test')) throw new Error('E2E_EMAIL debe ser un correo de prueba @buzon.test');
mkdirSync(SALIDA, { recursive: true });

const resultados = [];
const paso = async (nombre, fn) => { try { await fn(); resultados.push(['✔', nombre]); console.log('✔', nombre); } catch (e) { resultados.push(['✘', nombre]); console.error('✘', nombre, '\n ', e.message); throw e; } };
const tok = () => 'bz_' + randomBytes(32).toString('base64url');
const sha = (t) => createHash('sha256').update(t).digest('hex');

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: login, error: e0 } = await sb.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
if (e0) throw e0;
const uid = login.user.id;
let buzonId, hilo, browser;
const A = tok(), B = tok();

async function mcp(token) {
  const c = new Client({ name: 'e2e', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
  return async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { error: !!r.isError, texto: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) }; };
}

try {
  await paso('preparar buzón y 2 agentes aislados del usuario de prueba', async () => {
    let { data } = await sb.from('buzones').select('id').eq('dueno_id', uid);
    if (!data.length) ({ data } = await sb.from('buzones').insert({ dueno_id: uid, nombre: 'E2E' }).select('id'));
    buzonId = data[0].id;
    for (const [n, t] of [['Agente A (e2e)', A], ['Agente B (e2e)', B]]) {
      const { data: ag, error } = await sb.from('agentes').insert({ buzon_id: buzonId, nombre: n }).select('id,nombre').single(); assert.ifError(error);
      assert.ifError((await sb.from('tokens').insert({ agente_id: ag.id, hash_token: sha(t), vence_en: new Date(Date.now() + 3600e3).toISOString() })).error);
    }
  });
  const a = await mcp(A), b = await mcp(B);
  await paso('MCP: A crea una tarea', async () => { const r = await a('crear', { tipo: 'tarea', titulo: 'E2E ' + new Date().toISOString().slice(0, 16), contexto: 'Prueba automática' }); assert.ok(!r.error, r.texto); hilo = r.json.id; });
  await paso('MCP: B lee el buzón y ve la tarea', async () => { const r = await b('leer', {}); assert.ok(r.json.hilos.some((h) => h.id === hilo)); });
  await paso('MCP: B la toma', async () => assert.equal((await b('responder', { hilo_id: hilo, cuerpo: 'La tomo', accion: 'tomar' })).json.estado, 'tomado'));
  await paso('MCP: B responde y pide aprobación', async () => assert.equal((await b('responder', { hilo_id: hilo, cuerpo: 'Listo. ¿Apruebas?', accion: 'pedir_aprobacion' })).json.estado, 'pide_aprobacion'));
  await paso('Seguridad: la IA NO puede aprobar (acción "aprobar")', async () => { const r = await b('responder', { hilo_id: hilo, cuerpo: 'auto', accion: 'aprobar' }); assert.ok(r.error); });
  await paso('Seguridad: la IA NO puede aprobar insertando en la tabla con la clave pública', async () => {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    assert.ok((await anon.from('aprobaciones').insert({ hilo_id: hilo, humano_id: uid, decision: 'aprobado' })).error);
    assert.equal((await a('leer', { hilo_id: hilo })).json.hilo.estado, 'pide_aprobacion');
  });

  browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', recordVideo: { dir: SALIDA, size: { width: 412, height: 915 } } });
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${ref}-auth-token`, JSON.stringify(login.session)]);
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', (e) => errores.push(e.message));
  await paso('PWA (móvil): la tarea aparece en "Por aprobar"', async () => {
    await p.goto(PWA, { waitUntil: 'networkidle' });
    await p.locator('.tarjeta', { hasText: 'E2E ' }).first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(800); await p.screenshot({ path: SALIDA + '/01-por-aprobar.png' });
  });
  await paso('PWA (móvil): abrir y ver el historial de A y B', async () => {
    await p.locator('.tarjeta', { hasText: 'E2E ' }).first().click();
    await p.locator('#dlg').getByText('Listo. ¿Apruebas?').waitFor();
    await p.fill('#nota', 'Aprobado desde la prueba e2e'); await p.waitForTimeout(600);
    await p.screenshot({ path: SALIDA + '/02-hilo.png' });
  });
  await paso('PWA (móvil): tocar Aprobar', async () => {
    await p.click('#aprobar');
    await p.locator('.vacio').waitFor({ timeout: 15000 }); await p.waitForTimeout(800);
    await p.screenshot({ path: SALIDA + '/03-aprobado.png' });
  });
  await paso('PWA (móvil): Probar conexión muestra que los agentes ya usaron el buzón', async () => {
    await p.click('nav [data-vista="agentes"]');
    await p.getByText('🟢 Conectada').first().waitFor({ timeout: 15000 }); await p.waitForTimeout(600);
    await p.screenshot({ path: SALIDA + '/04-agentes-conectados.png' });
  });
  await paso('MCP: el hilo quedó aprobado con la nota de la humana', async () => {
    const r = await a('leer', { hilo_id: hilo });
    assert.equal(r.json.hilo.estado, 'aprobado'); assert.equal(r.json.aprobaciones[0].nota, 'Aprobado desde la prueba e2e');
  });
  await paso('PWA sin errores de JavaScript', async () => assert.deepEqual(errores, []));
  await ctx.close();
} finally {
  await browser?.close();
  if (buzonId) { const { error } = await sb.from('buzones').delete().eq('id', buzonId); console.log(error ? '⚠ no se pudo limpiar: ' + error.message : '🧹 buzón de prueba borrado'); }
  const v = readdirSync(SALIDA).filter((f) => f.endsWith('.webm') && !f.startsWith('e2e-')); if (v[0]) renameSync(`${SALIDA}/${v[0]}`, `${SALIDA}/e2e-prod-movil.webm`);
  console.log(`\n${resultados.filter((r) => r[0] === '✔').length}/${resultados.length} pasos OK`);
}
