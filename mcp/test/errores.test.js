// Mensajes de error amables de la PWA y bloqueo de doble toque (pwa/errores.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mensajeAmable, conBotones, mostrarAviso, avisar } from '../../pwa/errores.js';

test('errores crudos se traducen a español amable con acentos', () => {
  const casos = [
    [{ message: 'permission denied for table hilos', code: '42501' }, /No tienes permiso/],
    [{ message: 'nadie pidio cerrar este hilo', code: '22023' }, /Ninguna IA pidió cerrar/],
    [{ message: 'el hilo ya esta cerrado' }, /ya está cerrado/],
    [{ message: 'la nota supera 2000 caracteres', code: '22023' }, /hasta 2000 caracteres/],
    [{ message: 'TypeError: Failed to fetch' }, /Sin conexión/],
    [{ message: 'JWT expired' }, /sesión venció/],
    [{ message: 'algo raro 500' }, /Algo salió mal/],
  ];
  for (const [e, re] of casos) {
    const m = mensajeAmable(e);
    assert.match(m, re, e.message);
    assert.ok(!/permission|denied|pidio|esta cerrado|JWT|fetch/i.test(m), 'sin texto crudo: ' + m);
  }
  assert.match(mensajeAmable({ message: 'x' }, false), /Sin conexión/);
});

test('doble toque: una sola llamada y los botones se desactivan mientras corre', async () => {
  const b1 = { disabled: false, setAttribute() {}, removeAttribute() {} }, b2 = { ...b1 };
  let llamadas = 0, soltar;
  const accion = () => { llamadas++; return new Promise((r) => (soltar = r)); };
  const p1 = conBotones([b1, b2, null], accion);
  assert.equal(b1.disabled, true); assert.equal(b2.disabled, true);
  await conBotones([b1, b2], accion);
  assert.equal(llamadas, 1, 'el segundo toque no llama al servidor');
  soltar(); await p1;
  assert.equal(b1.disabled, false, 'se reactivan al terminar');
});

test('diálogo accesible y botones claros', () => {
  const html = readFileSync(new URL('../../pwa/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../pwa/estilo.css', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="dlg" aria-labelledby="dlg-titulo">/);
  assert.match(html, />Volver<\/button>/); assert.ok(!/<button[^>]*>Cerrar<\/button>/.test(html));
  assert.match(app, /id="dlg-titulo"/); assert.match(app, /<label for="nota"/);
  assert.match(app, /Aceptar y&nbsp;cerrar/); assert.match(app, />Rechazar<\/button>/);
  assert.match(css, /button,a\.boton\{min-height:44px\}/);
  assert.match(css, /nav button\{flex:1 1 0;min-width:0/);
});

test('ninguna alerta de la PWA muestra el texto crudo del servidor', () => {
  const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
  const crudas = app.split('\n').filter((l) => /alert\(/.test(l) && /\.message/.test(l) && !/mensajeAmable/.test(l));
  assert.deepEqual(crudas, []);
  assert.match(mensajeAmable({ code: '23505', message: 'duplicate key value violates unique constraint' }), /Ya existe uno con ese nombre/);
  assert.match(mensajeAmable({
    code: '23505',
    message: 'duplicate key value violates unique constraint "buzones_un_buzon_por_dueno"',
    details: 'Key (dueno_id)=(aaaaaaaa-0000-0000-0000-000000000001) already exists.',
  }), /Ya tienes un buzón\. Por ahora solo se permite uno por cuenta\./);
  // Otros 23505 (nombre de agente, etc.) siguen con el mensaje de nombre.
  assert.match(mensajeAmable({ code: '23505', message: 'duplicate key value violates unique constraint "agentes_nombre_unico"', details: 'Key (nombre)=(X) already exists.' }), /Ya existe uno con ese nombre/);
  assert.match(mensajeAmable({ message: 'NotAllowedError: permission denied by user' }), /permiso/);
});

test('diálogo con pie fijo: acciones y Volver siempre visibles; hilos muestran Para y hora', () => {
  const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../pwa/estilo.css', import.meta.url), 'utf8');
  assert.match(app, /<div class="pie">/); assert.match(css, /\.pie\{position:sticky;bottom:0/);
  assert.match(css, /#dlg-cuerpo\{overflow:auto/);
  assert.match(app, /Para: /); assert.match(app, /hilos_para_agente_fkey/); assert.match(app, /🕒/);
});

test('pestaña Por aprobar, Cerrar hilo discreto, guardado atómico, De en el diálogo, cuadro de mensaje en el pie y aviso si Comentar va vacío', () => {
  const html = readFileSync(new URL('../../pwa/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../pwa/estilo.css', import.meta.url), 'utf8');
  assert.match(html, /<button data-vista="pendientes" class="activa">Por aprobar<\/button>/); assert.doesNotMatch(html, /class="corto"/);
  assert.match(css, /#cerrar-ya\{flex:0 0 auto/); assert.match(app, /<div class="fila">\$\{h\.estado !== 'pide_cierre'/);
  assert.match(app, /sb\.rpc\('guardar_webhook'/); assert.doesNotMatch(app, /update\(\{ webhook_url/);
  assert.match(app, /De: \$\{esc\(nombreAutor\(h\.creador, 'ti'\)\)\} · Para:/);
  assert.ok(app.indexOf('<div class="pie">') < app.indexOf('<textarea id="nota"'), 'el cuadro va dentro del pie');
  assert.match(app, /Escribe tu mensaje en el cuadro de arriba antes de tocar «Comentar»/);
});

test('un buzón por dueño: sin botón de crear y el aviso va en la página, sin alert ni innerHTML', () => {
  const html = readFileSync(new URL('../../pwa/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../pwa/estilo.css', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../../pwa/sw.js', import.meta.url), 'utf8');
  const err = readFileSync(new URL('../../pwa/errores.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /Crear otro buzón/);
  assert.doesNotMatch(html, /btn-nuevo-buzon|btn-guardar-buzon|fila-nuevo-buzon|nuevo-buzon-nombre/);
  assert.doesNotMatch(app, /btn-nuevo-buzon|btn-guardar-buzon|fila-nuevo-buzon|nuevo-buzon-nombre/);
  assert.doesNotMatch(css, /btn-nuevo-buzon|fila-nuevo-buzon/);
  assert.match(app, /asegurarBuzon/);
  assert.match(app, /nombre: 'Mi buzón'/);

  assert.doesNotMatch(app, /\balert\s*\(/);
  assert.doesNotMatch(err, /\balert\s*\(/);
  assert.match(html, /id="aviso"[^>]*role="alert"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(html, /id="aviso-texto"/);
  assert.match(css, /#aviso\[hidden\]\{display:none/);
  // La carcasa cambia de nombre cuando hay un arreglo en la PWA; no fijamos una versión concreta.
  assert.match(sw, /const C = 'buzon-v\d+/);
  assert.match(sw, /app\.js/);
  // El texto del aviso se asigna con textContent, nunca con innerHTML.
  assert.match(err, /nodo\.textContent = String\(texto/);
  assert.doesNotMatch(err, /\.innerHTML\s*=/);
});

test('mostrarAviso escribe por textContent (sin interpretar HTML) y se puede ocultar', () => {
  const texto = { textContent: 'viejo' };
  const caja = {
    hidden: true,
    innerHTML: 'NO TOCAR',
    querySelector(sel) { return sel === '#aviso-texto' ? texto : null; },
  };
  mostrarAviso('<img src=x onerror="pwn()"> peligro', caja);
  assert.equal(texto.textContent, '<img src=x onerror="pwn()"> peligro');
  assert.equal(caja.hidden, false);
  assert.equal(caja.innerHTML, 'NO TOCAR', 'no se toca innerHTML del contenedor');
  mostrarAviso('', caja);
  assert.equal(texto.textContent, '');
  assert.equal(caja.hidden, true);
});

test('avisar arma el mensaje amable y lo deja en el aviso de la página', () => {
  const texto = { textContent: '' };
  const caja = {
    hidden: true,
    querySelector(sel) { return sel === '#aviso-texto' ? texto : null; },
  };
  avisar('No se pudo crear el buzón', {
    code: '23505',
    message: 'duplicate key value violates unique constraint "buzones_un_buzon_por_dueno"',
  }, true, caja);
  assert.equal(texto.textContent, 'No se pudo crear el buzón: Ya tienes un buzón. Por ahora solo se permite uno por cuenta.');
  assert.equal(caja.hidden, false);
});
