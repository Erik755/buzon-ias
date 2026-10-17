// v2 contra Postgres local: adjuntos por MCP (PDF entre 2 agentes), aislamiento, tipos/tamaños inválidos,
// URLs vencidas, notificador (push + webhook con SSRF) y canje de códigos de configuración.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { crearServicio, rpcPg } from '../lib/servicio.js';
import { crearServidorMcp } from '../lib/servidor.js';
import { hashToken, nuevoToken } from '../lib/token.js';
import { crearCanje } from '../lib/canje.js';
import { manejar } from '../../supabase/functions/_shared/adjuntos_core.js';
import { procesar } from '../../supabase/functions/_shared/notificar_core.js';
import { verificar } from '../../supabase/functions/_shared/hmac.js';

const raiz = new URL('../../', import.meta.url).pathname;
const DB = 'buzon_v2_' + process.pid;
const ERIK = '11111111-1111-1111-1111-111111111111', OTRO = '22222222-2222-2222-2222-222222222222';
const BZ = 'aaaaaaaa-0000-0000-0000-000000000001', BZ2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const T = { a: nuevoToken(), b: nuevoToken(), ajeno: nuevoToken() };
let admin, pool, servicio, reloj = Date.now();
const bucket = new Map();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

// Storage en memoria con URLs firmadas que caducan (mismo contrato que Supabase Storage).
const deps = () => ({
  rpc: rpcPg(pool, 'service_role'),
  subir: async (r, b, t) => { bucket.set(r, { b, t }); },
  borrar: async (r) => { bucket.delete(r); },
  firmar: async (r, seg, nombre) => `mem://${r}?exp=${reloj + seg * 1000}&download=${encodeURIComponent(nombre)}`,
  usuario: async (jwt) => ({ 'jwt-erik': ERIK, 'jwt-otro': OTRO })[jwt] ?? null,
  uuid: () => crypto.randomUUID(),
});
const descargar = (url) => { const u = new URL(url); if (+u.searchParams.get('exp') < reloj) return { status: 400 }; return { status: 200, ...bucket.get(u.host + u.pathname) }; };
const funciones = { adjuntos: async (c, token, ip) => { const r = await manejar(c, { token, ip }, deps()); return r.status === 200 ? r.cuerpo : { status: r.status, error: r.cuerpo.error }; }, notificar: async () => ({}) };

before(async () => {
  admin = new pg.Client({ database: 'postgres' }); await admin.connect();
  await admin.query(`create database ${DB}`);
  pool = new pg.Pool({ database: DB, max: 4 });
  await pool.query(readFileSync(raiz + 'tests/local/00_supabase_shim.sql', 'utf8'));
  for (const f of readdirSync(raiz + 'supabase/migrations').sort()) await pool.query(readFileSync(raiz + 'supabase/migrations/' + f, 'utf8'));
  await pool.query(`insert into auth.users values ('${ERIK}','erik'),('${OTRO}','otro');
    insert into buzones(id,dueno_id,nombre) values ('${BZ}','${ERIK}','Erik'),('${BZ2}','${OTRO}','Otro')`);
  for (const [id, b, n, t] of [['bbbbbbbb-0000-0000-0000-00000000000a', BZ, 'Agente A', T.a], ['bbbbbbbb-0000-0000-0000-00000000000b', BZ, 'Agente B', T.b],
    ['bbbbbbbb-0000-0000-0000-00000000000c', BZ2, 'Ajeno', T.ajeno]]) {
    await pool.query('insert into agentes(id,buzon_id,nombre) values($1,$2,$3)', [id, b, n]);
    await pool.query('insert into tokens(agente_id,hash_token) values($1,$2)', [id, hashToken(t)]);
  }
  servicio = crearServicio(rpcPg(pool), funciones);
});
after(async () => { await pool?.end(); await admin.query(`drop database if exists ${DB}`); await admin.end(); });

async function cliente(token) {
  const [x, y] = InMemoryTransport.createLinkedPair();
  await crearServidorMcp(servicio, token, '127.0.0.1').connect(x);
  const c = new Client({ name: 't', version: '1' }); await c.connect(y); return c;
}
const tool = async (c, name, args) => { const r = await c.callTool({ name, arguments: args }); return { error: !!r.isError, texto: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) }; };

let hilo, adjunto;
test('caso real: A comparte un PDF al crear; B lo ve en leer y lo descarga con URL de 5 min', async () => {
  const A = await cliente(T.a), B = await cliente(T.b);
  const r = await tool(A, 'crear', { tipo: 'tarea', titulo: 'Revisa el contrato', adjuntos: [{ nombre: 'contrato.pdf', base64: PDF.toString('base64') }] });
  assert.equal(r.error, false, r.texto); hilo = r.json.id;
  assert.equal(r.json.adjuntos[0].tipo, 'application/pdf', JSON.stringify(r.json.adjuntos));
  const h = await tool(B, 'leer', { hilo_id: hilo });
  adjunto = h.json.adjuntos[0];
  assert.equal(adjunto.nombre, 'contrato.pdf');
  const d = await tool(B, 'leer', { adjunto_id: adjunto.id });
  assert.equal(d.json.caduca_en_segundos, 300);
  const f = descargar(d.json.url);
  assert.equal(f.status, 200); assert.deepEqual(Buffer.from(f.b), PDF); assert.equal(f.t, 'application/pdf');
  const resp = await tool(B, 'responder', { hilo_id: hilo, cuerpo: 'Te dejo mis notas', adjuntos: [{ nombre: 'notas.md', base64: Buffer.from('# Notas\nok').toString('base64') }] });
  assert.equal(resp.json.adjuntos[0].tipo, 'text/markdown');
  assert.equal((await tool(A, 'leer', { hilo_id: hilo })).json.adjuntos.length, 2);
});
test('URL firmada vencida ya no descarga', async () => {
  const d = await tool(await cliente(T.b), 'leer', { adjunto_id: adjunto.id });
  reloj += 301_000;
  assert.equal(descargar(d.json.url).status, 400);
});
test('aislamiento: agente de otro buzón no descarga, no adjunta y no ve', async () => {
  const X = await cliente(T.ajeno);
  assert.match((await tool(X, 'leer', { adjunto_id: adjunto.id })).texto, /\[404\]/);
  const r = await manejar({ accion: 'subir', hilo_id: hilo, nombre: 'x.pdf', base64: PDF.toString('base64') }, { token: T.ajeno }, deps());
  assert.equal(r.status, 404);
  assert.equal((await manejar({ accion: 'firmar', adjunto_id: adjunto.id }, { jwt: 'jwt-otro' }, deps())).status, 404, 'humano ajeno');
  assert.equal((await manejar({ accion: 'firmar', adjunto_id: adjunto.id }, { jwt: 'jwt-erik' }, deps())).status, 200, 'Erik desde la PWA');
  assert.equal((await manejar({ accion: 'firmar', adjunto_id: adjunto.id }, { jwt: 'falso' }, deps())).status, 401);
  assert.equal((await manejar({ accion: 'firmar', adjunto_id: adjunto.id }, {}, deps())).status, 401);
});
test('tipos y tamaños inválidos: disfraz, SVG, HTML, exe, >3 MB, base64 roto', async () => {
  const sub = (nombre, b) => manejar({ accion: 'subir', hilo_id: hilo, nombre, base64: Buffer.from(b).toString('base64') }, { token: T.a }, deps());
  assert.equal((await sub('foto.png', PDF)).status, 415);
  assert.equal((await sub('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')).status, 415);
  assert.equal((await sub('a.txt', '<!doctype html><script>x</script>')).status, 415);
  assert.equal((await sub('a.exe', 'MZ\x90\x00')).status, 415);
  assert.equal((await sub('g.pdf', Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024)]))).status, 413);
  assert.equal((await manejar({ accion: 'subir', hilo_id: hilo, nombre: 'a.pdf', base64: '***' }, { token: T.a }, deps())).status, 400);
  assert.equal((await manejar({ accion: 'subir', hilo_id: hilo, nombre: 'a.pdf', base64: 'AAAA' }, { token: 'bz_' + 'x'.repeat(30) }, deps())).status, 403);
  const c = await cliente(T.a);
  const r = await c.callTool({ name: 'crear', arguments: { tipo: 'tarea', titulo: 't', adjuntos: [1, 2, 3, 4].map((i) => ({ nombre: i + '.txt', base64: 'aG9sYQ==' })) } });
  assert.equal(r.isError, true, 'más de 3 adjuntos');
  assert.equal(bucket.size, 2, 'nada inválido quedó en el bucket');
});
test('si el registro falla (cuota), el archivo se borra del bucket', async () => {
  await pool.query(`insert into adjuntos(buzon_id,hilo_id,nombre,tipo,tamano,sha256,ruta) select '${BZ}','${hilo}','r.pdf','application/pdf',3145728,repeat('b',64),'relleno/'||g from generate_series(1,33) g`);
  const r = await manejar({ accion: 'subir', hilo_id: hilo, nombre: 'c.pdf', base64: Buffer.concat([PDF, Buffer.alloc(2_000_000)]).toString('base64') }, { token: T.a }, deps());
  assert.equal(r.status, 413); assert.equal(bucket.size, 2);
  await pool.query("delete from adjuntos where ruta like 'relleno/%'");
});
test('auditoría: subidas y descargas registradas', async () => {
  const { rows } = await pool.query("select accion, count(*)::int n from auditoria where accion like 'adjunto:%' group by 1 order by 1");
  assert.deepEqual(rows.map((r) => r.accion), ['adjunto:descargar', 'adjunto:subir']);
  assert.ok(rows.every((r) => r.n >= 2));
});

test('notificador: push al dueño, webhook firmado a los otros agentes, SSRF bloqueado, sin contenido', async () => {
  await pool.query("update agentes set webhook_url='https://hooks.ejemplo.dev/b', webhook_secreto='whsec_b' where nombre='Agente B'");
  await pool.query("update agentes set webhook_url='https://interno.ejemplo.dev/a', webhook_secreto='whsec_a' where nombre='Ajeno'");
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  await pool.query(`insert into push_suscripciones(buzon_id,humano_id,endpoint,p256dh,auth) values ('${BZ}','${ERIK}','https://fcm.googleapis.com/fcm/send/e1',$1,$2),('${BZ}','${ERIK}','https://updates.push.services.mozilla.com/wpush/v2/viejo',$1,$2)`,
    [p256dh, Buffer.alloc(16, 7).toString('base64url')]);
  const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const claves = { publica: Buffer.from(await crypto.subtle.exportKey('raw', vk.publicKey)).toString('base64url'), privada: (await crypto.subtle.exportKey('jwk', vk.privateKey)).d, sujeto: 'mailto:t@t.t' };
  await pool.query('update notificaciones set estado=\'enviada\'');
  const nuevo = await servicio.crear(T.a, { tipo: 'tarea', titulo: 'Secreto: clave del banco 1234 y más texto largo' });
  const llamadas = [];
  const enviar = async (url, ip, headers, body) => { llamadas.push({ url, ip, o: { headers, body } }); return url.endsWith('viejo') ? 410 : 201; };
  const r = await procesar({
    rpc: rpcPg(pool, 'service_role'), claves, enviar,
    suscripciones: async (b) => (await pool.query('select id,endpoint,p256dh,auth from push_suscripciones where buzon_id=$1', [b])).rows,
    borrarSuscripcion: async (id) => { await pool.query('delete from push_suscripciones where id=$1', [id]); },
    webhooks: async (b, ex) => (await pool.query('select id,webhook_url,webhook_secreto from agentes where buzon_id=$1 and webhook_url is not null and id is distinct from $2', [b, ex])).rows,
    resolver: async (h) => ({ 'hooks.ejemplo.dev': ['93.184.216.34'], 'interno.ejemplo.dev': ['10.0.0.5'], 'fcm.googleapis.com': ['142.250.1.1'], 'updates.push.services.mozilla.com': ['34.1.1.1'] })[h] ?? [],
  });
  assert.deepEqual(r, { procesadas: 1, ok: 1, errores: 0 });
  const push = llamadas.filter((l) => /fcm|mozilla/.test(l.url));
  assert.equal(push.length, 2); assert.equal(push[0].o.headers['Content-Encoding'], 'aes128gcm'); assert.match(push[0].o.headers.Authorization, /^vapid t=/);
  assert.ok(!Buffer.from(push[0].o.body).toString('latin1').includes('banco'), 'el push va cifrado');
  assert.equal((await pool.query('select count(*)::int n from push_suscripciones')).rows[0].n, 1, 'la suscripción 410 se borró');
  const wh = llamadas.filter((l) => l.url.startsWith('https://hooks.'));
  assert.equal(wh.length, 1, 'solo el agente B (no el creador A ni el de otro buzón)');
  assert.equal(wh[0].ip, '93.184.216.34', 'se envía a la IP validada');
  assert.ok(await verificar('whsec_b', wh[0].o.body, wh[0].o.headers['X-Buzon-Firma']));
  assert.deepEqual(JSON.parse(wh[0].o.body).hilo_id, nuevo.id); assert.ok(!wh[0].o.body.includes('banco'));
  assert.ok(!llamadas.some((l) => l.url.includes('interno')));
});
test('webhook: destino que resuelve a IP privada falla y se reintenta como máximo 3 veces', async () => {
  await pool.query("update agentes set webhook_url='https://rebind.ejemplo.dev/x' where nombre='Agente B'");
  await pool.query("update notificaciones set estado='enviada'");
  await servicio.crear(T.a, { tipo: 'avance', titulo: 'otro' });
  const d = { rpc: rpcPg(pool, 'service_role'), claves: null, enviar: async () => assert.fail('no debe llamar'), suscripciones: async () => [], borrarSuscripcion: async () => {},
    webhooks: async () => (await pool.query("select id,webhook_url,webhook_secreto from agentes where nombre='Agente B'")).rows, resolver: async () => ['169.254.169.254'] };
  for (let i = 0; i < 4; i++) { await procesar(d); await pool.query("update notificaciones set proximo_intento=now() where estado='pendiente'"); }
  const { rows } = await pool.query("select estado, intentos, ultimo_error from notificaciones where estado<>'enviada'");
  assert.equal(rows.length, 1); assert.equal(rows[0].estado, 'fallida'); assert.equal(rows[0].intentos, 3); assert.equal(rows[0].ultimo_error, 'webhook_fallo', 'sin detalle ni código HTTP');
});

// ---- Configuración en lenguaje natural ----
const http = (h, body, headers = {}) => new Promise((ok) => {
  const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, end(b = '') { ok({ status: this.statusCode, body: String(b), h: this.h }); } };
  h({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.9', ...headers }, body }, res);
});
async function codigoDeErik(min = 10) {
  const c = await pool.connect();
  try {
    await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${ERIK}',false)`);
    return (await c.query("select crear_codigo_config($1,'Codex',$2) j", [BZ, min])).rows[0].j;
  } finally { await c.query('reset role'); c.release(); }
}
test('canje: código bzc_ → token bz_ que funciona por MCP; un solo uso; Accept text/plain', async () => {
  const canje = crearCanje(rpcPg(pool));
  const { codigo } = await codigoDeErik();
  const r = await http(canje, { codigo }, { accept: 'text/plain' });
  assert.equal(r.status, 200); assert.match(r.body, /^bz_[0-9a-f]{64}$/); assert.equal(r.h['cache-control'], 'no-store');
  const lista = await tool(await cliente(r.body), 'leer', {});
  assert.ok(Array.isArray(lista.json.hilos) && lista.json.hilos.length >= 1);
  const otra = await http(canje, JSON.stringify({ codigo }));
  assert.equal(otra.status, 403); assert.ok(!/bz_/.test(otra.body));
  assert.equal((await http(canje, { codigo: 'bz_no' })).status, 400);
  assert.equal((await http(canje, 'no-json')).status, 400);
  const { rows } = await pool.query("select ip::text from auditoria where accion='codigo_config:canje_ok'");
  assert.equal(rows[0].ip, '198.51.100.9/32');
});
test('canje: código vencido no sirve', async () => {
  const { codigo, id } = await codigoDeErik(1);
  await pool.query("update codigos_config set vence_en=now()-interval '1 s' where id=$1", [id]);
  assert.equal((await http(crearCanje(rpcPg(pool)), { codigo })).status, 403);
});

test('reintentos: solo se reenvía a los destinos que fallaron (sin duplicados); error sin código HTTP', async () => {
  await pool.query("update notificaciones set estado='enviada'");
  await pool.query("update agentes set webhook_url='https://hooks.ejemplo.dev/b' where nombre='Agente B'");
  await pool.query("update agentes set webhook_url='https://caido.ejemplo.dev/c', webhook_secreto='whsec_c' where nombre='Ajeno'");
  await pool.query(`insert into agentes(id,buzon_id,nombre,webhook_url,webhook_secreto) values ('bbbbbbbb-0000-0000-0000-00000000000d','${BZ}','Agente D','https://caido.ejemplo.dev/d','whsec_d')`);
  await servicio.crear(T.a, { tipo: 'tarea', titulo: 'reintento' });
  const llamadas = []; let caido = true;
  const d = { rpc: rpcPg(pool, 'service_role'), claves: null, suscripciones: async () => [], borrarSuscripcion: async () => {},
    webhooks: async (b, ex) => (await pool.query('select id,webhook_url,webhook_secreto from agentes where buzon_id=$1 and webhook_url is not null and id is distinct from $2', [b, ex])).rows,
    resolver: async () => ['93.184.216.34'],
    enviar: async (url) => { llamadas.push(url); return url.includes('caido') && caido ? 500 : 200; } };
  await procesar(d);
  assert.deepEqual(llamadas.sort(), ['https://caido.ejemplo.dev/d', 'https://hooks.ejemplo.dev/b']);
  const { rows } = await pool.query("select estado, ultimo_error from notificaciones where estado='pendiente'");
  assert.deepEqual(rows, [{ estado: 'pendiente', ultimo_error: 'webhook_fallo' }]);
  caido = false; llamadas.length = 0;
  await pool.query("update notificaciones set proximo_intento=now() where estado='pendiente'");
  await procesar(d);
  assert.deepEqual(llamadas, ['https://caido.ejemplo.dev/d'], 'B ya recibido no se repite');
  assert.equal((await pool.query("select count(*)::int n from notificaciones where estado='pendiente'")).rows[0].n, 0);
});
test('adjuntos: la cuota se revisa ANTES de subir (nada llega al bucket) y mensaje_id inválido se rechaza', async () => {
  await pool.query(`insert into adjuntos(buzon_id,hilo_id,nombre,tipo,tamano,sha256,ruta) select '${BZ}','${hilo}','r.pdf','application/pdf',3145728,repeat('b',64),'relleno2/'||g from generate_series(1,33) g`);
  const antes = bucket.size; let subidas = 0;
  const dd = { ...deps(), subir: async () => { subidas++; } };
  const r = await manejar({ accion: 'subir', hilo_id: hilo, nombre: 'c.pdf', base64: Buffer.concat([PDF, Buffer.alloc(2_000_000)]).toString('base64') }, { token: T.a }, dd);
  assert.equal(r.status, 413); assert.equal(subidas, 0); assert.equal(bucket.size, antes);
  await pool.query("delete from adjuntos where ruta like 'relleno2/%'");
  assert.equal((await manejar({ accion: 'subir', hilo_id: hilo, mensaje_id: "x' or 1=1", nombre: 'a.pdf', base64: PDF.toString('base64') }, { token: T.a }, dd)).status, 400);
});

test('aprobar solo el cierre: mensajes entre IAs avisan por webhook (no al autor, sin push); pedir_cierre avisa al dueño', async () => {
  await pool.query("update agentes set webhook_url='https://hooks.ejemplo.dev/a', webhook_secreto='whsec_a' where nombre='Agente A'");
  await pool.query("update agentes set webhook_url='https://hooks.ejemplo.dev/b', webhook_secreto='whsec_b' where nombre='Agente B'");
  const h = await servicio.crear(T.a, { tipo: 'tarea', titulo: 'Revisa mi código' });
  await pool.query("update notificaciones set estado='enviada'");
  const rev = await servicio.responder(T.b, { hilo_id: h.id, cuerpo: 'Revisado: dos cambios' });
  assert.equal(rev.estado, 'abierto', 'el mensaje no necesita aprobación');
  const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const claves = { publica: Buffer.from(await crypto.subtle.exportKey('raw', vk.publicKey)).toString('base64url'), privada: (await crypto.subtle.exportKey('jwk', vk.privateKey)).d, sujeto: 'mailto:t@t.t' };
  const llamadas = [];
  const deps = {
    rpc: rpcPg(pool, 'service_role'), claves, enviar: async (url, ip, headers, body) => { llamadas.push({ url, headers, body }); return 201; },
    suscripciones: async (b) => (await pool.query('select id,endpoint,p256dh,auth from push_suscripciones where buzon_id=$1', [b])).rows,
    borrarSuscripcion: async () => {},
    webhooks: async (b, ex) => (await pool.query('select id,webhook_url,webhook_secreto from agentes where buzon_id=$1 and webhook_url is not null and id is distinct from $2', [b, ex])).rows,
    resolver: async (x) => ({ 'hooks.ejemplo.dev': ['93.184.216.34'], 'fcm.googleapis.com': ['142.250.1.1'] })[x] ?? [],
  };
  assert.equal((await procesar(deps)).procesadas, 1);
  assert.equal(llamadas.filter((l) => /fcm/.test(l.url)).length, 0, 'un mensaje entre IAs no hace sonar el teléfono');
  const wh = llamadas.filter((l) => l.url.startsWith('https://hooks.'));
  assert.deepEqual(wh.map((l) => l.url), ['https://hooks.ejemplo.dev/a'], 'avisa a A (la otra IA), no a B (autor)');
  assert.equal(JSON.parse(wh[0].body).evento, 'mensaje_nuevo');
  assert.ok(await verificar('whsec_a', wh[0].body, wh[0].headers['X-Buzon-Firma']));
  llamadas.length = 0;
  assert.equal((await servicio.responder(T.a, { hilo_id: h.id, cuerpo: 'Aplicados, terminamos', accion: 'pedir_cierre' })).estado, 'pide_cierre');
  await procesar(deps);
  assert.ok(llamadas.some((l) => /fcm/.test(l.url)), 'pedir cierre sí avisa al dueño por push');
  assert.deepEqual(llamadas.filter((l) => l.url.startsWith('https://hooks.')).map((l) => l.url), ['https://hooks.ejemplo.dev/b'], 'el mensaje de A avisa solo a B');
  const { tools } = await (await cliente(T.a)).listTools();
  const resp = tools.find((t) => t.name === 'responder');
  assert.ok(resp.inputSchema.properties.accion.enum.includes('pedir_cierre') && !resp.inputSchema.properties.accion.enum.some((a) => /cerrar|aprobar$/.test(a)));
  assert.match(resp.description, /Solo el humano cierra/);
});

test('borrar agente: solo el dueño; su clave deja de servir por MCP; el hilo sigue como "agente eliminado"', async () => {
  const comoUsuario = async (uid, sql, params) => {
    const c = await pool.connect();
    try {
      await c.query('begin'); await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      const r = await c.query(sql, params); await c.query('commit'); return r;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  };
  const A = await cliente(T.a);
  const h = await tool(A, 'crear', { tipo: 'tarea', titulo: 'Hilo de A antes de borrarlo' });
  assert.equal(h.error, false, h.texto);
  // un intruso (otro dueño) no puede
  await assert.rejects(comoUsuario(OTRO, 'select borrar_agentes($1)', [['bbbbbbbb-0000-0000-0000-00000000000a']]), /sin permiso/);
  // una IA tampoco: no hay herramienta para borrar
  const { tools } = await A.listTools();
  assert.ok(!tools.some((t) => /borr|elimin|delete/i.test(t.name)), tools.map((t) => t.name).join());
  const r = await comoUsuario(ERIK, 'select borrar_agentes($1) n', [['bbbbbbbb-0000-0000-0000-00000000000a']]);
  assert.equal(r.rows[0].n, 1);
  const A2 = await cliente(T.a);
  const l = await tool(A2, 'leer', {});
  assert.equal(l.error, true, 'la clave revocada ya no debe funcionar');
  const B = await cliente(T.b);
  const visto = await tool(B, 'leer', { hilo_id: h.json.id });
  assert.equal(visto.error, false, visto.texto);
  assert.equal(visto.json.hilo.titulo, 'Hilo de A antes de borrarlo');
  const aud = await pool.query(`select count(*)::int n from auditoria where accion='agente:borrar' and objeto_id=$1`, ['bbbbbbbb-0000-0000-0000-00000000000a']);
  assert.equal(aud.rows[0].n, 1);
});
