// Temas claro/oscuro: valor por defecto, persistencia, contraste WCAG AA y arranque sin destello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInNewContext } from 'node:vm';
import {
  PALETAS, PARES_CONTRASTE, CLAVE_TEMA,
  contraste, informarContraste, normalizarHex, normalizarTema, leerTema,
  aplicarTema, alternarTema, sincronizarControlTema, colorDeTema,
} from '../../pwa/temas.js';

const pwa = (f) => readFileSync(new URL('../../pwa/' + f, import.meta.url), 'utf8');

function almacen(inicial = {}) {
  const s = { ...inicial };
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    store: s,
  };
}

function docFalso(attrs = {}) {
  const el = {
    attrs: { ...attrs },
    style: { colorScheme: '' },
    getAttribute(n) { return this.attrs[n] ?? null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
  };
  const metas = {
    'theme-color': { content: '#f4f5f8', setAttribute(n, v) { this[n] = v; }, getAttribute(n) { return this[n]; } },
    'color-scheme': { content: 'light', setAttribute(n, v) { this[n] = v; }, getAttribute(n) { return this[n]; } },
  };
  return {
    documentElement: el,
    querySelector(sel) {
      const m = /^meta\[name="([^"]+)"\]$/.exec(sel);
      return m ? metas[m[1]] || null : null;
    },
    metas,
  };
}

test('el tema por defecto es claro y no sigue prefers-color-scheme', () => {
  assert.equal(leerTema(almacen()), 'light');
  assert.equal(leerTema(almacen({ 'buzon-tema': 'desconocido' })), 'light');
  assert.equal(leerTema(null), 'light');
  assert.equal(normalizarTema(undefined), 'light');
  const temaJs = pwa('temas.js');
  const inicio = pwa('tema-inicio.js');
  const app = pwa('app.js');
  assert.doesNotMatch(temaJs, /prefers-color-scheme/);
  assert.doesNotMatch(temaJs, /matchMedia/);
  assert.doesNotMatch(inicio, /prefers-color-scheme/);
  assert.doesNotMatch(inicio, /matchMedia/);
  assert.doesNotMatch(app, /prefers-color-scheme/);
  assert.doesNotMatch(app, /matchMedia\s*\(\s*['"]\(prefers/);
  assert.doesNotMatch(app, /dataset\.tema/);
});

test('lee light/dark y migra los valores antiguos claro/oscuro', () => {
  assert.equal(leerTema(almacen({ 'buzon-tema': 'light' })), 'light');
  assert.equal(leerTema(almacen({ 'buzon-tema': 'dark' })), 'dark');
  assert.equal(leerTema(almacen({ 'buzon-tema': 'claro' })), 'light');
  assert.equal(leerTema(almacen({ 'buzon-tema': 'oscuro' })), 'dark');
  assert.equal(CLAVE_TEMA, 'buzon-tema');
});

test('aplicarTema pone data-theme, color-scheme, theme-color y persiste', () => {
  const ls = almacen();
  const doc = docFalso();
  assert.equal(aplicarTema('dark', ls, doc), 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  assert.equal(doc.metas['theme-color'].content, colorDeTema('dark'));
  assert.equal(doc.metas['color-scheme'].content, 'dark');
  assert.equal(ls.store[CLAVE_TEMA], 'dark');
  assert.equal(alternarTema(ls, doc), 'light');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(doc.metas['theme-color'].content, '#f4f5f8');
  assert.equal(ls.store[CLAVE_TEMA], 'light');
});

test('el interruptor es un switch etiquetado: aria-checked y textos ES/EN', () => {
  const doc = docFalso({ 'data-theme': 'light' });
  aplicarTema('light', almacen(), doc);
  const eti = { textContent: '' };
  const ico = { textContent: '' };
  const btn = {
    attrs: {},
    setAttribute(n, v) { this.attrs[n] = String(v); },
    querySelector(s) { return s === '.tema-eti' ? eti : s === '.tema-icono' ? ico : null; },
  };
  const textos = {
    'tema.claro': 'Claro', 'tema.oscuro': 'Oscuro',
    'tema.cambiarAOscuro': 'Cambiar a tema oscuro', 'tema.cambiarAClaro': 'Cambiar a tema claro',
  };
  sincronizarControlTema(btn, (k) => textos[k], doc);
  assert.equal(btn.attrs.role, 'switch');
  assert.equal(btn.attrs['aria-checked'], 'false');
  assert.equal(btn.attrs['aria-pressed'], undefined);
  assert.equal(btn.attrs['aria-label'], 'Cambiar a tema oscuro');
  assert.equal(eti.textContent, 'Claro');
  assert.equal(ico.textContent, '☀');
  aplicarTema('dark', almacen(), doc);
  const en = {
    'tema.claro': 'Light', 'tema.oscuro': 'Dark',
    'tema.cambiarAOscuro': 'Switch to dark theme', 'tema.cambiarAClaro': 'Switch to light theme',
  };
  sincronizarControlTema(btn, (k) => en[k], doc);
  assert.equal(btn.attrs['aria-checked'], 'true');
  assert.equal(btn.attrs['aria-label'], 'Switch to light theme');
  assert.equal(eti.textContent, 'Dark');
  assert.equal(ico.textContent, '☾');
});

test('WCAG AA: texto ≥ 4.5:1 y UI/foco/borde ≥ 3:1 en ambos temas', () => {
  for (const tema of ['light', 'dark']) {
    const rs = informarContraste(tema);
    assert.ok(rs.length >= 20, tema + ' tiene suficientes pares');
    const fallos = rs.filter((r) => !r.ok);
    assert.deepEqual(fallos, [], `${tema} falló: ` + fallos.map((r) => `${r.nombre} ${r.ratio.toFixed(2)} < ${r.min} (${r.fg} / ${r.bg})`).join('; '));
  }
  // Calibración conocida: blanco sobre negro.
  assert.ok(contraste('#ffffff', '#000000') > 20);
  assert.equal(normalizarHex('#FFF'), '#ffffff');
});

function tokensDelBloque(css, pista) {
  const i = css.indexOf(pista);
  assert.ok(i >= 0, 'no está el bloque ' + pista);
  const a = css.indexOf('{', i);
  const b = css.indexOf('}', a);
  const cuerpo = css.slice(a + 1, b);
  const out = {};
  for (const m of cuerpo.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+)/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

test('las variables CSS de [data-theme] coinciden con PALETAS', () => {
  const css = pwa('estilo.css');
  assert.match(css, /:root,\s*html\[data-theme="light"\]/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.doesNotMatch(css, /data-tema/);
  for (const [tema, pista] of [['light', 'data-theme="light"'], ['dark', 'data-theme="dark"']]) {
    const toks = tokensDelBloque(css, pista);
    for (const [k, v] of Object.entries(PALETAS[tema])) {
      if (k === 'theme-color') continue;
      if (k === 'sombra') {
        assert.equal(toks[k], v, `${tema} --${k}`);
        continue;
      }
      assert.ok(toks[k], `${tema} falta --${k}`);
      const cssHex = normalizarHex(toks[k]) || toks[k];
      const palHex = normalizarHex(v) || v;
      assert.equal(cssHex, palHex, `${tema} --${k}: css=${toks[k]} paleta=${v}`);
    }
    assert.match(css.slice(css.indexOf(pista), css.indexOf('}', css.indexOf(pista))), new RegExp(`color-scheme:\\s*${tema}`));
  }
  assert.match(css, /\.aviso\{[^}]*background:var\(--aviso-bg\)/);
  assert.match(css, /button\.ok,a\.boton\.ok\{background:var\(--ok-boton\)/);
  assert.match(css, /scrollbar-color:var\(--scroll-thumb\) var\(--scroll-track\)/);
  assert.match(css, /dialog::backdrop\{background:var\(--velo\)/);
  assert.match(css, /\.fondo-panel\{[^}]*background:var\(--velo\)/);
  assert.match(css, /\.tema-switch/);
});

test('index.html arranca en claro, script temprano antes del CSS, interruptor accesible', () => {
  const html = pwa('index.html');
  const csp = pwa('vercel.json');
  assert.match(html, /<html lang="es" data-theme="light">/);
  assert.match(html, /<meta name="theme-color" content="#f4f5f8">/);
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.match(html, /<script src="tema-inicio\.js"><\/script>/);
  const iScript = html.indexOf('tema-inicio.js');
  const iCss = html.indexOf('estilo.css');
  assert.ok(iScript > 0 && iScript < iCss, 'tema-inicio.js debe ir antes de estilo.css');
  assert.ok(html.indexOf('theme-color') < iScript, 'el meta theme-color existe antes del script');
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
  assert.match(html, /id="btn-tema"[^>]*role="switch"/);
  assert.match(html, /id="btn-tema"[^>]*aria-checked="false"/);
  assert.doesNotMatch(html, /id="btn-tema"[^>]*aria-pressed/);
  assert.match(html, /aria-label="Cambiar a tema oscuro"/);
  assert.match(html, /class="tema-eti">Claro</);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const inicio = pwa('tema-inicio.js');
  assert.doesNotMatch(inicio, /type="module"|export |import /);
  assert.match(inicio, /data-theme/);
  assert.match(inicio, /buzon-tema/);
});

test('tema-inicio.js aplica dark desde localStorage sin destello (vm)', () => {
  const codigo = pwa('tema-inicio.js');
  const el = { attrs: { 'data-theme': 'light' }, style: { colorScheme: 'light' }, setAttribute(n, v) { this.attrs[n] = v; }, getAttribute(n) { return this.attrs[n]; } };
  const metas = {
    'theme-color': { setAttribute(n, v) { this[n] = v; }, content: '#f4f5f8' },
    'color-scheme': { setAttribute(n, v) { this[n] = v; }, content: 'light' },
  };
  const ls = { getItem: (k) => (k === 'buzon-tema' ? 'oscuro' : null) };
  const sandbox = {
    window: {},
    localStorage: ls,
    document: {
      documentElement: el,
      querySelector(sel) {
        if (sel === 'meta[name="theme-color"]') return metas['theme-color'];
        if (sel === 'meta[name="color-scheme"]') return metas['color-scheme'];
        return null;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  runInNewContext(codigo, sandbox);
  assert.equal(el.attrs['data-theme'], 'dark');
  assert.equal(el.style.colorScheme, 'dark');
  assert.equal(metas['theme-color'].content, '#16181f');
  assert.equal(metas['color-scheme'].content, 'dark');
});

test('el SW sube a buzon-v21-temas y precacha los módulos de tema; el build los copia', () => {
  const sw = pwa('sw.js');
  const build = pwa('build-config.mjs');
  const man = pwa('manifest.webmanifest');
  assert.match(sw, /const C = 'buzon-v21-temas'/);
  assert.match(sw, /'tema-inicio\.js'/);
  assert.match(sw, /'temas\.js'/);
  for (const f of ['i18n.js', 'conectar.js', 'guias-i18n.js', 'layout.js', 'chat.js', 'avisos.js', 'tema-inicio.js', 'temas.js']) {
    assert.match(build, new RegExp(`'${f}'`));
    assert.match(sw, new RegExp(`'${f}'`));
  }
  assert.match(man, /"theme_color": "#f4f5f8"/);
});
