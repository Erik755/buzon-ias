// Búsqueda de agentes para el ayudante de conexión.
// Solo trabaja con las guías del repo (verificadas en docs/CONECTAR.md).
// No incluye clientes que el servidor MCP no documenta. Perplexity ya documenta conectores MCP remotos
// (help center art. 13915507: API Key/OAuth/None, Streamable HTTP), pero la fuente no dice si la clave
// viaja como Authorization: Bearer; hasta confirmarlo con fuente o prueba real, la guía queda fuera.

export const SUGERENCIAS = ['claude-code', 'cursor', 'gemini-cli', 'codex', 'grok', 'chatgpt', 'instinct', 'labelbox-recursion', 'mcp-generico'];

export const ALIAS = {
  instinct: ['instinct', 'celular', 'telefono', 'phone', 'mobile', 'forge'],
  'nl-codex': ['codex natural', 'lenguaje natural codex', 'connect to my mailbox codex', 'conectate a mi buzon codex'],
  'nl-grok': ['grok natural', 'lenguaje natural grok', 'grok cli natural', 'conectate a mi buzon grok'],
  'claude-code': ['claude', 'claude code', 'claude cli', 'anthropic', 'claude terminal'],
  'claude-desktop': ['claude desktop', 'claude app', 'claude escritorio', 'desktop'],
  'claude-web': ['claude.ai', 'claude web', 'claude navegador', 'claude browser', 'claude.ai browser'],
  cursor: ['cursor', 'cursor ide', 'cursor ai', 'cursor editor'],
  'gemini-cli': ['gemini', 'gemini cli', 'google gemini', 'gemini terminal'],
  codex: ['codex', 'openai codex', 'chatgpt cli', 'codex cli', 'codex extension'],
  grok: ['grok', 'xai', 'grok cli', 'grok terminal', 'x.ai'],
  vscode: ['vs code', 'vscode', 'visual studio code', 'copilot', 'github copilot'],
  windsurf: ['windsurf', 'codeium', 'cascade'],
  antigravity: ['antigravity', 'google antigravity', 'anti gravity'],
  chatgpt: ['chatgpt', 'chat gpt', 'openai', 'chatgpt web', 'chatgpt app'],
  'mcp-generico': ['mcp', 'generico', 'generic', 'cliente mcp', 'generic mcp', 'otro', 'other', 'custom mcp', 'mcp client'],
  'labelbox-recursion': ['labelbox', 'recursion', 'labelbox recursion', 'managed agents', 'managed agent', 'agentes administrados', 'label box', 'labelbox mcp'],
};

export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}


function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const r = new Array(n + 1); r[0] = i; return r;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function camposDe(g, idioma, nombreEn) {
  const nombre = idioma === 'en' && nombreEn ? nombreEn : g.nombre;
  return [g.id, nombre, ...(g.aliases || ALIAS[g.id] || [])].map(normalizar);
}

export function puntuacionGuia(query, g, idioma = 'es', nombreEn = '') {
  const nq = normalizar(query);
  if (!nq) return 0;
  const campos = camposDe(g, idioma, nombreEn);
  let best = 0;
  for (const c of campos) {
    if (!c) continue;
    if (c === nq) best = Math.max(best, 100);
    else if (c.startsWith(nq)) best = Math.max(best, 90);
    else if (c.split(/[\s()/"'-]+/).some((w) => w.startsWith(nq))) best = Math.max(best, 80);
    else if (c.includes(nq)) best = Math.max(best, 70);
    else if (nq.length >= 3 && distancia(nq, c) <= 2) best = Math.max(best, 50);
    // Sin coincidencia por subsecuencia: generaba ruido (p. ej. 'gemini' casaba guías sin relación).
  }
  const toks = nq.split(/\s+/).filter(Boolean);
  if (toks.length > 1 && toks.every((tok) => campos.some((c) => c.includes(tok)))) best = Math.max(best, 75);
  return best;
}

// Vacío: no se listan todas las guías (evitar un muro de texto).
// Se devuelven sugerencias. Con texto: solo coincidencias, mejor primero.
export function buscarGuias(query, guias, { idioma = 'es', nombresEn = {} } = {}) {
  const nq = normalizar(query);
  const porId = (id) => guias.find((g) => g.id === id);
  if (!nq) {
    return {
      vacio: true,
      resultados: [],
      sugerencias: SUGERENCIAS.map(porId).filter(Boolean),
    };
  }
  const scored = guias
    .map((g) => ({ g, s: puntuacionGuia(nq, g, idioma, nombresEn[g.id]) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.g.nombre.localeCompare(b.g.nombre));
  return { vacio: false, resultados: scored.map((x) => x.g), sugerencias: [] };
}

export function rellenarPlantilla(texto, { url, token, canje }) {
  let s = String(texto ?? '');
  if (url) s = s.replaceAll('{URL}', url);
  if (canje) s = s.replaceAll('{CANJE}', canje);
  if (token) s = s.replaceAll('{TOKEN}', token);
  return s;
}

// Para mostrar un bloque que incluye un token real: se enmascara en pantalla.
export function enmascararToken(texto, token) {
  if (!token) return String(texto ?? '');
  return String(texto ?? '').replaceAll(token, `${token.slice(0, 3)}••••••••`);
}
