// Prueba de INTEGRACIÓN del cliente del panel Forge (forge/src/comun.js, el código real de
// producción) contra el servidor MCP del repo levantado EN LOCAL, con Postgres local
// desechable y tokens de prueba. NUNCA contra producción.
// Cubre: éxito, hilo ajeno, token revocado y respuesta SSE — con llamadas tools/call directas,
// sin initialize ni Mcp-Session-Id, que es como el panel llamará en producción.
//
// Requiere Postgres local (ver scripts/integracion-local.sh) y `npm ci` en mcp/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import pg from 'pg';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { crearServidorMcp } from '../lib/servidor.js';
import { crearServicio, rpcPg } from '../lib/servicio.js';
import { extraerBearer, hashToken, nuevoToken } from '../lib/token.js';
import { leerEnBuzon, ErrorPanel, MCP_URL } from '../../forge/src/comun.js';

const raiz = new URL('../../', import.meta.url).pathname;
const DB = 'buzon_int_' + process.pid;
const ERIK = '11111111-1111-1111-1111-111111111111', OTRO = '22222222-2222-2222-2222-222222222222';
const BZ = 'aaaaaaaa-0000-0000-0000-000000000001', BZ2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const T = { a: nuevoToken(), ajeno: nuevoToken(), revocado: nuevoToken() };
let admin, pool, servicio, servidor, base;

// Mismo flujo que api/mcp.js (Streamable HTTP sin estado), pero con rpcPg local.
async function atender(req, res) {
  const token = extraerBearer(req.headers.authorization);
  if (!token) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    return res.end('Falta token o token inválido');
  }
  let crudo = '';
  req.on('data', (c) => { crudo += c; });
  req.on('end', async () => {
    const server = crearServidorMcp(servicio, token, '127.0.0.1');
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, crudo ? JSON.parse(crudo) : undefined);
  });
}

// fetch real de Node contra el servidor LOCAL: la URL de producción se sustituye solo en
// transporte; toda la lógica de leerEnBuzon (headers, parseo, errores) es la de producción.
const fetchLocal = (url, opts) => fetch(base + new URL(url).pathname, opts);
let tipoRespuestaSse = null;
const fetchLocalSse = async (url, opts) => {
  const r = await fetch(base + new URL(url).pathname, { ...opts, headers: { ...opts.headers, accept: 'text/event-stream' } });
  tipoRespuestaSse = r.headers.get('content-type');
  return r;
};

let HILO;

before(async () => {
  admin = new pg.Client({ database: 'postgres' }); await admin.connect();
  await admin.query(`create database ${DB}`);
  pool = new pg.Pool({ database: DB, max: 4 });
  await pool.query(readFileSync(raiz + 'tests/local/00_supabase_shim.sql', 'utf8'));
  for (const f of readdirSync(raiz + 'supabase/migrations').sort()) await pool.query(readFileSync(raiz + 'supabase/migrations/' + f, 'utf8'));
  await pool.query(`insert into auth.users values ('${ERIK}','erik'),('${OTRO}','otro');
    insert into buzones(id,dueno_id,nombre) values ('${BZ}','${ERIK}','Erik'),('${BZ2}','${OTRO}','Otro')`);
  for (const [id, b, n, t] of [['bbbbbbbb-0000-0000-0000-00000000000a', BZ, 'Agente A', T.a],
    ['bbbbbbbb-0000-0000-0000-00000000000c', BZ2, 'Ajeno', T.ajeno],
    ['bbbbbbbb-0000-0000-0000-00000000000d', BZ, 'Revocado', T.revocado]]) {
    await pool.query('insert into agentes(id,buzon_id,nombre) values($1,$2,$3)', [id, b, n]);
    await pool.query('insert into tokens(agente_id,hash_token) values($1,$2)', [id, hashToken(t)]);
  }
  // El token revocado existió y se revocó (se borra la fila).
  await pool.query("delete from tokens where agente_id='bbbbbbbb-0000-0000-0000-00000000000d'");
  servicio = crearServicio(rpcPg(pool), null);
  // Hilo de prueba creado por el propio servicio (como lo haría una IA real).
  const creado = await servicio.crear(T.a, { tipo: 'tarea', titulo: 'Integración panel Forge' }, '127.0.0.1');
  HILO = creado.id;
  servidor = http.createServer(atender);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}/api/mcp`;
});

after(async () => {
  if (servidor) await new Promise((ok) => servidor.close(ok));
  await pool?.end();
  await admin.query(`drop database if exists ${DB}`);
  await admin.end();
});

test('integración: éxito — el token lee su hilo (tools/call directo, sin initialize)', async () => {
  const h = await leerEnBuzon(fetchLocal, T.a, { hilo_id: HILO });
  assert.equal(h.hilo.titulo, 'Integración panel Forge');
  assert.equal(h.hilo.estado, 'abierto');
});

test('integración: hilo ajeno — el token de OTRO buzón no lo lee', async () => {
  await assert.rejects(
    () => leerEnBuzon(fetchLocal, T.ajeno, { hilo_id: HILO }),
    (e) => e instanceof ErrorPanel && /sin acceso/.test(e.message),
  );
});

test('integración: token revocado — la validación SQL lo rechaza como "sin acceso"', async () => {
  await assert.rejects(
    () => leerEnBuzon(fetchLocal, T.revocado, { hilo_id: HILO }),
    (e) => e instanceof ErrorPanel && /sin acceso/.test(e.message),
  );
});

// El transporte MCP exige que Accept incluya application/json Y text/event-stream; un cliente
// que pida solo SSE recibe 406. La rama de parseo SSE de comun.js es defensiva y se cubre en
// las pruebas unitarias; aquí se documenta el comportamiento real del servidor ante ese caso.
test('integración: Accept solo-SSE — el servidor responde 406 y el cliente da error limpio', async () => {
  await assert.rejects(
    () => leerEnBuzon(fetchLocalSse, T.a, { hilo_id: HILO }),
    (e) => e instanceof ErrorPanel && /HTTP 406/.test(e.message),
  );
});
