// Perder el foco (cambiar de app, copiar una clave) no debe cerrar la pantalla ni borrar el formulario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  accionAuth, rutaHash, leerRuta, claveBorrador, guardarBorrador, leerBorrador, borrarBorrador,
  reiniciarMemoriaBorradores, vigilarFoco,
} from '../../pwa/foco.js';

const app = readFileSync(new URL('../../pwa/app.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../pwa/sw.js', import.meta.url), 'utf8');

function entorno() {
  const listeners = new Map();
  const on = (tipo, fn) => listeners.set(tipo, [...(listeners.get(tipo) || []), fn]);
  const document = {
    hidden: true,
    visibilityState: 'hidden',
    addEventListener(tipo, fn) { on(tipo, fn); },
    removeEventListener(tipo, fn) { listeners.set(tipo, (listeners.get(tipo) || []).filter((f) => f !== fn)); },
    dispatch(tipo) { for (const fn of listeners.get(tipo) || []) fn(); },
  };
  const window = {
    addEventListener(tipo, fn) { on('w:' + tipo, fn); },
    removeEventListener(tipo, fn) { listeners.set('w:' + tipo, (listeners.get('w:' + tipo) || []).filter((f) => f !== fn)); },
    dispatch(tipo) { for (const fn of listeners.get('w:' + tipo) || []) fn(); },
  };
  return { document, window };
}

function memoria() {
  const bag = new Map();
  return {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(k, v),
    removeItem: (k) => bag.delete(k),
  };
}

test('visibilitychange, blur, focus, pageshow, online y TOKEN_REFRESHED no cambian la pantalla ni el formulario', () => {
  const { document, window } = entorno();
  let suaves = 0;
  vigilarFoco({ document, window }, { onVisible() { suaves++; } });
  const estado = { vista: 'agentes', usuario: 'erik', url: 'https://hooks.ejemplo.dev/grok', clave: 'whsec-super-secreta' };
  let repintados = 0;
  const alAuth = (ev) => {
    const accion = accionAuth(ev, { usuarioActual: estado.usuario, usuarioNuevo: estado.usuario });
    if (accion === 'entrar') { repintados++; estado.vista = 'chat'; }
  };
  document.hidden = false;
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  window.dispatch('blur');
  window.dispatch('focus');
  window.dispatch('pageshow');
  window.dispatch('online');
  alAuth('TOKEN_REFRESHED');
  alAuth('SIGNED_IN');
  assert.equal(repintados, 0, 'un SIGNED_IN del mismo usuario no reconstruye la vista');
  assert.equal(suaves, 1, 'volver a ser visible solo refresca datos');
  assert.equal(estado.vista, 'agentes');
  assert.equal(estado.url, 'https://hooks.ejemplo.dev/grok');
  assert.equal(estado.clave, 'whsec-super-secreta');

  document.hidden = true;
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  assert.equal(suaves, 1);
  assert.equal(estado.vista, 'agentes');
});

test('el primer inicio sí entra, y un borrador sobrevive a que se descarte la página', () => {
  assert.equal(accionAuth('INITIAL_SESSION', { usuarioActual: null, usuarioNuevo: 'erik' }), 'entrar');
  assert.equal(accionAuth('SIGNED_IN', { usuarioActual: null, usuarioNuevo: 'erik' }), 'entrar');
  assert.equal(accionAuth('SIGNED_OUT', { usuarioActual: 'erik', usuarioNuevo: null }), 'salir');
  assert.equal(accionAuth('TOKEN_REFRESHED', { usuarioActual: 'erik', usuarioNuevo: 'erik' }), 'ignorar');
  assert.equal(accionAuth('USER_UPDATED', { usuarioActual: 'erik', usuarioNuevo: 'erik' }), 'ignorar');

  const storage = memoria();
  const uid = 'erik';
  guardarBorrador(storage, claveBorrador(uid, 'hilo-nuevo'), { titulo: 'Revisar el torno', para: 'Grok', abierto: true });
  guardarBorrador(storage, claveBorrador(uid, 'chat:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'respuesta a medias');
  guardarBorrador(storage, claveBorrador(uid, 'wh-url:ag1'), 'https://hooks.ejemplo.dev/grok');
  // La clave no va a localStorage. sessionStorage aguanta el descarte de la pestaña en Android.
  guardarBorrador(storage, claveBorrador(uid, 'wh-clave:ag1'), 'clave-de-grok-123456');
  reiniciarMemoriaBorradores();
  assert.deepEqual(leerBorrador(storage, claveBorrador(uid, 'hilo-nuevo')), { titulo: 'Revisar el torno', para: 'Grok', abierto: true });
  assert.equal(leerBorrador(storage, claveBorrador(uid, 'chat:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')), 'respuesta a medias');
  assert.equal(leerBorrador(storage, claveBorrador(uid, 'wh-url:ag1')), 'https://hooks.ejemplo.dev/grok');
  assert.equal(leerBorrador(storage, claveBorrador(uid, 'wh-clave:ag1')), 'clave-de-grok-123456');
  borrarBorrador(storage, claveBorrador(uid, 'wh-clave:ag1'));
  borrarBorrador(storage, claveBorrador(uid, 'hilo-nuevo'));
  reiniciarMemoriaBorradores();
  assert.equal(leerBorrador(storage, claveBorrador(uid, 'wh-clave:ag1')), null);
  assert.equal(leerBorrador(storage, claveBorrador(uid, 'hilo-nuevo')), null);

  assert.equal(rutaHash({ vista: 'agentes' }), '#agentes');
  assert.equal(rutaHash({ vista: 'conectar' }), '#conectar');
  assert.equal(rutaHash({ vista: 'chat', hilo: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }), '#chat/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.deepEqual(leerRuta('#agentes'), { vista: 'agentes', hilo: null });
  assert.deepEqual(leerRuta('#chat/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), { vista: 'chat', hilo: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
});

test('la app no repinta al volver el foco y recuerda la ruta y los borradores', () => {
  assert.match(app, /accionAuth\(/);
  assert.match(app, /TOKEN_REFRESHED/);
  const online = app.split("addEventListener('online'")[1].split('addEventListener')[0];
  assert.doesNotMatch(online, /pintar\(/);
  assert.match(online, /!sesionLista/);
  assert.match(online, /entrarSesion\(/);
  assert.match(app, /vigilarFoco\(/);
  assert.match(app, /rutaHash\(/);
  assert.match(app, /leerRuta\(/);
  assert.match(app, /wh-clave:/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*wh-clave|localStorage\.setItem\([^)]*webhook/);
  assert.match(sw, /foco\.js/);
  assert.match(sw, /buzon-v27-foco/);
});
