// Endpoint MCP (Streamable HTTP, sin estado) para Vercel: POST /api/mcp
// Solo usa la clave pública (anon) de Supabase; la credencial es el token bz_ de cada IA.
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { crearServidorMcp } from '../lib/servidor.js';
import { crearServicio, rpcSupabase } from '../lib/servicio.js';
import { extraerBearer } from '../lib/token.js';

let servicio;
export default async function handler(req, res) {
  if (req.method === 'GET' && !req.headers.authorization) { res.setHeader('Content-Type', 'application/json'); return res.end('{"servicio":"buzon-ias MCP","uso":"POST con Authorization: Bearer bz_..."}'); }
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(); }
  const token = extraerBearer(req.headers.authorization);
  if (!token) { res.statusCode = 401; res.setHeader('WWW-Authenticate', 'Bearer'); return res.end('Falta token'); }
  servicio ??= crearServicio(rpcSupabase(createClient));
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const server = crearServidorMcp(servicio, token, ip);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
