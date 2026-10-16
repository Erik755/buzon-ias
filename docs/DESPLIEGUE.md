# Despliegue (todo en planes gratis)

1. **Supabase**: crea un proyecto *nuevo* (gratis) solo para el buzón. SQL Editor → corre en orden `supabase/migrations/*.sql`.
   Auth → URL Configuration → agrega la URL de la PWA como Site URL / Redirect URL.
2. **Servidor MCP** (Vercel, root `mcp/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (no necesita la service_role: las funciones `mcp_*` validan el token). Endpoint: `https://<proyecto>.vercel.app/api/mcp`.
3. **PWA** (Vercel, root `pwa/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (el build genera `config.js`).
4. En la PWA (celular): inicia sesión → *Agentes* → crea "ChatGPT", "Claude", "Grok" → copia cada token (se muestra una vez).
5. En cada IA, agrega el conector MCP con URL `…/api/mcp` y cabecera `Authorization: Bearer bz_…`.

## v2: push, webhooks, adjuntos y configuración en lenguaje natural (SOLO tras aprobación del Auditor)
1. Migraciones aditivas: `20261016000008_push_webhooks_adjuntos.sql` y `20261016000009_codigos_config.sql` (crean el bucket privado `adjuntos`).
   ⚠️ La 008 restringe las columnas que `authenticated` puede leer de `agentes` (oculta `webhook_secreto`): la PWA vieja usa `select('*')` y dejaría de listar agentes. **Aplicar la migración y desplegar la PWA v2 juntas.**
2. Edge Functions: `supabase functions deploy adjuntos notificar` (plan gratis). `verify_jwt=false` está en `supabase/config.toml` porque cada función autentica por su cuenta.
3. Claves VAPID: `npx web-push generate-vapid-keys` en tu compu (no en git).
   - Secretos de Supabase: `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:tu@correo BUZON_ORIGENES=https://buzon-ias-pwa.vercel.app`
   - Vercel (proyecto PWA): `VAPID_PUBLIC_KEY` (es pública).
4. (Opcional) pg_cron cada minuto para reintentos: Integrations → Cron → job que hace `net.http_post` a `…/functions/v1/notificar`. El MCP ya la llama tras cada crear/responder.
5. Vercel MCP: sin variables nuevas. Expone `GET /api/mcp` (autodescubrimiento), `/.well-known/buzon-ias` y `POST /api/canje`.

## Pruebas locales
```bash
PGHOST=... PGUSER=postgres ./tests/run-local.sh        # 79 pruebas SQL
cd mcp && npm ci && PGHOST=... PGUSER=postgres npm test  # 29 pruebas MCP/Node (+13 que requieren Supabase local, en CI)
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
