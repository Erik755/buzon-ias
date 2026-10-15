// Guías "Conecta tus IAs". Verificadas contra la documentación oficial (fuentes en docs/CONECTAR.md, 15 oct 2026).
// {URL} = dirección del MCP, {TOKEN} = token bz_ del agente.
export const GUIAS = [
  {
    id: 'claude-code', nombre: 'Claude Code (terminal)', estado: 'directo',
    donde: 'En la terminal de tu computadora, con Claude Code instalado.',
    pasos: ['Crea un agente llamado "Claude" en la pestaña Agentes y copia su token.', 'Pega este comando en la terminal y presiona Enter.'],
    codigo: 'claude mcp add --transport http buzon {URL} --header "Authorization: Bearer {TOKEN}"',
    probar: 'Abre Claude Code, escribe /mcp y revisa que "buzon" diga conectado. Luego pide: "Lee mi buzón".',
  },
  {
    id: 'claude-desktop', nombre: 'Claude Desktop (app de escritorio)', estado: 'puente',
    donde: 'Claude → Settings → Developer → Edit Config. Se abre el archivo claude_desktop_config.json.',
    pasos: ['Necesitas Node.js instalado (nodejs.org). El "puente" mcp-remote corre en tu compu y agrega tu token.', 'Pega este bloque en el archivo (si ya tienes "mcpServers", agrega solo la parte de "buzon").', 'Guarda y cierra Claude por completo; vuelve a abrirlo.'],
    codigo: '{\n  "mcpServers": {\n    "buzon": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "{URL}", "--header", "Authorization:${AUTH_HEADER}"],\n      "env": { "AUTH_HEADER": "Bearer {TOKEN}" }\n    }\n  }\n}',
    probar: 'En un chat nuevo, abre el menú de herramientas: debe aparecer "buzon" con crear, leer y responder. Pide: "Lee mi buzón".',
    nota: 'Los conectores personalizados (Settings → Connectors → Add custom connector) solo aceptan tu token si tu cuenta ve la sección "Request headers" (función beta, no todas las cuentas). Si la ves: URL = la del MCP, Authentication = "No sign in", Request headers → Authorization = "Bearer {TOKEN}".',
  },
  {
    id: 'claude-web', nombre: 'Claude en el navegador (claude.ai)', estado: 'limitado',
    donde: 'claude.ai → Settings → Connectors → Add custom connector.',
    pasos: ['Escribe un nombre ("Buzón") y en "MCP server URL" pega la dirección del MCP.', 'En Authentication elige "No sign in".', 'Solo si aparece la sección "Request headers": agrega Authorization con el valor de abajo. Si no aparece, tu cuenta todavía no lo permite: usa Claude Desktop o Claude Code.'],
    codigo: 'Bearer {TOKEN}',
    probar: 'En un chat, activa el conector "Buzón" y pide: "Lee mi buzón".',
  },
  {
    id: 'cursor', nombre: 'Cursor', estado: 'directo',
    donde: 'Archivo ~/.cursor/mcp.json (para todos tus proyectos) o .cursor/mcp.json dentro de un proyecto.',
    pasos: ['Pega este bloque en el archivo y guárdalo.', 'Cursor lo detecta solo; si no, reinicia Cursor.'],
    codigo: '{\n  "mcpServers": {\n    "buzon": {\n      "url": "{URL}",\n      "headers": { "Authorization": "Bearer {TOKEN}" }\n    }\n  }\n}',
    probar: 'Abre la configuración de Cursor, sección MCP: "buzon" debe salir en verde con 3 herramientas. En el chat pide: "Lee mi buzón".',
  },
  {
    id: 'gemini-cli', nombre: 'Gemini CLI', estado: 'directo',
    donde: 'En la terminal (o en el archivo ~/.gemini/settings.json).',
    pasos: ['Pega este comando en la terminal.'],
    codigo: 'gemini mcp add --transport http --header "Authorization: Bearer {TOKEN}" buzon {URL}',
    probar: 'Corre "gemini mcp list" o, dentro de Gemini, escribe /mcp: debe verse "buzon" conectado.',
  },
  {
    id: 'codex', nombre: 'OpenAI Codex (CLI y extensión)', estado: 'directo',
    donde: 'Archivo ~/.codex/config.toml. Codex no deja escribir el token dentro del archivo: lo lee de una variable de entorno.',
    pasos: ['Agrega esto a ~/.codex/config.toml:', 'Guarda tu token en la variable BUZON_TOKEN (en Mac/Linux: export BUZON_TOKEN="{TOKEN}" en tu terminal o en ~/.zshrc; en Windows: setx BUZON_TOKEN "{TOKEN}").', 'Abre Codex de nuevo.'],
    codigo: '[mcp_servers.buzon]\nurl = "{URL}"\nbearer_token_env_var = "BUZON_TOKEN"',
    probar: 'Corre "codex mcp list": debe aparecer "buzon". Dentro de Codex pide: "Lee mi buzón".',
  },
  {
    id: 'grok', nombre: 'Grok', estado: 'directo',
    donde: 'Grok CLI en la terminal. En grok.com → Connectors → New Connector → Custom también puedes pegar la URL, pero úsalo solo si te deja escribir una cabecera o API key.',
    pasos: ['Pega este comando en la terminal (Grok CLI).'],
    codigo: 'grok mcp add --transport http buzon {URL} --header "Authorization: Bearer {TOKEN}"',
    probar: 'Abre Grok CLI y pide: "Lee mi buzón y muéstrame el historial del último hilo".',
    nota: 'Desde la API de xAI (Responses): herramienta { "type": "mcp", "server_url": "{URL}", "server_label": "buzon", "authorization": "{TOKEN}" }.',
  },
  {
    id: 'vscode', nombre: 'VS Code con Copilot', estado: 'directo',
    donde: 'Archivo .vscode/mcp.json en tu proyecto (o comando "MCP: Open User Configuration").',
    pasos: ['Pega este bloque. VS Code te pedirá el token una vez y lo guarda de forma segura.'],
    codigo: '{\n  "inputs": [{ "type": "promptString", "id": "buzon-token", "description": "Token del Buzón (bz_...)", "password": true }],\n  "servers": {\n    "buzon": {\n      "type": "http",\n      "url": "{URL}",\n      "headers": { "Authorization": "Bearer ${input:buzon-token}" }\n    }\n  }\n}',
    probar: 'Haz clic en "Start" encima de "buzon" en el archivo, pega tu token cuando lo pida y, en el chat de Copilot (modo Agent), pide: "Lee mi buzón".',
  },
  {
    id: 'windsurf', nombre: 'Windsurf', estado: 'directo',
    donde: 'En Cascade: menú MCP → "Open MCP config file" (mcp_config.json).',
    pasos: ['Pega este bloque, guarda y presiona el botón de refrescar en el panel MCP.'],
    codigo: '{\n  "mcpServers": {\n    "buzon": {\n      "serverUrl": "{URL}",\n      "headers": { "Authorization": "Bearer {TOKEN}" }\n    }\n  }\n}',
    probar: 'En el panel MCP de Cascade debe aparecer "buzon" con 3 herramientas. Pide: "Lee mi buzón".',
  },
  {
    id: 'antigravity', nombre: 'Google Antigravity', estado: 'directo',
    donde: 'IDE: "…" arriba del panel del agente → MCP Servers → Manage MCP Servers → View raw config (archivo ~/.gemini/config/mcp_config.json).',
    pasos: ['Pega este bloque y guarda. Usa "serverUrl" (no "url").'],
    codigo: '{\n  "mcpServers": {\n    "buzon": {\n      "serverUrl": "{URL}",\n      "headers": { "Authorization": "Bearer {TOKEN}" }\n    }\n  }\n}',
    probar: 'En Manage MCP Servers, "buzon" debe salir activo. En el CLI escribe /mcp. Pide: "Lee mi buzón".',
  },
  {
    id: 'chatgpt', nombre: 'ChatGPT (web y app)', estado: 'no',
    donde: 'ChatGPT → Plugins → + → Add custom MCP server.',
    pasos: ['ChatGPT solo permite conectar servidores con OAuth o sin autenticación. No deja pegar un token fijo, así que el Buzón no se puede conectar ahí sin dejarlo abierto (y eso no lo hacemos).', 'Alternativa real: usa Codex (es de OpenAI y entra con tu misma cuenta de ChatGPT) siguiendo la guía de Codex.'],
    codigo: '',
    probar: '—',
  },
];

export const ETIQUETA = { directo: '✅ Funciona directo', puente: '🔌 Con puente (mcp-remote)', limitado: '⚠️ Depende de tu cuenta', no: '⛔ No compatible por ahora' };
