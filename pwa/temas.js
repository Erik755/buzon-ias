// Paleta claro/oscuro, contraste WCAG y aplicación del tema.
// El arranque antes de la primera pintura vive en tema-inicio.js (script clásico).
export const CLAVE_TEMA = 'buzon-tema';
export const TEMAS = ['light', 'dark'];

export const PALETAS = {
  light: {
    'fondo': '#f4f5f8',
    'panel': '#ffffff',
    'panel-2': '#eef0f5',
    'borde': '#6f7484',
    'texto': '#16181f',
    'muted': '#5c6170',
    'acento': '#3856d0',
    'acento-texto': '#ffffff',
    'mia': '#dce4ff',
    'suya': '#eceef3',
    'ok': '#157a48',
    'ok-bg': '#d9f3e6',
    'ok-boton': '#157a48',
    'ok-boton-texto': '#ffffff',
    'peligro': '#c62828',
    'peligro-bg': '#fde8e8',
    'aviso-bg': '#fff4d6',
    'aviso-texto': '#6a4a00',
    'aviso-borde': '#8a6a10',
    'badge-urgente-bg': '#f5c36c',
    'badge-urgente-texto': '#1a1200',
    'focus': '#3856d0',
    'velo': '#00000099',
    'scroll-thumb': '#6f7484',
    'scroll-track': '#eef0f5',
    'theme-color': '#f4f5f8',
    'sombra': '0 10px 30px #1a1d2820',
  },
  dark: {
    'fondo': '#0e1016',
    'panel': '#16181f',
    'panel-2': '#1c1f2a',
    'borde': '#8b8fa3',
    'texto': '#ececf1',
    'muted': '#a0a5b8',
    'acento': '#7c9cff',
    'acento-texto': '#0e1016',
    'mia': '#2b3348',
    'suya': '#1c1f2a',
    'ok': '#3dd68c',
    'ok-bg': '#143326',
    'ok-boton': '#157a48',
    'ok-boton-texto': '#ffffff',
    'peligro': '#ff7b7b',
    'peligro-bg': '#3a1a1a',
    'aviso-bg': '#3a2a10',
    'aviso-texto': '#f5c36c',
    'aviso-borde': '#c9a227',
    'badge-urgente-bg': '#f5c36c',
    'badge-urgente-texto': '#1a1200',
    'focus': '#9db4ff',
    'velo': '#00000099',
    'scroll-thumb': '#8b8fa3',
    'scroll-track': '#16181f',
    'theme-color': '#16181f',
    'sombra': '0 10px 40px #0006',
  },
};

/** Pares que se pintan de verdad: texto 4.5:1, UI / foco / borde 3:1. */
export const PARES_CONTRASTE = {
  light: paresDe('light'),
  dark: paresDe('dark'),
};

function paresDe(tema) {
  const s = ['fondo', 'panel', 'panel-2', 'mia', 'suya'];
  const pares = [];
  for (const bg of s) {
    pares.push({ fg: 'texto', bg, min: 4.5, nombre: `texto sobre ${bg}` });
    pares.push({ fg: 'muted', bg, min: 4.5, nombre: `muted sobre ${bg}` });
    pares.push({ fg: 'acento', bg, min: 4.5, nombre: `enlace sobre ${bg}` });
    pares.push({ fg: 'focus', bg, min: 3, nombre: `foco sobre ${bg}` });
    pares.push({ fg: 'borde', bg, min: 3, nombre: `borde sobre ${bg}` });
  }
  pares.push(
    { fg: 'acento-texto', bg: 'acento', min: 4.5, nombre: 'texto del botón de acento' },
    { fg: 'ok-boton-texto', bg: 'ok-boton', min: 4.5, nombre: 'texto del botón OK' },
    { fg: 'ok', bg: 'fondo', min: 4.5, nombre: 'ok sobre fondo' },
    { fg: 'ok', bg: 'panel', min: 4.5, nombre: 'ok sobre panel' },
    { fg: 'ok', bg: 'panel-2', min: 4.5, nombre: 'ok sobre panel-2' },
    { fg: 'ok', bg: 'ok-bg', min: 4.5, nombre: 'ok sobre ok-bg' },
    { fg: 'peligro', bg: 'fondo', min: 4.5, nombre: 'peligro sobre fondo' },
    { fg: 'peligro', bg: 'panel', min: 4.5, nombre: 'peligro sobre panel' },
    { fg: 'peligro', bg: 'panel-2', min: 4.5, nombre: 'peligro sobre panel-2' },
    { fg: 'peligro', bg: 'peligro-bg', min: 4.5, nombre: 'peligro sobre su fondo' },
    { fg: 'aviso-texto', bg: 'aviso-bg', min: 4.5, nombre: 'aviso en página' },
    { fg: 'acento', bg: 'aviso-bg', min: 4.5, nombre: 'enlace en aviso' },
    { fg: 'aviso-borde', bg: 'aviso-bg', min: 3, nombre: 'borde del aviso' },
    { fg: 'badge-urgente-texto', bg: 'badge-urgente-bg', min: 4.5, nombre: 'badge de aprobación' },
    { fg: 'scroll-thumb', bg: 'scroll-track', min: 3, nombre: 'barra de desplazamiento' },
  );
  return pares;
}

function canalLineal(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function normalizarHex(color) {
  if (!color) return '';
  let h = String(color).trim().toLowerCase();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
  if (h.length === 8) h = h.slice(0, 6);
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : '';
}

export function luminancia(color) {
  const h = normalizarHex(color).slice(1);
  if (!h) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b);
}

export function contraste(a, b) {
  const l1 = luminancia(a), l2 = luminancia(b);
  const claro = Math.max(l1, l2), oscuro = Math.min(l1, l2);
  return (claro + 0.05) / (oscuro + 0.05);
}

export function informarContraste(tema) {
  const pal = PALETAS[tema];
  const resultados = [];
  for (const p of PARES_CONTRASTE[tema]) {
    const fg = pal[p.fg], bg = pal[p.bg];
    const ratio = contraste(fg, bg);
    resultados.push({ ...p, fg, bg, ratio, ok: ratio + 1e-9 >= p.min });
  }
  return resultados;
}

export function normalizarTema(valor) {
  if (valor === 'dark' || valor === 'oscuro') return 'dark';
  if (valor === 'light' || valor === 'claro') return 'light';
  return 'light';
}

export function leerTema(almacen) {
  try {
    return normalizarTema(almacen && almacen.getItem(CLAVE_TEMA));
  } catch {
    return 'light';
  }
}

export function colorDeTema(tema) {
  return PALETAS[normalizarTema(tema)]['theme-color'];
}

export function aplicarTema(tema, almacen, doc = typeof document !== 'undefined' ? document : null) {
  const t = normalizarTema(tema);
  if (doc && doc.documentElement) {
    const root = doc.documentElement;
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colorDeTema(t));
    const cs = doc.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', t);
  }
  if (almacen) {
    try { almacen.setItem(CLAVE_TEMA, t); } catch { /* modo privado */ }
  }
  return t;
}

export function alternarTema(almacen, doc = typeof document !== 'undefined' ? document : null) {
  const actual = (doc && doc.documentElement && doc.documentElement.getAttribute('data-theme')) || leerTema(almacen);
  return aplicarTema(actual === 'dark' ? 'light' : 'dark', almacen, doc);
}

export function sincronizarControlTema(btn, traducir, doc = typeof document !== 'undefined' ? document : null) {
  if (!btn) return;
  const tema = (doc && doc.documentElement && doc.documentElement.getAttribute('data-theme')) || 'light';
  const oscuro = tema === 'dark';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', oscuro ? 'true' : 'false');
  if (typeof btn.removeAttribute === 'function') btn.removeAttribute('aria-pressed');
  if (typeof traducir === 'function') {
    btn.setAttribute('aria-label', traducir(oscuro ? 'tema.cambiarAClaro' : 'tema.cambiarAOscuro'));
    const eti = btn.querySelector('.tema-eti');
    if (eti) eti.textContent = traducir(oscuro ? 'tema.oscuro' : 'tema.claro');
  }
  const ico = btn.querySelector('.tema-icono');
  if (ico) ico.textContent = oscuro ? '☾' : '☀';
}
