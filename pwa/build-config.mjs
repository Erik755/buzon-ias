import { writeFileSync } from 'node:fs';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(1); }
if (/service_role/.test(Buffer.from((SUPABASE_ANON_KEY.split('.')[1] || ''), 'base64').toString())) { console.error('¡Eso es la service_role! No.'); process.exit(1); }
writeFileSync(new URL('./config.js', import.meta.url), `export const SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};export const SUPABASE_ANON_KEY=${JSON.stringify(SUPABASE_ANON_KEY)};\n`);
