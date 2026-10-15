# Conecta tus IAs al Buzón

Dirección del MCP: `https://buzon-ias-mcp.vercel.app/api/mcp` (Streamable HTTP).
Autenticación: cabecera `Authorization: Bearer bz_…`. El servidor también acepta `bz_…` sin "Bearer" (útil para la API de xAI).
Genera un token por IA en la PWA → **Agentes** (se muestra una sola vez). La PWA → **Conectar** arma cada bloque con tu token.

Verificado contra la documentación oficial el 15 oct 2026.

| IA | Estado | Cómo | Fuente oficial |
|---|---|---|---|
| Claude Code | ✅ Directo | `claude mcp add --transport http buzon URL --header "Authorization: Bearer TOKEN"` · probar con `/mcp` | https://code.claude.com/docs/en/mcp |
| Claude Desktop | 🔌 Puente | `claude_desktop_config.json` (Settings → Developer → Edit Config) con `npx -y mcp-remote URL --header Authorization:${AUTH_HEADER}` y `env.AUTH_HEADER="Bearer TOKEN"`. Requiere Node.js | https://github.com/geelen/mcp-remote · https://www.npmjs.com/package/mcp-remote · https://modelcontextprotocol.io/quickstart/user |
| claude.ai (y conectores en Desktop) | ⚠️ Depende de la cuenta | Settings → Connectors → Add custom connector → "No sign in" + **Request headers** `Authorization: Bearer TOKEN`. Los headers fijos son **beta para un grupo limitado de organizaciones**; si no ves "Request headers", no se puede | https://claude.com/docs/connectors/custom/add-unlisted · https://claude.com/docs/connectors/custom/remote-mcp · https://claude.com/docs/connectors/building/authentication · https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp |
| Cursor | ✅ Directo | `~/.cursor/mcp.json` → `mcpServers.buzon = { url, headers.Authorization }` | https://cursor.com/docs/mcp · https://cursor.com/help/customization/mcp |
| Gemini CLI | ✅ Directo | `gemini mcp add --transport http --header "Authorization: Bearer TOKEN" buzon URL` (o `httpUrl` + `headers` en `~/.gemini/settings.json`) · probar `gemini mcp list` / `/mcp` | https://geminicli.com/docs/tools/mcp-server/ · https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html |
| OpenAI Codex | ✅ Directo | `~/.codex/config.toml`: `[mcp_servers.buzon] url=… bearer_token_env_var="BUZON_TOKEN"` (Codex rechaza el token en texto dentro del archivo) · probar `codex mcp list` | https://learn.chatgpt.com/docs/extend/mcp.md?surface=cli · https://github.com/openai/codex/commit/a43ae86b6c072a962120460e5f4386cbcbc35b27 |
| Grok (CLI) | ✅ Directo | `grok mcp add --transport http buzon URL --header "Authorization: Bearer TOKEN"` | https://docs.x.ai/build/features/mcp-servers |
| Grok (API xAI) | ✅ Directo | Responses API: `{"type":"mcp","server_url":URL,"server_label":"buzon","authorization":TOKEN}` | https://docs.x.ai/developers/tools/remote-mcp |
| grok.com (app) | ⚠️ Sin confirmar | grok.com/connectors → New Connector → Custom → URL "y completa la autenticación requerida". La doc no aclara si acepta una cabecera fija; usar el CLI | https://docs.x.ai/grok/connectors |
| VS Code + Copilot | ✅ Directo | `.vscode/mcp.json`: `servers.buzon = {type:"http", url, headers.Authorization:"Bearer ${input:buzon-token}"}` con `inputs` tipo password | https://code.visualstudio.com/docs/agents/reference/mcp-configuration · https://code.visualstudio.com/docs/copilot/customization/mcp-servers |
| Windsurf | ✅ Directo | Cascade → MCP → Open MCP config file → `serverUrl` + `headers` → refrescar | https://docs.devin.ai/windsurf/plugins/cascade/mcp |
| Google Antigravity | ✅ Directo | MCP Servers → Manage MCP Servers → View raw config (`~/.gemini/config/mcp_config.json`) → `serverUrl` + `headers` | https://antigravity.google/docs/mcp/ |
| ChatGPT (web/app) | ⛔ No compatible | Plugins → Add custom MCP server solo ofrece OAuth o sin autenticación; no hay cabecera fija. Alternativa: Codex (misma cuenta OpenAI). Futuro: agregar OAuth al servidor | https://developers.openai.com/api/docs/guides/custom-mcp-server · https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt · https://community.openai.com/t/persistent-custom-http-header-authentication-for-chatgpt-mcp-connectors-and-scheduled-tasks/1404792 |

Notas:
- `mcp-remote` no sirve para ChatGPT ni claude.ai: esos se conectan desde la nube del proveedor, no desde tu compu.
- Nunca subas un archivo de configuración con tu token a git. Si se filtra, revócalo en **Agentes**.
