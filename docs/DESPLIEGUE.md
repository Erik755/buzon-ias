# Despliegue (todo en planes gratis)

1. **Supabase**: crea un proyecto *nuevo* (gratis) solo para el buzón. SQL Editor → corre en orden `supabase/migrations/*.sql`.
   Auth → URL Configuration → agrega la URL de la PWA como Site URL / Redirect URL.
2. **Servidor MCP** (Vercel, root `mcp/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (no necesita la service_role: las funciones `mcp_*` validan el token). Endpoint: `https://<proyecto>.vercel.app/api/mcp`.
3. **PWA** (Vercel, root `pwa/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (el build genera `config.js`).
4. En la PWA (celular): inicia sesión → *Agentes* → crea "ChatGPT", "Claude", "Grok" → copia cada token (se muestra una vez).
5. En cada IA, agrega el conector MCP con URL `…/api/mcp` y cabecera `Authorization: Bearer bz_…`.

## Pruebas locales
```bash
PGHOST=... PGUSER=postgres ./tests/run-local.sh        # 27 pruebas SQL
cd mcp && npm ci && PGHOST=... PGUSER=postgres npm test  # 9 pruebas MCP
```

## Producción actual
- MCP: https://buzon-ias-mcp.vercel.app/api/mcp
- PWA: https://buzon-ias-pwa.vercel.app
- Supabase: proyecto `gatito` (plan gratis). Las variables viven solo en Vercel.

## Cuenta del dueño (la PWA no crea usuarios)
La PWA usa `shouldCreateUser: false`: solo entran usuarios que ya existen.
1. Supabase → Authentication → Users → **Add user → Send invitation** a tu correo (o "Create new user").
2. Entra a la PWA con ese correo.
3. Después: Authentication → Sign In / Providers → desactiva **Allow new users to sign up**.
Recomendado: en Vercel → Firewall, regla de rate limit para `/api/mcp` (p. ej. 120/min por IP).
