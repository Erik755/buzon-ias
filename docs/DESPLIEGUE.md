# Despliegue (todo en planes gratis)

1. **Supabase**: crea un proyecto *nuevo* (gratis) solo para el buzón. SQL Editor → corre en orden `supabase/migrations/*.sql`.
   Auth → URL Configuration → agrega la URL de la PWA como Site URL / Redirect URL.
2. **Servidor MCP** (Vercel, root `mcp/`): variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Endpoint: `https://<proyecto>.vercel.app/api/mcp`.
3. **PWA** (Vercel, root `pwa/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (el build genera `config.js`).
4. En la PWA (celular): inicia sesión → *Agentes* → crea "ChatGPT", "Claude", "Grok" → copia cada token (se muestra una vez).
5. En cada IA, agrega el conector MCP con URL `…/api/mcp` y cabecera `Authorization: Bearer bz_…`.

## Pruebas locales
```bash
PGHOST=... PGUSER=postgres ./tests/run-local.sh        # 27 pruebas SQL
cd mcp && npm ci && PGHOST=... PGUSER=postgres npm test  # 8 pruebas MCP
```
