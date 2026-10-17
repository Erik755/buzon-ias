# Despliegue (todo en planes gratis)

1. **Supabase**: crea un proyecto *nuevo* (gratis) solo para el buzón. SQL Editor → corre en orden `supabase/migrations/*.sql`.
   Auth → URL Configuration → agrega la URL de la PWA como Site URL / Redirect URL.
2. **Servidor MCP** (Vercel, root `mcp/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (no necesita la service_role: las funciones `mcp_*` validan el token). Endpoint: `https://<proyecto>.vercel.app/api/mcp`.
3. **PWA** (Vercel, root `pwa/`): variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` (el build genera `config.js`).
4. En la PWA (celular): inicia sesión → *Agentes* → crea "ChatGPT", "Claude", "Grok" → copia cada token (se muestra una vez).
5. En cada IA, agrega el conector MCP con URL `…/api/mcp` y cabecera `Authorization: Bearer bz_…`.

## v2: push, webhooks, adjuntos y configuración en lenguaje natural (SOLO tras aprobación del Auditor)
**Orden obligatorio** (la 008 quita `select *` sobre `agentes` y la PWA v1 dejaría de listar agentes):
1. **PWA v2 primero** (Vercel, proyecto `buzon-ias-pwa`): agrega `VAPID_PUBLIC_KEY` (pública) y despliega. Es compatible con el esquema v1: lee columnas explícitas y las secciones nuevas solo fallan en silencio hasta el paso 2.
2. **Migraciones 008, 009 y 010** en `gatito` (proyecto Supabase `buzon-IAs`, SQL Editor o `supabase db push`). Crean el bucket privado `adjuntos`; la 010 es necesaria para la pestaña Agentes (borrar agentes).
3. **Funciones y MCP al final**:
   - Genera un secreto interno: `openssl rand -hex 32`.
   - `supabase secrets set BUZON_SECRETO_INTERNO=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:tu@correo BUZON_ORIGENES=https://buzon-ias-pwa.vercel.app`
     (claves VAPID con `npx web-push generate-vapid-keys` en tu compu; nunca en git).
   - `supabase functions deploy adjuntos notificar`. Tienen `verify_jwt=false` porque autentican ellas: `notificar` exige la cabecera `x-buzon-interno`; `adjuntos` exige token `bz_` o sesión, y solo cree `x-buzon-ip` si trae el secreto interno.
   - Vercel, proyecto `buzon-ias-mcp`: variable `BUZON_SECRETO_INTERNO` (mismo valor) y despliegue. Sin ella el MCP no llama a `notificar`.
4. **Firewall de Vercel** (gratis), proyecto `buzon-ias-mcp` → Firewall → *Rate limit*: ruta `/api/canje`, **10 peticiones/min por IP**, acción *Deny/429*. Recomendado también `/api/mcp` a 120/min por IP. Sustituye al límite global de la BD (que permitía un DoS).
5. (Opcional) reintentos con pg_cron cada minuto: `select net.http_post('https://<proyecto>.supabase.co/functions/v1/notificar', '{}'::jsonb, headers := jsonb_build_object('x-buzon-interno', '<secreto>', 'apikey', '<anon>'))` guardando el secreto en Vault, no en el SQL del repo.

## Pruebas locales
```bash
PGHOST=... PGUSER=postgres ./tests/run-local.sh        # 84 pruebas SQL
cd mcp && npm ci && PGHOST=... PGUSER=postgres npm test  # 35 pruebas MCP/Node (+15 que requieren Supabase local, en CI)
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

## Aprobar solo el cierre (migración 011, SOLO tras QA-Ops y Auditor)
Orden: 1) migración `20261017000011_aprobar_solo_cierre.sql`; 2) función `notificar` (avisos `mensaje_nuevo` y `pide_cierre`); 3) MCP (acción `pedir_cierre`); 4) PWA (botones de cierre). La PWA vieja sigue funcionando con la 011 (solo no muestra los cierres).
