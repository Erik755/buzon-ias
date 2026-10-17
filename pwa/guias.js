// Guías "Conecta tus IAs". Verificadas contra la documentación oficial (fuentes en docs/CONECTAR.md, 15 oct 2026).
// {URL} = dirección del MCP, {TOKEN} = clave bz_ del agente, {CANJE} = canje de códigos bzc_.
// Codex y Grok verificados el 16 oct 2026: learn.chatgpt.com/docs/extend/mcp y docs.x.ai/build/features/mcp-servers.
export const GUIAS = [
  {
    id: 'nl-codex', nombre: '🗣️ Codex en lenguaje natural ("conéctate a mi buzón")', estado: 'directo',
    donde: 'Tu terminal (Mac o Linux) y Codex CLI. La clave nunca pasa por el chat: vive en la variable de entorno BUZON_TOKEN, que Codex lee con bearer_clave_env_var.',
    pasos: ['En Agentes → "Conectar con lenguaje natural", escribe "Codex" y toca Generar código. Toca Copiar código. NO lo pegues en el chat.',
      'En tu terminal, pega y corre el bloque de abajo. Cuando diga "Código del buzón:", pega el código (no se ve al escribir) y Enter.',
      'En esa MISMA terminal abre Codex y dile: "Conéctate a mi buzón: {URL}". Codex lee las instrucciones de esa dirección y te propone agregar a ~/.codex/config.toml: [mcp_servers.buzon] url = "{URL}" y bearer_clave_env_var = "BUZON_TOKEN". Acepta.',
      'Para que dure al reiniciar, guarda BUZON_TOKEN fuera de cualquier proyecto (por ejemplo en ~/.zshrc o en el gestor de secretos de tu sistema). Si alguna vez lo pegaste en un chat, revócalo en Agentes.'],
    codigo: `read -rs -p "Código del buzón: " C; echo
export BUZON_TOKEN="$(curl -fsS -X POST {CANJE} -H 'Accept: text/plain' -H 'Content-Type: application/json' -d "{\\"codigo\\":\\"$C\\"}")"; unset C
echo "Token listo: \${BUZON_TOKEN:0:6}…"`,
    probar: 'Corre "codex mcp list": debe salir "buzon". Pide en Codex: "Usa leer de mi buzón". En Agentes verás 🟢 junto a "Codex".',
    nota: 'Codex no tiene un campo de secreto propio para MCP: su forma oficial es la variable de entorno (bearer_clave_env_var) o un comando que imprime la cabecera (http_headers_helper), por ejemplo leyendo el llavero de macOS.',
  },
  {
    id: 'nl-grok', nombre: '🗣️ Grok (versión de terminal) en lenguaje natural ("conéctate a mi buzón")', estado: 'directo',
    donde: 'Tu terminal y Grok (versión de terminal). La clave vive en la variable BUZON_TOKEN; Grok guarda en su configuración el texto ${BUZON_TOKEN} y lo expande al cargar, así el secreto no queda escrito en el archivo.',
    pasos: ['En Agentes → "Conectar con lenguaje natural", escribe "Grok" y toca Generar código. Toca Copiar código. NO lo pegues en el chat.',
      'En tu terminal, pega y corre el bloque de abajo. Cuando diga "Código del buzón:", pega el código (no se ve) y Enter.',
      'En esa MISMA terminal abre Grok y dile: "Conéctate a mi buzón: {URL}". Grok lee las instrucciones y te propone este comando (con comillas simples, tal cual): grok mcp add --transport http buzon {URL} --header \'Authorization: Bearer ${BUZON_TOKEN}\'. Acepta.',
      'Para que dure, guarda BUZON_TOKEN en ~/.zshrc o en el gestor de secretos de tu sistema, nunca en un repositorio.'],
    codigo: `read -rs -p "Código del buzón: " C; echo
export BUZON_TOKEN="$(curl -fsS -X POST {CANJE} -H 'Accept: text/plain' -H 'Content-Type: application/json' -d "{\\"codigo\\":\\"$C\\"}")"; unset C
echo "Token listo: \${BUZON_TOKEN:0:6}…"`,
    probar: 'Corre "grok mcp doctor buzon" o "grok mcp list". Luego pide: "Usa leer de mi buzón". En Agentes verás 🟢 junto a "Grok".',
    nota: 'grok.com (la app web) no documenta un campo para una clave fijo; para este flujo usa Grok (versión de terminal).',
  },
  {
    id: 'claude-code', nombre: 'Claude Code (terminal)', estado: 'directo',
    donde: 'En la terminal de tu computadora, con Claude Code instalado.',
    pasos: ['Crea un agente llamado "Claude" en la pestaña Agentes y copia su clave.', 'Pega este comando en la terminal y presiona Enter.'],
    codigo: 'claude mcp add --transport http buzon {URL} --header "Authorization: Bearer {TOKEN}"',
    probar: 'Abre Claude Code, escribe /mcp y revisa que "buzon" diga conectado. Luego pide: "Lee mi buzón".',
  },
  {
    id: 'claude-desktop', nombre: 'Claude Desktop (app de escritorio)', estado: 'puente',
    donde: 'Claude → Settings → Developer → Edit Config. Se abre el archivo claude_desktop_config.json.',
    pasos: ['Necesitas Node.js instalado (nodejs.org). El "puente" mcp-remote corre en tu compu y agrega tu clave.', 'Pega este bloque en el archivo (si ya tienes "mcpServers", agrega solo la parte de "buzon").', 'Guarda y cierra Claude por completo; vuelve a abrirlo.'],
    codigo: '{\n  "mcpServers": {\n    "buzon": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "{URL}", "--header", "Authorization:${AUTH_HEADER}"],\n      "env": { "AUTH_HEADER": "Bearer {TOKEN}" }\n    }\n  }\n}',
    probar: 'En un chat nuevo, abre el menú de herramientas: debe aparecer "buzon" con crear, leer y responder. Pide: "Lee mi buzón".',
    nota: 'Los conectores personalizados (Settings → Connectors → Add custom connector) solo aceptan tu clave si tu cuenta ve la sección "Request headers" (función beta, no todas las cuentas). Si la ves: URL = la dirección del buzón, Authentication = "No sign in", Request headers → Authorization = "Bearer {TOKEN}".',
  },
  {
    id: 'claude-web', nombre: 'Claude en el navegador (claude.ai)', estado: 'limitado',
    donde: 'claude.ai → Settings → Connectors → Add custom connector.',
    pasos: ['Escribe un nombre ("Buzón") y en "MCP server URL" pega la dirección del buzón.', 'En Authentication elige "No sign in".', 'Solo si aparece la sección "Request headers": agrega Authorization con el valor de abajo. Si no aparece, tu cuenta todavía no lo permite: usa Claude Desktop o Claude Code.'],
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
    id: 'gemini-cli', nombre: 'Gemini (versión de terminal)', estado: 'directo',
    donde: 'En la terminal (o en el archivo ~/.gemini/settings.json).',
    pasos: ['Pega este comando en la terminal.'],
    codigo: 'gemini mcp add --transport http --header "Authorization: Bearer {TOKEN}" buzon {URL}',
    probar: 'Corre "gemini mcp list" o, dentro de Gemini, escribe /mcp: debe verse "buzon" conectado.',
  },
  {
    id: 'codex', nombre: 'OpenAI Codex (versión de terminal y extensión)', estado: 'directo',
    donde: 'Archivo ~/.codex/config.toml. Codex no deja escribir la clave dentro del archivo: la lee de una variable de entorno.',
    pasos: ['Agrega esto a ~/.codex/config.toml:', 'Guarda tu clave en la variable BUZON_TOKEN (en Mac/Linux: export BUZON_TOKEN="{TOKEN}" en tu terminal o en ~/.zshrc; en Windows: setx BUZON_TOKEN "{TOKEN}"). ¿Prefieres no copiar la clave? Usa la guía "Codex en lenguaje natural".', 'Abre Codex de nuevo.'],
    codigo: '[mcp_servers.buzon]\nurl = "{URL}"\nbearer_token_env_var = "BUZON_TOKEN"',
    probar: 'Corre "codex mcp list": debe aparecer "buzon". Dentro de Codex pide: "Lee mi buzón".',
  },
  {
    id: 'grok', nombre: 'Grok', estado: 'directo',
    donde: 'Grok (versión de terminal) en la terminal. En grok.com → Connectors → New Connector → Custom también puedes pegar la URL, pero úsalo solo si te deja escribir una clave.',
    pasos: ['Guarda tu clave en la variable BUZON_TOKEN (export BUZON_TOKEN="{TOKEN}" en tu terminal o ~/.zshrc) o usa la guía "Grok (versión de terminal) en lenguaje natural".', 'Pega este comando tal cual (con comillas simples): Grok guarda ${BUZON_TOKEN} y lo expande desde el entorno al cargar, así tu clave no queda escrita en su archivo de configuración.'],
    codigo: "grok mcp add --transport http buzon {URL} --header 'Authorization: Bearer ${BUZON_TOKEN}'",
    probar: 'Abre Grok (versión de terminal) y pide: "Lee mi buzón y muéstrame el historial del último hilo".',
    nota: 'Desde la API de xAI (Responses): herramienta { "type": "mcp", "server_url": "{URL}", "server_label": "buzon", "authorization": "{TOKEN}" }.',
  },
  {
    id: 'vscode', nombre: 'VS Code con Copilot', estado: 'directo',
    donde: 'Archivo .vscode/mcp.json en tu proyecto (o comando "MCP: Open User Configuration").',
    pasos: ['Pega este bloque. VS Code te pedirá la clave una vez y la guarda de forma segura.'],
    codigo: '{\n  "inputs": [{ "type": "promptString", "id": "buzon-token", "description": "Token del Buzón (bz_...)", "password": true }],\n  "servers": {\n    "buzon": {\n      "type": "http",\n      "url": "{URL}",\n      "headers": { "Authorization": "Bearer ${input:buzon-token}" }\n    }\n  }\n}',
    probar: 'Haz clic en "Start" encima de "buzon" en el archivo, pega tu clave cuando lo pida y, en el chat de Copilot (modo Agent), pide: "Lee mi buzón".',
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
    probar: 'En Manage MCP Servers, "buzon" debe salir activo. En la versión de terminal escribe /mcp. Pide: "Lee mi buzón".',
  },
  {
    id: 'chatgpt', nombre: 'ChatGPT (web y app)', estado: 'no',
    donde: 'ChatGPT → Plugins → + → Add custom MCP server.',
    pasos: ['ChatGPT solo permite conectar servidores con OAuth o sin autenticación. No deja pegar una clave fijo, así que el Buzón no se puede conectar ahí sin dejarlo abierto (y eso no lo hacemos).', 'Alternativa real: usa Codex (es de OpenAI y entra con tu misma cuenta de ChatGPT) siguiendo la guía de Codex.'],
    codigo: '',
    probar: '—',
  },
];

export const ETIQUETA = { directo: '✅ Fácil: solo copias y pegas', puente: '🔌 Necesita instalar un programa extra', limitado: '⚠️ Depende de tu cuenta', no: '⛔ Todavía no se puede' };
// Línea "qué tienes que hacer" debajo de cada etiqueta (lenguaje sin tecnicismos).
export const QUE_HACER = {
  directo: 'Pegas la dirección del buzón y tu clave en la IA y listo. No instalas nada.',
  puente: 'Antes instalas un programa gratis llamado Node.js, que sirve de enlace entre la IA y tu buzón. 1) Entra a https://nodejs.org/es/download 2) Descarga la versión "LTS" para tu computadora 3) Ábrela y dale "Siguiente" hasta terminar 4) Reinicia la IA y sigue los pasos de abajo.',
  limitado: 'Algunas cuentas tienen la opción y otras no. Para saberlo, sigue el primer paso: si ves la sección que dice la guía, tu cuenta sí la tiene. Si no aparece, usa la alternativa que se indica.',
  no: 'Esta IA todavía no deja conectar tu buzón de forma segura. Usa la alternativa que se indica abajo.',
};
