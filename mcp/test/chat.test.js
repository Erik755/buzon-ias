// Envío del Chat de la PWA: se limpia la caja solo si el alta salió bien,
// no se manda dos veces, el sondeo se pausa con la pestaña oculta y los mensajes se deduplican.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conBotones } from '../../pwa/errores.js';
import {
  fusionarMensajes, idsMensajes, firmaLista, debeEncuestar, debeEncuestarLista,
  enviarMensajeChat, INTERVALO_SONDEO_MS,
} from '../../pwa/chat.js';

const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../pwa/sw.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../pwa/estilo.css', import.meta.url), 'utf8');

test('al enviar bien se limpia la caja; si falla, el texto se queda y se avisa', async () => {
  const entrada = { value: '  hola a los dos  ' };
  const boton = { disabled: false, setAttribute() {}, removeAttribute() {} };
  let avisos = 0, altas = 0;

  const ok = await enviarMensajeChat({
    cuerpo: entrada.value,
    boton,
    conBotones,
    insertar: async (cuerpo) => { altas++; assert.equal(cuerpo, 'hola a los dos'); return { data: { id: 'm1' } }; },
    alError: () => { throw new Error('no debía avisarse'); },
    alExito: async () => { entrada.value = ''; },
  });
  assert.equal(ok.enviado, true);
  assert.equal(entrada.value, '');
  assert.equal(altas, 1);

  entrada.value = 'sigue aquí';
  const fail = await enviarMensajeChat({
    cuerpo: entrada.value,
    boton,
    conBotones,
    insertar: async () => ({ error: { message: 'falló', code: '400' } }),
    alError: () => { avisos++; },
    alExito: async () => { entrada.value = ''; throw new Error('no debía limpiar'); },
  });
  assert.equal(fail.enviado, false);
  assert.equal(entrada.value, 'sigue aquí');
  assert.equal(avisos, 1);
});

test('no se envía dos veces si el botón ya está ocupado, y Enter usa el mismo envío del formulario', async () => {
  const boton = { disabled: false, setAttribute() {}, removeAttribute() {} };
  let altas = 0, soltar;
  const primero = enviarMensajeChat({
    cuerpo: 'uno',
    boton,
    conBotones,
    insertar: () => { altas++; return new Promise((r) => { soltar = () => r({ data: { id: '1' } }); }); },
    alExito: async () => {},
  });
  const segundo = await enviarMensajeChat({
    cuerpo: 'dos',
    boton,
    conBotones,
    insertar: () => { altas++; return { data: { id: '2' } }; },
    alExito: async () => {},
  });
  assert.equal(segundo.enviado, false, 'el segundo toque no llega al servidor');
  assert.equal(altas, 1);
  assert.equal(boton.disabled, true);
  soltar();
  const fin = await primero;
  assert.equal(fin.enviado, true);
  assert.equal(boton.disabled, false);
  assert.equal(altas, 1);

  // Enter (sin Shift) y el botón Enviar son el mismo camino: requestSubmit del form.
  assert.match(app, /\$\('#f-chat'\)\.onsubmit/);
  assert.match(app, /e\.preventDefault\(\)/);
  assert.match(app, /button type="submit"/);
  assert.match(app, /requestSubmit\(\)/);
  assert.match(app, /e\.key === 'Enter' && !e\.shiftKey/);
  assert.doesNotMatch(app, /\$\('#chat-texto'\)\.onkeypress/);
});

test('un texto vacío o de solo espacios no se envía', async () => {
  let altas = 0;
  const boton = { disabled: false, setAttribute() {}, removeAttribute() {} };
  for (const cuerpo of ['', '   ', '\n\t', null, undefined]) {
    const r = await enviarMensajeChat({
      cuerpo, boton, conBotones,
      insertar: async () => { altas++; return { data: {} }; },
    });
    assert.equal(r.enviado, false);
  }
  assert.equal(altas, 0);
});

test('fusionarMensajes deduplica por id y ordena por fecha', () => {
  const a = { id: 'a', cuerpo: 'hola', creado_en: '2026-11-11T18:00:00Z' };
  const b = { id: 'b', cuerpo: 'respuesta', creado_en: '2026-11-11T18:00:05Z' };
  const a2 = { id: 'a', cuerpo: 'hola editado', creado_en: '2026-11-11T18:00:00Z' };
  const out = fusionarMensajes([a, b], [a2, b, { id: 'c', cuerpo: 'nuevo', creado_en: '2026-11-11T18:00:10Z' }]);
  assert.deepEqual(out.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(out[0].cuerpo, 'hola editado', 'el más reciente con el mismo id gana');
  assert.equal(idsMensajes(out), 'a,b,c');
  assert.equal(idsMensajes(out), idsMensajes(fusionarMensajes(out, out)), 'repetir no cambia la firma');
  assert.equal(firmaLista([{ id: 1, estado: 'abierto' }, { id: 2, estado: 'pide_cierre' }], ['id', 'estado']), '1:abierto|2:pide_cierre');
  assert.notEqual(firmaLista([{ id: 1, estado: 'abierto' }], ['id', 'estado']), firmaLista([{ id: 1, estado: 'cerrado' }], ['id', 'estado']));
});

test('el sondeo corre en el chat visible y se pausa si la pestaña está oculta', () => {
  assert.equal(debeEncuestar({ oculto: false, vista: 'chat', hilo: 'h1' }), true);
  assert.equal(debeEncuestar({ oculto: true, vista: 'chat', hilo: 'h1' }), false);
  assert.equal(debeEncuestar({ oculto: false, vista: 'chat', hilo: null }), false);
  assert.equal(debeEncuestar({ oculto: false, vista: 'agentes', hilo: 'h1' }), false);
  assert.equal(debeEncuestarLista({ oculto: false, vista: 'pendientes' }), true);
  assert.equal(debeEncuestarLista({ oculto: false, vista: 'todos' }), true);
  assert.equal(debeEncuestarLista({ oculto: true, vista: 'todos' }), false);
  assert.equal(debeEncuestarLista({ oculto: false, vista: 'chat' }), false);
  assert.ok(INTERVALO_SONDEO_MS >= 5000 && INTERVALO_SONDEO_MS <= 10000);
});

test('app.js limpia la caja solo tras un envío exitoso y el refresco no la rellena', () => {
  // El bug: `$('#chat-texto').value = ''` estaba FUERA del onsubmit (al armar el form) y nunca tras enviar.
  const despuesSubmit = app.split("$('#f-chat').onsubmit")[1] || '';
  assert.match(despuesSubmit, /alExito:\s*async\s*\(\)\s*=>\s*\{[^}]*entrada\.value = '';/s);
  assert.match(despuesSubmit, /chatBorrador = ''/);
  assert.match(despuesSubmit, /alError:\s*\(err\)\s*=>\s*avisar\('No se pudo enviar'/);
  // El refresco solo toca #chat-msgs, nunca el input.
  const refrescar = app.split('async function refrescarChat()')[1].split('function detenerEnVivo')[0];
  assert.match(refrescar, /#chat-msgs/);
  assert.doesNotMatch(refrescar, /chat-texto/);
  assert.doesNotMatch(refrescar, /entrada\.value/);
  // Si se reconstruye la vista, se restaura el borrador; no se vacía al pintar.
  assert.match(app, /if \(borrador\) entrada\.value = borrador/);
  assert.doesNotMatch(app, /\$\('#chat-texto'\)\.value = ''/);
});

test('el tiempo real va encendido solo, sin casilla de experimento, y hay sondeo + canal', () => {
  assert.doesNotMatch(app, /chat-rt/);
  assert.doesNotMatch(app, /Tiempo real \(experimento\)/);
  assert.doesNotMatch(css, /chat-rt/);
  assert.match(app, /arrancarEnVivo\(\)/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /postgres_changes/);
  assert.match(app, /INTERVALO_SONDEO_MS/);
  assert.match(app, /TOKEN_REFRESHED/);
  assert.match(app, /document\.hidden/);
  // Service worker: nueva carcasa e incluye chat.js (si no, la app vieja se queda en caché).
  assert.match(sw, /buzon-v21-temas/);
  assert.doesNotMatch(sw, /buzon-v18-un-buzon/);
  assert.match(sw, /'chat\.js'/);
});
