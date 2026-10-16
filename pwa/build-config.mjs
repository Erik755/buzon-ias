// Build de la PWA: genera dist/ solo con los archivos que se publican (nada de build-config, vercel.json ni ejemplos).
import { writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(1); }
const payload = Buffer.from((SUPABASE_ANON_KEY.split('.')[1] || ''), 'base64').toString();
if (/service_role/.test(payload) || SUPABASE_ANON_KEY.startsWith('sb_secret_')) { console.error('¡Eso es una clave secreta! No.'); process.exit(1); }
const d = (p) => new URL('./' + p, import.meta.url);
rmSync(d('dist'), { recursive: true, force: true });
mkdirSync(d('dist/vendor'), { recursive: true });
for (const f of ['index.html', 'app.js', 'estilo.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'vendor/supabase.js', 'guias.js', 'privacidad.html', 'terminos.html', 'offline.html', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) copyFileSync(d(f), d('dist/' + f));
writeFileSync(d('dist/config.js'), `export const SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};export const SUPABASE_ANON_KEY=${JSON.stringify(SUPABASE_ANON_KEY)};export const MCP_URL=${JSON.stringify(process.env.MCP_URL || 'https://buzon-ias-mcp.vercel.app/api/mcp')};\n`);
console.log('dist/ listo');
