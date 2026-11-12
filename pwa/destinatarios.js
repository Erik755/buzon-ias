// Lista del destinatario al crear un hilo: agentes base, conectados (configuración
// y tokens) y remitentes vistos en el buzón. Sin duplicados; los conectados van primero.
import { normalizar } from './conectar.js';

export const AGENTES_BASE = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Grok',
  'Copilot',
  'Cursor',
  'Perplexity',
  'Labelbox Recursion',
  'Instinct',
];

// Alias para no repetir un agente base con un nombre equivalente guardado.
const ALIAS = {
  chatgpt: ['chat gpt', 'chatgpt (web y app)'],
  claude: ['claude desktop', 'claude code', 'anthropic claude'],
  gemini: ['gemini cli', 'google gemini'],
  grok: ['grok bot', 'xai grok'],
  copilot: ['github copilot', 'vs code con copilot', 'vscode', 'vscode con copilot'],
  cursor: ['cursor ide'],
  perplexity: ['perplexity ai'],
  'labelbox recursion': ['labelbox', 'labelbox recursion (managed agents)', 'recursion'],
  instinct: ['instinct (desde tu celular)'],
};

export function claveNombre(s) {
  return normalizar(s).replace(/\s+/g, ' ');
}

export function claveCanon(s) {
  const k = claveNombre(s);
  if (!k) return '';
  for (const [base, aliases] of Object.entries(ALIAS)) {
    if (k === base || aliases.includes(k)) return base;
  }
  return k;
}

export function mismaClave(a, b) {
  const ka = claveCanon(a), kb = claveCanon(b);
  return !!ka && ka === kb;
}

/**
 * Arma la lista del selector.
 * `agentes` son los de la configuración (con token); `remitentes` son nombres
 * vistos como autores o destinatarios en el buzón. `consulta` filtra al escribir.
 * Si el texto no coincide con nadie, se ofrece como nombre libre.
 */
export function listaDestinatarios({ agentes = [], remitentes = [], consulta = '', incluirLibre = true } = {}) {
  const mapa = new Map();

  const meter = (nombre, extra) => {
    const raw = String(nombre ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const k = claveCanon(raw);
    if (!k) return;
    const prev = mapa.get(k);
    if (!prev) {
      mapa.set(k, { nombre: raw, conectado: false, fuente: 'base', ...extra });
      return;
    }
    const siguiente = { ...prev };
    if (extra.conectado) {
      siguiente.conectado = true;
      siguiente.nombre = raw;
      siguiente.fuente = extra.fuente || 'agente';
    }
    if (extra.id && (!siguiente.id || extra.conectado)) siguiente.id = extra.id;
    if (!siguiente.conectado && extra.fuente === 'remitente') {
      siguiente.fuente = 'remitente';
      siguiente.nombre = raw;
    }
    mapa.set(k, siguiente);
  };

  for (const a of agentes) {
    if (a && a.nombre) meter(a.nombre, { conectado: true, id: a.id, fuente: 'agente' });
  }
  for (const n of remitentes) meter(n, { conectado: false, fuente: 'remitente' });
  for (const n of AGENTES_BASE) meter(n, { conectado: false, fuente: 'base' });

  let lista = [...mapa.values()];
  lista.sort((a, b) => {
    if (a.conectado !== b.conectado) return a.conectado ? -1 : 1;
    return claveNombre(a.nombre).localeCompare(claveNombre(b.nombre), 'es');
  });

  const q = claveNombre(consulta);
  if (q) {
    lista = lista.filter((x) => {
      const nx = claveNombre(x.nombre);
      const cx = claveCanon(x.nombre);
      return nx.includes(q) || cx.includes(q);
    });
    const exacto = lista.some((x) => claveNombre(x.nombre) === q || claveCanon(x.nombre) === claveCanon(q));
    if (incluirLibre && !exacto && String(consulta).trim()) {
      lista.push({ nombre: String(consulta).replace(/\s+/g, ' ').trim(), conectado: false, fuente: 'libre' });
    }
  }
  return lista;
}

/** Id del agente conectado cuyo nombre coincide, o null si no hay uno claro. */
export function idAgentePorNombre(agentes, nombre) {
  if (!claveNombre(nombre)) return null;
  const ids = [...new Set((agentes ?? [])
    .filter((a) => a?.nombre && a.id && mismaClave(a.nombre, nombre))
    .map((a) => a.id))];
  return ids.length === 1 ? ids[0] : null;
}

/** Nombres de remitentes (y destinos) a partir de hilos ya cargados. */
export function nombresDeHilos(hilos) {
  const out = [];
  for (const h of hilos ?? []) {
    if (h?.creador?.nombre) out.push(h.creador.nombre);
    if (h?.destino?.nombre) out.push(h.destino.nombre);
  }
  return out;
}
