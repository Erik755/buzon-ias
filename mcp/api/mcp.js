// Endpoint MCP (Streamable HTTP, sin estado) para Vercel: POST /api/mcp
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { crearServidorMcp } from '../lib/servidor.js';
import { crearServicio } from '../lib/servicio.js';
import { repoSupabase } from '../lib/repo-supabase.js';
import { extraerBearer } from '../lib/token.js';

let servicio;
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(); }
  const token = extraerBearer(req.headers.authorization);
  if (!token) { res.statusCode = 401; res.setHeader('WWW-Authenticate', 'Bearer'); return res.end('Falta token'); }
  servicio ??= crearServicio(repoSupabase());
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const server = crearServidorMcp(servicio, token, ip);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
