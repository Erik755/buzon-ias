# Prueba de punta a punta contra producción

No corre en CI (usa producción). Crea todo dentro de un **usuario de prueba** (`*@buzon.test`), nunca toca el buzón de Erik y al final borra su buzón de prueba (agentes, tokens, hilos y mensajes). La auditoría queda (es solo de inserción, a propósito).

1. Usuario de prueba: créalo una vez en Supabase (Authentication → Users → Add user → Create new user, con "Auto confirm"), con un correo `e2e-…@buzon.test` y contraseña larga. No se necesita registro público.
2. Corre (Node 22+, Chromium instalado):
```bash
cd mcp && npm ci
E2E_EMAIL=e2e-bot@buzon.test E2E_PASSWORD='…' \
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY='<anon>' \
CHROME=/ruta/a/chrome SALIDA=../../e2e npm run e2e:prod
```
Graba video `.webm` y 4 capturas en `SALIDA`. 13 pasos: A crea → B lee, toma y pide aprobación → la IA intenta aprobar (2 formas, debe fallar) → se aprueba en la PWA (Pixel 7) → "Probar conexión" muestra 🟢 → el MCP confirma `aprobado`.
