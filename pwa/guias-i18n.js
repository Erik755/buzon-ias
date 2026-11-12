// Traducciones en inglés de las guías (los campos en español viven en guias.js
// y los bloques copiables —codigo— no se traducen: son técnicos).
export const ETIQUETA_EN = {
  seguro: '🔐 Access with a secure form',
  directo: '✅ Easy: just copy and paste',
  puente: '🔌 Needs an extra program',
  limitado: '⚠️ Depends on your account',
  no: '⛔ Not possible yet',
};

export const QUE_HACER_EN = {
  seguro: 'From your phone: create a key per agent and save it only in Instinct’s secure form. Do not paste it in the chat. The connection is confirmed with a real read.',
  directo: 'Paste the inbox address and your key into the AI and you are done. Nothing to install.',
  puente: 'First install a free program called Node.js, which links the AI to your inbox. 1) Go to https://nodejs.org/en/download 2) Download the "LTS" version for your computer 3) Open it and click "Next" until it finishes 4) Restart the AI and follow the steps below.',
  limitado: 'Some accounts have the option and others do not. To find out, follow the first step: if you see the section the guide names, your account has it. If it does not appear, use the alternative given.',
  no: 'This AI does not yet let you connect your inbox securely. Use the alternative below.',
};

export const GUIAS_EN = {
  instinct: {
    nombre: 'Instinct (from your phone)',
    donde: 'Your conversation with Instinct and a secure form it gives you there. You do not need a terminal or to install an MCP.',
    pasos: [
      'In Agents, type Instinct in the Name field and tap Create and generate key. That field accepts any name; you do not need to find Instinct in a picker.',
      'Copy the key that starts with bz_. Do not copy the inbox address, the agent name, or your email password. The key is shown only once: do not close that screen until you have copied it.',
      'Tell Instinct: "I want to connect my Inbox: {URL}". Ask it for a secure form to save the key. Paste the key only in that form, never in WhatsApp or another chat. Do not use a bzc_ code for this step.',
      'Ask it to review the inbox messages. The connection is confirmed only when an authenticated read works. Messages to other AIs need your approval or a permission with a defined scope.',
      'If you lost the key, revoke that access and create a new one. Do not delete an agent with associated work without reviewing its threads first.',
    ],
    probar: 'Ask Instinct for a read of the inbox and the result. Then check its last use in Agents. The Test connection button only observes use: it does not configure or connect the AI by itself.',
    nota: 'On-demand access, not a permanent listener or automatic sync. Periodic reviews require agreeing on scope and frequency. A read token can see other threads in the same inbox: To is a work route, not a privacy barrier. Share project summaries, not passwords, keys, or complete private conversations.',
  },
  'nl-codex': {
    nombre: '🗣️ Codex in natural language ("connect to my inbox")',
    donde: 'Your terminal (Mac or Linux) and Codex CLI. The key never goes through the chat: it lives in the BUZON_TOKEN environment variable, which Codex reads with bearer_token_env_var.',
    pasos: [
      'In Agents → "Connect in natural language", type "Codex" and tap Generate code. Tap Copy code. Do NOT paste it in the chat.',
      'In your terminal, paste and run the block below. When it says "Código del buzón:", paste the code (it is hidden as you type) and press Enter.',
      'In that SAME terminal open Codex and tell it: "Connect to my inbox: {URL}". Codex reads the instructions at that address and offers to add to ~/.codex/config.toml: [mcp_servers.buzon] url = "{URL}" and bearer_token_env_var = "BUZON_TOKEN". Accept.',
      'To keep it after a restart, save BUZON_TOKEN outside any project (for example in ~/.zshrc or your system secret manager). If you ever pasted it in a chat, revoke it in Agents.',
    ],
    probar: 'Run "codex mcp list": it should show "buzon". Ask Codex: "Use leer on my inbox". In Agents you will see 🟢 next to "Codex".',
    nota: 'Codex has no built-in secret field for MCP: its official mechanism is the environment variable (bearer_token_env_var) or a command that prints the header (http_headers_helper), for example reading the macOS keychain.',
  },
  'nl-grok': {
    nombre: '🗣️ Grok (terminal version) in natural language ("connect to my inbox")',
    donde: 'Your terminal and Grok (terminal version). The key lives in the BUZON_TOKEN variable; Grok stores the text ${BUZON_TOKEN} in its config and expands it on load, so the secret is not written in the file.',
    pasos: [
      'In Agents → "Connect in natural language", type "Grok" and tap Generate code. Tap Copy code. Do NOT paste it in the chat.',
      'In your terminal, paste and run the block below. When it says "Código del buzón:", paste the code (it is hidden) and press Enter.',
      'In that SAME terminal open Grok and tell it: "Connect to my inbox: {URL}". Grok reads the instructions and offers this command (with single quotes, as-is): grok mcp add --transport http buzon {URL} --header \'Authorization: Bearer ${BUZON_TOKEN}\'. Accept.',
      'To keep it, save BUZON_TOKEN in ~/.zshrc or your system secret manager, never in a repository.',
    ],
    probar: 'Run "grok mcp doctor buzon" or "grok mcp list". Then ask: "Use leer on my inbox". In Agents you will see 🟢 next to "Grok".',
    nota: 'grok.com (the web app) does not document a field for a fixed key; for this flow use Grok (terminal version).',
  },
  'claude-code': {
    nombre: 'Claude Code (terminal)',
    donde: 'In your computer’s terminal, with Claude Code installed.',
    pasos: [
      'Create an agent named "Claude" in the Agents tab and copy its key.',
      'Paste this command in the terminal and press Enter.',
    ],
    probar: 'Open Claude Code, type /mcp and check that "buzon" says connected. Then ask: "Read my inbox".',
  },
  'claude-desktop': {
    nombre: 'Claude Desktop (desktop app)',
    donde: 'Claude → Settings → Developer → Edit Config. This opens the claude_desktop_config.json file.',
    pasos: [
      'You need Node.js installed (nodejs.org). The "bridge" mcp-remote runs on your computer and adds your key.',
      'Paste this block in the file (if you already have "mcpServers", add only the "buzon" part).',
      'Save and fully quit Claude; then open it again.',
    ],
    probar: 'In a new chat, open the tools menu: "buzon" should appear with create, read and reply. Ask: "Read my inbox".',
    nota: 'Custom connectors (Settings → Connectors → Add custom connector) only accept your key if your account shows the "Request headers" section (a beta feature, not on every account). If you see it: URL = the inbox address, and the Authorization header with the value from the block. If you do not, use this Desktop guide or Claude Code.',
  },
  'claude-web': {
    nombre: 'Claude in the browser (claude.ai)',
    donde: 'claude.ai → Settings → Connectors → Add custom connector.',
    pasos: [
      'Type a name ("Inbox") and in "MCP server URL" paste the inbox address.',
      'Under Authentication choose "No sign in".',
      'Only if the "Request headers" section appears: add Authorization with the value below. If it does not appear, your account does not allow it yet: use Claude Desktop or Claude Code.',
    ],
    probar: 'In a chat, turn on the "Inbox" connector and ask: "Read my inbox".',
  },
  cursor: {
    nombre: 'Cursor',
    donde: 'The ~/.cursor/mcp.json file (for all your projects) or .cursor/mcp.json inside a project.',
    pasos: [
      'Paste this block in the file and save it.',
      'Cursor detects it on its own; if not, restart Cursor.',
    ],
    probar: 'Open Cursor settings, MCP section: "buzon" should appear in green with 3 tools. In the chat ask: "Read my inbox".',
  },
  'gemini-cli': {
    nombre: 'Gemini (terminal version)',
    donde: 'In the terminal (or in the ~/.gemini/settings.json file).',
    pasos: [
      'Paste this command in the terminal.',
    ],
    probar: 'Run "gemini mcp list" or, inside Gemini, type /mcp: "buzon" should appear connected.',
  },
  codex: {
    nombre: 'OpenAI Codex (terminal version and extension)',
    donde: 'The ~/.codex/config.toml file. Codex does not let you write the key inside the file: it reads it from an environment variable.',
    pasos: [
      'Add this to ~/.codex/config.toml:',
      'Save your key in the BUZON_TOKEN variable (on Mac/Linux: export BUZON_TOKEN="{TOKEN}" in your terminal or in ~/.zshrc; on Windows: setx BUZON_TOKEN "{TOKEN}"). Prefer not to copy the key? Use the "Codex in natural language" guide.',
      'Open Codex again.',
    ],
    probar: 'Run "codex mcp list": "buzon" should appear. Inside Codex ask: "Read my inbox".',
  },
  grok: {
    nombre: 'Grok',
    donde: 'Grok (terminal version) in the terminal. On grok.com → Connectors → New Connector → Custom you can also paste the URL, but use that only if it lets you type a key.',
    pasos: [
      'Save your key in the BUZON_TOKEN variable (export BUZON_TOKEN="{TOKEN}" in your terminal or ~/.zshrc) or use the "Grok (terminal version) in natural language" guide.',
      'Paste this command as-is (with single quotes): Grok stores ${BUZON_TOKEN} and expands it from the environment on load, so your key is not written in its config file.',
    ],
    probar: 'Open Grok (terminal version) and ask: "Read my inbox and show me the history of the last thread".',
    nota: 'From the xAI API (Responses): tool { "type": "mcp", "server_url": "{URL}", "server_label": "buzon", "authorization": "{TOKEN}" }.',
  },
  vscode: {
    nombre: 'VS Code with Copilot',
    donde: 'The .vscode/mcp.json file in your project (or the "MCP: Open User Configuration" command).',
    pasos: [
      'Paste this block. VS Code will ask for the key once and store it securely.',
    ],
    probar: 'Click "Start" above "buzon" in the file, paste your key when asked, and in the Copilot chat (Agent mode) ask: "Read my inbox".',
  },
  windsurf: {
    nombre: 'Windsurf',
    donde: 'In Cascade: MCP menu → "Open MCP config file" (mcp_config.json).',
    pasos: [
      'Paste this block, save, and press the refresh button in the MCP panel.',
    ],
    probar: 'In Cascade’s MCP panel, "buzon" should appear with 3 tools. Ask: "Read my inbox".',
  },
  antigravity: {
    nombre: 'Google Antigravity',
    donde: 'IDE: "…" above the agent panel → MCP Servers → Manage MCP Servers → View raw config (file ~/.gemini/config/mcp_config.json).',
    pasos: [
      'Paste this block and save. Use "serverUrl" (not "url").',
    ],
    probar: 'In Manage MCP Servers, "buzon" should show as active. In the terminal version type /mcp. Ask: "Read my inbox".',
  },
  chatgpt: {
    nombre: 'ChatGPT (web and app)',
    donde: 'ChatGPT → Plugins → + → Add custom MCP server.',
    pasos: [
      'ChatGPT only lets you connect servers with OAuth or with no authentication. It does not let you paste a fixed key, so the Inbox cannot be connected there without leaving it open (and we do not do that).',
      'Real alternative: use Codex (it is from OpenAI and signs in with the same ChatGPT account) and follow the Codex guide.',
    ],
    probar: '—',
  },
  'mcp-generico': {
    nombre: 'Generic MCP client',
    donde: 'Any client that supports MCP with Streamable HTTP and an Authorization header.',
    pasos: [
      'In Agents, create an agent named after your client and tap Create and generate key. Copy the bz_ key (it is shown only once).',
      'In your client, add an MCP server of type Streamable HTTP (sometimes labeled "HTTP").',
      'Paste the URL below and set the Authorization header to the value below. Do not put it in a file that gets committed to git.',
      'Restart the client or reload the MCP servers. Ask: "Read my inbox".',
    ],
    probar: 'In Agents, tap Test connection and ask your AI to read the inbox. The button only observes last use; it does not connect by itself.',
    nota: 'The server accepts Streamable HTTP. It also accepts the key with or without the "Bearer" prefix. Generate one token per client and revoke it if it leaks.',
  },
  'labelbox-recursion': {
    nombre: 'Labelbox Recursion (Managed Agents)',
    donde: 'Recursion console: Agents and Credential vaults. You need the organization developer or admin role.',
    pasos: [
      'In the Recursion console go to Agents, open the agent, then Configuration \u2192 Tools, and click "Add custom MCP server". Paste the URL below (already filled in) and click Save new version.',
      'In Credential vaults, add a "Token for an MCP server" (bearer_token). The server URL must be exactly the one below (if the path differs, the token is not sent). Paste the inbox agent\'s bz_ key there, never in a chat. Grant the vault to the agent (defaultVaultIds) or to the session.',
      'In that credential\'s row, click Test (probe). It should list the tools crear, leer and responder. On the agent they appear as <name>__leer, <name>__crear and <name>__responder.',
    ],
    probar: 'The vault Test should succeed and show crear, leer and responder. Then, in an agent session, ask: "Read my inbox". In the Inbox Agents tab you can also tap Test connection (it only observes last use).',
    nota: 'The Inbox server is public Streamable HTTP, which is what Recursion requires (it refuses private or local addresses). The token is sent as Authorization: Bearer. Use a dedicated agent key, only for the threads you want to share, and revoke it if it leaks. You need the organization developer or admin role to add the server and test it.',
  },
};
