// Aplica el tema antes de la primera pintura. Script clásico (no module) para
// que bloquee el parseo y corra antes de estilo.css. Por defecto: claro.
// El valor inicial es siempre claro si no hay una elección guardada.
(function (g) {
  var CLAVE = 'buzon-tema';
  var COLORES = { light: '#f6f7fb', dark: '#16181f' };
  function leer() {
    try {
      var v = g.localStorage && g.localStorage.getItem(CLAVE);
      if (v === 'dark' || v === 'oscuro') return 'dark';
      return 'light';
    } catch (e) { return 'light'; }
  }
  function aplicar(tema) {
    tema = tema === 'dark' ? 'dark' : 'light';
    var d = g.document;
    if (!d || !d.documentElement) return tema;
    var r = d.documentElement;
    r.setAttribute('data-theme', tema);
    r.style.colorScheme = tema;
    var m = d.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', COLORES[tema]);
    var c = d.querySelector('meta[name="color-scheme"]');
    if (c) c.setAttribute('content', tema);
    return tema;
  }
  aplicar(leer());
})(typeof window !== 'undefined' ? window : globalThis);
