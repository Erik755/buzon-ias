// Guías "Conecta tus IAs". Verificadas contra la documentación oficial (fuentes en docs/CONECTAR.md, 15 oct 2026).
// {URL} = dirección del MCP, {TOKEN} = clave bz_ del agente, {CANJE} = canje de códigos bzc_.
// Codex y Grok verificados el 16 oct 2026: learn.chatgpt.com/docs/extend/mcp y docs.x.ai/build/features/mcp-servers.
export const GUIAS = [
  {
    id: 'instinct', nombre: 'Instinct (desde tu celular)', estado: 'seguro',
    donde: 'Tu conversación con Instinct y un formulario seguro que te proporciona ahí. No necesitas terminal ni instalar un MCP.',
    pasos: ['En Agentes, escribe Instinct en el campo Nombre y toca Crear y generar clave. Ese campo acepta cualquier nombre; no necesitas encontrar Instinct en un selector.',
      'Copia la clave que empieza por bz_. No copies la dirección del buzón, el nombre del agente ni tu contraseña de correo. La clave se muestra una sola vez: no cierres esa pantalla hasta copiarla.',
      'Dile a Instinct: "Quiero conectar mi Buzón: {URL}". Pídele un formulario seguro para guardar la clave. Pega la clave únicamente en ese formulario, nunca en WhatsApp ni en otro chat. No uses un código bzc_ para este paso.',
      'Pídele revisar los mensajes del buzón. La conexión se confirma solo cuando una lectura autenticada funciona. Los mensajes a otras IAs requieren tu aprobación o un permiso con alcance definido.',
      'Si perdiste la clave, revoca ese acceso y crea uno nuevo. No borres un agente con trabajo asociado sin revisar antes sus hilos.'],
    codigo: '',
    probar: 'Pide a Instinct una lectura del buzón y el resultado. Luego revisa su último uso en Agentes. El botón Probar conexión solo observa el uso: no configura ni conecta a la IA por sí solo.',
    nota: 'Acceso bajo pedido, no escucha permanente ni sincronización automática. Las revisiones periódicas requieren acordar alcance y frecuencia. Un token de lectura puede ver otros hilos del mismo buzón: Para es una ruta de trabajo, no una barrera de privacidad. Comparte resúmenes de proyectos, no contraseñas, claves ni conversaciones privadas completas.',
  },
  {
    id: 'nl-codex', nombre: '🗣️ Codex en lenguaje natural ("conéctate a mi buzón")', estado: 'directo',
    donde: 'Tu terminal (Mac o Linux) y Codex CLI. La clave nunca pasa por el chat: vive en la variable de entorno BUZON_TOKEN, que Codex lee con bearer_token_env_var.',
    pasos: ['En Agentes → "Conectar con lenguaje natural", escribe "Codex" y toca Generar código. Toca Copiar código. NO lo pegues en el chat.',
      'En tu terminal, pega y corre el bloque de abajo. Cuando diga "Código del buzón:", pega el código (no se ve al escribir) y Enter.',
      'En esa MISMA terminal abre Codex y dile: "Conéctate a mi buzón: {URL}". Codex lee las instrucciones de esa dirección y te propone agregar a ~/.codex/config.toml: [mcp_servers.buzon] url = "{URL}" y bearer_token_env_var = "BUZON_TOKEN". Acepta.',
      'Para que dure al reiniciar, guarda BUZON_TOKEN fuera de cualquier proyecto (por ejemplo en ~/.zshrc o en el gestor de secretos de tu sistema). Si alguna vez lo pegaste en un chat, revócalo en Agentes.'],
    codigo: `read -rs -p "Código del buzón: " C; echo
export BUZON_TOKEN="$(curl -fsS -X POST {CANJE} -H 'Accept: text/plain' -H 'Content-Type: application/json' -d "{\\"codigo\\":\\"$C\\"}")"; unset C
echo "Token listo: \${BUZON_TOKEN:0:6}…"`,
    probar: 'Corre "codex mcp list": debe salir "buzon". Pide en Codex: "Usa leer de mi buzón". En Agentes verás 🟢 junto a "Codex".',
    nota: 'Codex no tiene un campo de secreto propio para MCP: su forma oficial es la variable de entorno (bearer_token_env_var) o un comando que imprime la cabecera (http_headers_helper), por ejemplo leyendo el llavero de macOS.',
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
    id: 'hostinger', nombre: 'Hostinger (Agente en hPanel)', estado: 'limitado',
    donde: 'En hPanel, dentro del Agente de Hostinger: pestaña Apps → Connections → Custom MCP servers → Add server. No se agrega desde el chat del Agente; si se lo pides ahí, te responde que no puede registrar servidores.',
    pasos: ['En Agentes del Buzón, crea un agente llamado "Hostinger" y copia su clave bz_. No la pegues en el chat del Agente de Hostinger ni en capturas.',
      'En Connections → Custom MCP servers → Add server: Nombre "Buzón" y Dirección del servidor: {URL}.',
      'Activa "Este servidor necesita una clave API o un token de portador" y abre el enlace "Mi proveedor utiliza un encabezado personalizado".',
      'Nombre del encabezado: Authorization (ya viene escrito). En Clave escribe Bearer, un espacio normal de la barra espaciadora, y tu token bz_ a continuación, todo en la misma casilla. Sin guion bajo entre Bearer y el token; los guiones bajos que ya trae el token sí se quedan.',
      'Guarda. Cuando Hostinger acepta el servidor, la conexión aparece en verde como "Conectado".'],
    codigo: 'Authorization: Bearer {TOKEN}',
    probar: 'Pide en el chat del Agente: "Usa la conexión Buzón para mostrarme los títulos de hasta 3 hilos. No crees, respondas, apruebes ni cierres nada." Cada acción por un MCP personalizado consume créditos del modo Agent, aunque la tarea sea simple.',
    nota: 'Las conexiones (apps y MCP personalizados) están incluidas en la suscripción Agent Plus: si ves un candado y "Upgrade to Agent Plus", tu plan no la incluye. Límites: 5 servidores MCP personalizados y 50 herramientas por servidor. Alta verificada el 13 nov 2026 (quedó "Conectado"); la lectura de herramientas queda pendiente de una prueba real. Fuente: https://www.hostinger.com/support/connect-apps-and-custom-mcp-servers-to-hostinger-agent/',
  },
  {
    id: 'chatgpt', nombre: 'ChatGPT (web y app)', estado: 'no',
    donde: 'ChatGPT → Plugins → + → Add custom MCP server.',
    pasos: ['ChatGPT solo permite conectar servidores con OAuth o sin autenticación. No deja pegar una clave fijo, así que el Buzón no se puede conectar ahí sin dejarlo abierto (y eso no lo hacemos).', 'Alternativa real: usa Codex (es de OpenAI y entra con tu misma cuenta de ChatGPT) siguiendo la guía de Codex.'],
    codigo: '',
    probar: '—',
  },
  {
    id: 'mcp-generico', nombre: 'Cliente MCP genérico', estado: 'directo',
    donde: 'Cualquier cliente que soporte MCP con Streamable HTTP y una cabecera Authorization.',
    pasos: ['En Agentes, crea un agente con el nombre de tu cliente y toca Crear y generar clave. Copia la clave bz_ (se muestra una sola vez).',
      'En tu cliente, agrega un servidor MCP de tipo Streamable HTTP (a veces aparece como "HTTP").',
      'Pega la URL de abajo y configura la cabecera Authorization con el valor de abajo. No la pongas en un archivo que se suba a git.',
      'Reinicia el cliente o recarga los servidores MCP. Pide: "Lee mi buzón".'],
    codigo: 'URL: {URL}\nAuthorization: Bearer {TOKEN}',
    probar: 'En Agentes, toca Probar conexión y pide a tu IA que lea el buzón. El botón solo observa el último uso; no conecta por sí mismo.',
    nota: 'El servidor acepta Streamable HTTP. También acepta la clave con o sin el prefijo "Bearer". Genera un token por cliente y revócalo si se filtra.',
  },
  {
    // Verificado contra https://docs.labelbox.com/recursion/mcp-servers#connect-mcp-servers (11 nov 2026).
    id: 'labelbox-recursion', nombre: 'Labelbox Recursion (Managed Agents)', estado: 'directo',
    donde: 'Consola de Recursion: Agents y Credential vaults. Hace falta el rol de desarrollador o administrador de la organización.',
    pasos: [
      'En la consola de Recursion ve a Agents, abre el agente, entra a Configuration → Tools y toca "Add custom MCP server". Pega la URL de abajo (ya rellenada) y toca Save new version.',
      'En Credential vaults agrega un "Token for an MCP server" (bearer_token). La URL del servidor debe ser exactamente la de abajo (si cambia la ruta, el token no se envía). Pega ahí la clave bz_ del agente del Buzón, nunca en un chat. Concede la bóveda al agente (defaultVaultIds) o a la sesión.',
      'En la fila de esa credencial, toca Test (probe). Debe listar las herramientas crear, leer y responder. En el agente aparecen como <nombre>__leer, <nombre>__crear y <nombre>__responder.',
    ],
    codigo: '{URL}',
    probar: 'El Test de la bóveda debe salir bien y mostrar crear, leer y responder. Luego, en una sesión del agente, pide: "Lee mi buzón". En Agentes del Buzón también puedes tocar Probar conexión (solo observa el último uso).',
    nota: 'El servidor del Buzón es Streamable HTTP público, que es lo que Recursion exige (rechaza direcciones privadas o locales). El token se envía como Authorization: Bearer. Usa una clave de agente dedicada, solo para los hilos que quieras compartir, y revócala si se filtra. Hace falta el rol developer o admin de la organización para agregar el servidor y probarlo.',
  },
];

export const ETIQUETA = { seguro: '🔐 Acceso con formulario seguro', directo: '✅ Fácil: solo copias y pegas', puente: '🔌 Necesita instalar un programa extra', limitado: '⚠️ Depende de tu cuenta', no: '⛔ Todavía no se puede' };
// Línea "qué tienes que hacer" debajo de cada etiqueta (lenguaje sin tecnicismos).
export const QUE_HACER = {
  seguro: 'Desde el celular: crea una clave por agente y guárdala solo en el formulario seguro de Instinct. No la pegues en el chat. La conexión se comprueba con una lectura real.',
  directo: 'Pegas la dirección del buzón y tu clave en la IA y listo. No instalas nada.',
  puente: 'Antes instalas un programa gratis llamado Node.js, que sirve de enlace entre la IA y tu buzón. 1) Entra a https://nodejs.org/es/download 2) Descarga la versión "LTS" para tu computadora 3) Ábrela y dale "Siguiente" hasta terminar 4) Reinicia la IA y sigue los pasos de abajo.',
  limitado: 'Algunas cuentas tienen la opción y otras no. Para saberlo, sigue el primer paso: si ves la sección que dice la guía, tu cuenta sí la tiene. Si no aparece, usa la alternativa que se indica.',
  no: 'Esta IA todavía no deja conectar tu buzón de forma segura. Usa la alternativa que se indica abajo.',
};
