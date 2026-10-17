# AI Shared Inbox (Buzón compartido de tus IAs) — DRAFT

[![CI](https://github.com/Erik755/buzon-ias/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Erik755/buzon-ias/actions/workflows/ci.yml)

> ⚠️ Draft. Not released yet.

## English
**One private inbox for all your AIs.** ChatGPT, Claude, Gemini, Codex, Grok, or any MCP client can leave tasks, decisions, and progress notes. The next AI picks them up from there, and you approve from your phone.

### Why
Every assistant works in its own silo. You end up copying context between chats, and nobody knows what was approved. This project gives them a shared, auditable work queue, and the human makes the final call.

### Features (MVP)
- **3 MCP tools only:** `create`, `read`, `reply`.
- **Human approval:** AIs can request approval but can never grant it. Approvals happen only in the PWA.
- **Security by design:** Postgres Row Level Security, no public links, append-only audit log, scoped, expiring, revocable tokens (stored hashed).
- **v2 (in review):** attachments (PDF, PNG, JPG, WEBP, TXT, MD; real-type checked, 3 MB each, 100 MB/mailbox, private bucket, 5-minute signed links), Web Push notifications (VAPID, title only, opt-in button), optional per-agent HMAC-signed webhooks with SSRF protection, and natural-language setup: tell Grok or Codex "connect to my mailbox" + the MCP URL; a single-use `bzc_` code is swapped for the token in your terminal, never in the chat. Self-description at `GET /api/mcp`.
- **Free stack:** Vercel + Supabase + GitHub.
- **License:** MIT.

### How it works
```
ChatGPT --create--> [ Inbox (MCP on Vercel) + Supabase ] <--read/reply-- Claude
                                  |
                       PWA on your phone: Approve / Reject
                                  |
                        Grok --read--> full history
```

### Quick start (planned)
1. Deploy the Supabase migrations.
2. Deploy to Vercel and set the env vars.
3. Open the PWA, create an agent, and copy its token (shown once).
4. Add the MCP URL + token to your AI client.

### Status
Week-by-week plan in `plan-mvp.md`. Contributions welcome after the first public release.

---

## Español
**Un buzón privado para todas tus IAs.** ChatGPT, Claude, Gemini, Codex, Grok o cualquier cliente MCP dejan tareas, decisiones y avances. La siguiente IA los toma desde ahí, y tú apruebas desde el celular.

### Por qué
Cada asistente trabaja aislado. Terminas copiando contexto entre chats y nadie sabe qué se aprobó. Este proyecto les da una cola de trabajo compartida y auditable, y la decisión final la toma la persona.

### Funciones (MVP)
- **Solo 3 herramientas MCP:** `crear`, `leer`, `responder`.
- **Aprobación humana:** las IAs pueden pedir aprobación, pero nunca darla. Solo se aprueba en la PWA.
- **Seguridad desde el diseño:** reglas por fila (RLS) en Postgres, sin enlaces públicos, auditoría de solo escritura y tokens con alcance limitado, vencimiento y revocación (guardados como hash).
- **v2 (en revisión):** adjuntos (PDF, PNG, JPG, WEBP, TXT, MD; se valida el tipo real, 3 MB c/u, 100 MB por buzón, bucket privado y enlaces firmados de 5 min), avisos push (VAPID, solo título, se activan con un botón), webhook opcional por agente firmado con HMAC y protegido contra SSRF, y configuración en lenguaje natural: dile a Grok o Codex "conéctate a mi buzón" con la URL del MCP; un código `bzc_` de un solo uso se cambia por el token en tu terminal, nunca en el chat. Autodescripción en `GET /api/mcp`.
- **Stack gratis:** Vercel + Supabase + GitHub.
- **Licencia:** MIT.

### Cómo funciona
Igual que el diagrama de arriba: una IA crea, otra lee y responde, tú apruebas en el celular y cualquier IA autorizada ve el historial.

### Inicio rápido (planeado)
1. Aplica las migraciones de Supabase.
2. Despliega en Vercel y configura las variables de entorno.
3. Abre la PWA, crea un agente y copia su token (se muestra una sola vez).
4. Agrega la URL MCP y el token a tu cliente de IA.

### Estado
Plan por semanas en `plan-mvp.md`. Se aceptan contribuciones después de la primera versión pública.

## Conecta tus IAs (español)
La app tiene una pestaña **Conectar** con 5 pasos numerados: pegas tu clave (la contraseña de cada IA, que se saca en **Agentes**), eliges tu IA, tocas «Copiar», lo pegas donde dice la guía y tocas «Probar conexión». Resumen (detalles y fuentes en [`docs/CONECTAR.md`](docs/CONECTAR.md)):
- ✅ **Fácil: solo copias y pegas.** Pegas la dirección del buzón y tu clave en la IA y listo, sin instalar nada: Claude Code, Cursor, Gemini y Codex (en su versión de terminal, la ventana para escribir comandos), Grok (versión de terminal), VS Code con Copilot, Windsurf, Google Antigravity.
- 🔌 **Necesita instalar un programa extra.** Antes instalas Node.js, gratis, desde https://nodejs.org/es/download (versión «LTS»): Claude Desktop.
- ⚠️ **Depende de tu cuenta.** Si en los ajustes de conectores ves la sección que indica la guía, tu cuenta sí lo permite; si no, usa la alternativa: claude.ai y grok.com.
- ⛔ **Todavía no se puede.** ChatGPT (web y app) no deja poner una clave fija. Alternativa: Codex, que es de OpenAI y usa tu misma cuenta.

La pantalla inicial explica en 3 pasos qué es, cómo empezar y cómo aprobar, y cada pantalla vacía te dice qué hacer.

## Connect your AIs (English)
The PWA has a **Conectar** tab with step-by-step instructions and copy buttons for each AI. Summary (details and sources in [`docs/CONECTAR.md`](docs/CONECTAR.md)):
- ✅ **Easy: just copy and paste.** Paste the mailbox address and your key into the AI, nothing to install: Claude Code, Cursor, Gemini and Codex (terminal versions, i.e. used from the command window), Grok (terminal version), VS Code with Copilot, Windsurf, Google Antigravity.
- 🔌 **Needs an extra program.** First install free Node.js from https://nodejs.org/en/download (the "LTS" version): Claude Desktop.
- ⚠️ **Depends on your account.** If your connector settings show the section the guide mentions, your account supports it; otherwise use the alternative: claude.ai, grok.com.
- ⛔ **Not possible yet.** ChatGPT (web and app) doesn't accept a fixed key. Alternative: Codex, by OpenAI, with the same account.

The home screen explains in 3 steps what it is, how to start and how to approve; every empty screen tells you what to do next.

## Privacidad y términos / Privacy & terms
- Aviso de privacidad / Privacy notice: https://buzon-ias-pwa.vercel.app/privacidad.html ([fuente](pwa/privacidad.html))
- Términos de uso / Terms of use: https://buzon-ias-pwa.vercel.app/terminos.html ([fuente](pwa/terminos.html))
