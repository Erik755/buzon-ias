// Copia a config.js (NO se sube a git) o genéralo en el build de Vercel con `node build-config.mjs`.
// La anon key es pública por diseño; la seguridad la da RLS. NUNCA pongas aquí la service_role.
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'TU_ANON_KEY';
export const MCP_URL = 'https://TU-MCP.vercel.app/api/mcp';
export const VAPID_PUBLIC_KEY = ''; // clave PÚBLICA VAPID (opcional). La privada solo en secrets de Supabase.
