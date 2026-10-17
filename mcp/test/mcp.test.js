// Pruebas de integración del servidor MCP contra Postgres local (ver tests/run-local.sh).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { crearServicio, rpcPg } from '../lib/servicio.js';
import { crearServidorMcp } from '../lib/servidor.js';
import { hashToken, nuevoToken } from '../lib/token.js';

const raiz = new URL('../../', import.meta.url).pathname;
const DB = 'buzon_mcp_' + process.pid;
let admin, pool, servicio;
const ERIK = '11111111-1111-1111-1111-111111111111', OTRO = '22222222-2222-2222-2222-222222222222';
const T = { chatgpt: nuevoToken(), claude: nuevoToken(), ajeno: nuevoToken(), revocado: nuevoToken() };

before(async () => {
  admin = new pg.Client({ database: 'postgres' }); await admin.connect();
  await admin.query(`create database ${DB}`);
  pool = new pg.Pool({ database: DB, max: 4 });
  const sql = (f) => pool.query(readFileSync(f, 'utf8'));
  await sql(raiz + 'tests/local/00_supabase_shim.sql');
  for (const f of readdirSync(raiz + 'supabase/migrations').sort()) await sql(raiz + 'supabase/migrations/' + f);
  await pool.query(`insert into auth.users values ($1,'erik'),($2,'otro');
    insert into buzones(id,dueno_id,nombre) values ('aaaaaaaa-0000-0000-0000-000000000001',$1,'Erik'),('aaaaaaaa-0000-0000-0000-000000000002',$2,'Otro');
    `.replace(/\$1/g, `'${ERIK}'`).replace(/\$2/g, `'${OTRO}'`));
  const ag = async (id, b, n, tok, extra = '') => {
    await pool.query('insert into agentes(id,buzon_id,nombre) values($1,$2,$3)', [id, b, n]);
    await pool.query(`insert into tokens(agente_id,hash_token${extra ? ',revocado_en' : ''}) values($1,$2${extra ? ',now()' : ''})`, [id, hashToken(tok)]);
  };
  await ag('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ChatGPT', T.chatgpt);
  await ag('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Claude', T.claude);
  await ag('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Intruso', T.ajeno);
  await ag('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Viejo', T.revocado, 'rev');
  servicio = crearServicio(rpcPg(pool));
});
after(async () => { await pool?.end(); await admin.query(`drop database if exists ${DB}`); await admin.end(); });

async function cliente(token) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await crearServidorMcp(servicio, token, '127.0.0.1').connect(a);
  const c = new Client({ name: 'test', version: '1' }); await c.connect(b); return c;
}
const llamar = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError && !/\[\d{3}\]/.test(r.content[0].text)) console.error(r.content[0].text);
  return { error: !!r.isError, texto: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) };
};

test('expone exactamente 3 herramientas', async () => {
  const c = await cliente(T.chatgpt);
  assert.deepEqual((await c.listTools()).tools.map((t) => t.name).sort(), ['crear', 'leer', 'responder']);
});

let hiloId;
test('flujo demo: ChatGPT crea, Claude toma y pide aprobación, Erik aprueba, se ve el historial', async () => {
  const gpt = await cliente(T.chatgpt), claude = await cliente(T.claude);
  const r = await llamar(gpt, 'crear', { tipo: 'tarea', titulo: 'Resumir manual CNC', contexto: 'Capítulo 3' });
  assert.equal(r.error, false); hiloId = r.json.id;
  assert.equal((await llamar(claude, 'leer', {})).json.hilos[0].id, hiloId);
  assert.equal((await llamar(claude, 'responder', { hilo_id: hiloId, cuerpo: 'Lo tomo', accion: 'tomar' })).json.estado, 'tomado');
  assert.equal((await llamar(claude, 'responder', { hilo_id: hiloId, cuerpo: 'Listo, ¿apruebas?', accion: 'pedir_aprobacion' })).json.estado, 'pide_aprobacion');
  // Erik aprueba como en la PWA (rol authenticated con su sub)
  const c = await pool.connect();
  try {
    await c.query("set role authenticated; select set_config('request.jwt.claim.sub',$1,false)".replace('$1', `'${ERIK}'`));
    await c.query("insert into aprobaciones(hilo_id,humano_id,decision,nota) values ($1,$2,'aprobado','Va')", [hiloId, ERIK]);
    await c.query('reset role');
  } finally { c.release(); }
  const h = await llamar(gpt, 'leer', { hilo_id: hiloId });
  assert.equal(h.json.hilo.estado, 'aprobado');
  assert.equal(h.json.mensajes.length, 2);
  assert.equal(h.json.aprobaciones[0].decision, 'aprobado');
});

test('negativa: token de otro buzón no ve ni responde el hilo de Erik', async () => {
  const x = await cliente(T.ajeno);
  assert.equal((await llamar(x, 'leer', {})).json.hilos.length, 0);
  assert.match((await llamar(x, 'leer', { hilo_id: hiloId })).texto, /404/);
  assert.match((await llamar(x, 'responder', { hilo_id: hiloId, cuerpo: 'hack' })).texto, /404/);
});

test('negativa: token revocado, inventado o sin Bearer falla', async () => {
  assert.match((await llamar(await cliente(T.revocado), 'leer', {})).texto, /403/);
  assert.match((await llamar(await cliente(nuevoToken()), 'leer', {})).texto, /403/);
  assert.match((await llamar(await cliente(null), 'leer', {})).texto, /401/);
});

test('negativa: token vencido falla', async () => {
  await pool.query("update tokens set vence_en = now() - interval '1 second' where hash_token=$1", [hashToken(T.claude)]);
  assert.match((await llamar(await cliente(T.claude), 'leer', {})).texto, /403/);
  await pool.query("update tokens set vence_en = now() + interval '1 day' where hash_token=$1", [hashToken(T.claude)]);
});

test('negativa: una IA no puede aprobar (no existe la acción y el esquema la rechaza)', async () => {
  const c = await cliente(T.claude);
  const r = await llamar(c, 'crear', { tipo: 'decision', titulo: 'x' });
  const ap = await c.callTool({ name: 'responder', arguments: { hilo_id: r.json.id, cuerpo: 'auto', accion: 'aprobar' } });
  assert.equal(ap.isError, true);
  assert.equal((await llamar(c, 'leer', { hilo_id: r.json.id })).json.hilo.estado, 'abierto');
});

test('negativa: límite de tasa (60/min)', async () => {
  await pool.query("insert into auditoria(buzon_id,actor,accion) select 'aaaaaaaa-0000-0000-0000-000000000001','agente:bbbbbbbb-0000-0000-0000-000000000001','relleno' from generate_series(1,60)");
  await assert.rejects(() => servicio.leer(T.chatgpt, {}), (e) => e.codigo === 429);
});

test('negativa: anon no lee tablas directo ni llama funciones internas', async () => {
  const c = await pool.connect();
  try {
    await c.query('set role anon');
    await assert.rejects(() => c.query('select * from hilos'), /permission denied/);
    await assert.rejects(() => c.query("select _mcp_ctx('x','leer',null)"), /permission denied/);
  } finally { await c.query('reset role'); c.release(); }
});

test('extraerBearer acepta "Bearer bz_" y "bz_" y rechaza lo demás', async () => {
  const { extraerBearer } = await import('../lib/token.js');
  const t = 'bz_' + 'a'.repeat(43);
  assert.equal(extraerBearer('Bearer ' + t), t); assert.equal(extraerBearer(t), t);
  assert.equal(extraerBearer('Basic ' + t), null); assert.equal(extraerBearer('Bearer abc'), null); assert.equal(extraerBearer(undefined), null);
});

test('todo queda en auditoría', async () => {
  const { rows } = await pool.query("select count(*)::int n from auditoria where actor like 'agente:%'");
  assert.ok(rows[0].n >= 8);
});

test('lo que me toca: crear con para, leer sin argumentos da resumen corto con horas; estado "todos"; reglas en las instrucciones', async () => {
  // Agentes nuevos: los de arriba ya gastaron su límite de 60/min en la prueba de tasa.
  const tg = nuevoToken(), tc = nuevoToken();
  for (const [id, n, t] of [['bbbbbbbb-0000-0000-0000-0000000000d1', 'Gepeto', tg], ['bbbbbbbb-0000-0000-0000-0000000000d2', 'Clara', tc]]) {
    await pool.query('insert into agentes(id,buzon_id,nombre) values($1,$2,$3)', [id, 'aaaaaaaa-0000-0000-0000-000000000001', n]);
    await pool.query('insert into tokens(agente_id,hash_token) values($1,$2)', [id, hashToken(t)]);
  }
  const gpt = await cliente(tg), claude = await cliente(tc);
  const r = await llamar(gpt, 'crear', { tipo: 'tarea', titulo: 'Revisa el capítulo 4', para: 'clara' });
  assert.equal(r.error, false, r.texto); assert.equal(r.json.para, 'Clara');
  const mal = await llamar(gpt, 'crear', { tipo: 'tarea', titulo: 'x', para: 'Nadie' });
  assert.equal(mal.error, true); assert.match(mal.texto, /^\[400\]/);
  const l = (await llamar(claude, 'leer', {})).json;
  const h = l.hilos.find((x) => x.id === r.json.id);
  assert.equal(l.hilos[0].motivo, 'para_ti'); assert.ok(h);
  assert.equal(h.para, 'Clara'); assert.equal(h.creado_por, 'Gepeto'); assert.equal(h.estado_texto, 'Abierto');
  assert.match(h.creado_en, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[-+]\d\d:\d\d$/); assert.match(h.ultima_actividad_cdmx, /hora de CDMX/);
  assert.ok(!('mensajes' in h) && !('contexto' in h), 'sin historial');
  assert.ok(!(await llamar(gpt, 'leer', {})).json.hilos.some((x) => x.id === r.json.id), 'a ChatGPT no le toca lo que mandó a Claude');
  assert.ok((await llamar(gpt, 'leer', { estado: 'todos' })).json.hilos.some((x) => x.id === r.json.id));
  const otro = await llamar(claude, 'crear', { tipo: 'tarea', titulo: 'Solo para Gepeto', para: 'Gepeto' });
  await llamar(gpt, 'responder', { hilo_id: otro.json.id, cuerpo: 'Gepeto trabajando' });
  assert.ok(!(await llamar(claude, 'leer', {})).json.hilos.some((x) => x.id === otro.json.id), 'lo dirigido a otra IA no le toca');
  const libre = await llamar(gpt, 'crear', { tipo: 'tarea', titulo: 'Sin dueño' });
  await llamar(claude, 'leer', { hilo_id: libre.json.id });
  await llamar(claude, 'responder', { hilo_id: libre.json.id, cuerpo: 'Lo tomo', accion: 'tomar' });
  const tomado = (await llamar(claude, 'leer', {})).json.hilos.find((x) => x.id === libre.json.id);
  assert.equal(tomado?.motivo, 'tomado_por_ti');
  const abierto = (await llamar(claude, 'leer', { hilo_id: libre.json.id })).json;
  assert.match(abierto.mensajes[0].creado_en_cdmx, /hora de CDMX/);
  const ins = claude.getInstructions();
  assert.match(ins, /nunca los abras todos/); assert.match(ins, /Nunca uses leer sin argumentos como prueba/);
  const { tools } = await claude.listTools();
  assert.ok(tools.find((t) => t.name === 'crear').inputSchema.properties.para);
  assert.ok(tools.find((t) => t.name === 'leer').inputSchema.properties.estado.enum.includes('todos'));
});
