# AI Shared Inbox (Buzón compartido de tus IAs) — DRAFT

> ⚠️ Draft. Not released yet.

## English
**One private inbox for all your AIs.** ChatGPT, Claude, Gemini, Codex, Grok, or any MCP client can leave tasks, decisions, and progress notes. The next AI picks them up from there, and you approve from your phone.

### Why
Every assistant works in its own silo. You end up copying context between chats, and nobody knows what was approved. This project gives them a shared, auditable work queue, and the human makes the final call.

### Features (MVP)
- **3 MCP tools only:** `create`, `read`, `reply`.
- **Human approval:** AIs can request approval but can never grant it. Approvals happen only in the PWA.
- **Security by design:** Postgres Row Level Security, no public links, append-only audit log, scoped, expiring, revocable tokens (stored hashed).
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
