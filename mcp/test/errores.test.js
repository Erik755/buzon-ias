// Mensajes de error amables de la PWA y bloqueo de doble toque (pwa/errores.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mensajeAmable, conBotones } from '../../pwa/errores.js';

test('errores crudos se traducen a español amable con acentos', () => {
  const casos = [
    [{ message: 'permission denied for table hilos', code: '42501' }, /No tienes permiso/],
    [{ message: 'nadie pidio cerrar este hilo', code: '22023' }, /Ninguna IA pidió cerrar/],
    [{ message: 'el hilo ya esta cerrado' }, /ya está cerrado/],
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
  assert.match(app, /Sí,&nbsp;cerrar/);
  assert.match(css, /button,a\.boton\{min-height:44px\}/);
  assert.match(css, /nav button\{flex:1 1 0;min-width:0/);
});
