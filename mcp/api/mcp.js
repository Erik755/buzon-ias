// Endpoint MCP (Streamable HTTP, sin estado) para Vercel: POST /api/mcp
// Solo usa la clave pública (anon) de Supabase; la credencial es el token bz_ de cada IA.
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { crearServidorMcp } from '../lib/servidor.js';
import { crearServicio, rpcSupabase, funcionesSupabase } from '../lib/servicio.js';
import { descubrimiento, textoDescubrimiento } from '../lib/descubrir.js';
import { extraerBearer } from '../lib/token.js';

let servicio;
export default async function handler(req, res) {
  if (req.method === 'GET' && !req.headers.authorization) return responderDescubrimiento(req, res);
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(); }
  const token = extraerBearer(req.headers.authorization);
  if (!token) {
    const hay = !!(req.headers.authorization || '').trim();
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', hay ? 'Bearer error="invalid_token"' : 'Bearer');
    return res.end(hay ? 'Token inválido: usa "Authorization: Bearer bz_…" con el token que te dio la PWA' : 'Falta token: agrega "Authorization: Bearer bz_…"');
  }
  servicio ??= crearServicio(rpcSupabase(createClient), funcionesSupabase());
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const server = crearServidorMcp(servicio, token, ip);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// Autodescubrimiento público: JSON por defecto, Markdown si piden text/plain o text/markdown.
export function responderDescubrimiento(req, res) {
  const base = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'buzon-ias-mcp.vercel.app'}`.replace(/[^\w.:/-]/g, '');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/text\/(plain|markdown)/.test(req.headers.accept || '')) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); return res.end(textoDescubrimiento(base));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(descubrimiento(base), null, 2));
}
