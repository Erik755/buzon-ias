// Qué hacer cuando la pestaña vuelve al frente o Android descarta la página.
// Un TOKEN_REFRESHED o un SIGNED_IN del mismo usuario (típico al volver de otra app)
// no debe reconstruir la vista: eso cerraba el formulario y tiraba lo escrito.
// Los borradores van a sessionStorage, no a localStorage: sobrevive a que Android
// tire el documento de esta pestaña (el usuario fue a copiar una clave) y muere
// al cerrar la pestaña. La clave del webhook también va ahí, y solo ahí, porque
// si se queda solo en memoria se pierde justo en ese cambio de app.

const MEMORIA = new Map();

export function accionAuth(ev, { usuarioActual = null, usuarioNuevo = null } = {}) {
  if (!usuarioNuevo) return 'salir';
  if (ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED' || ev === 'PASSWORD_RECOVERY') return 'ignorar';
  if (usuarioActual && usuarioActual === usuarioNuevo) return 'ignorar';
  if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') return 'entrar';
  return 'ignorar';
}

export function rutaHash({ vista, hilo } = {}) {
  if (vista === 'agentes') return '#agentes';
  if (vista === 'conectar') return '#conectar';
  if (hilo && /^[0-9a-f-]{36}$/i.test(hilo)) return `#chat/${hilo}`;
  return '#chat';
}

export function leerRuta(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (h === 'agentes' || h === 'conectar') return { vista: h, hilo: null };
  const m = /^chat\/([0-9a-f-]{36})$/i.exec(h);
  if (m) return { vista: 'chat', hilo: m[1] };
  return { vista: 'chat', hilo: null };
}

export function claveBorrador(usuarioId, formulario) {
  return `buzon-borrador:${usuarioId || 'anon'}:${formulario}`;
}

function vacio(datos) {
  if (datos == null || datos === '') return true;
  if (typeof datos === 'object') return !Object.values(datos).some((v) => v);
  return false;
}

export function guardarBorrador(storage, clave, datos) {
  if (vacio(datos)) {
    MEMORIA.delete(clave);
    try { storage?.removeItem(clave); } catch { /* modo privado o cuota */ }
    return;
  }
  MEMORIA.set(clave, datos);
  try { storage?.setItem(clave, JSON.stringify(datos)); } catch { /* cuota */ }
}

export function leerBorrador(storage, clave) {
  if (MEMORIA.has(clave)) return MEMORIA.get(clave);
  if (!storage) return null;
  try {
    const raw = storage.getItem(clave);
    if (!raw) return null;
    const datos = JSON.parse(raw);
    MEMORIA.set(clave, datos);
    return datos;
  } catch { return null; }
}

export function borrarBorrador(storage, clave) {
  MEMORIA.delete(clave);
  try { storage?.removeItem(clave); } catch { /* ya no está */ }
}

// Al cerrar sesión se tiran todos los borradores de esta pestaña, incluida la
// clave del webhook. sessionStorage es de la pestaña, no de la cuenta.
export function borrarBorradores(storage) {
  MEMORIA.clear();
  if (!storage) return;
  try {
    const claves = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('buzon-borrador:')) claves.push(k);
    }
    for (const k of claves) storage.removeItem(k);
  } catch { /* modo privado */ }
}

/** Simula que el proceso murió (Android descartó la página) pero sessionStorage sigue. */
export function reiniciarMemoriaBorradores() {
  MEMORIA.clear();
}

// Ninguno de estos eventos reconstruye la pantalla. onVisible solo refresca datos.
export function vigilarFoco({ document: doc, window: win }, { onVisible } = {}) {
  const alVer = () => {
    if (doc.visibilityState === 'visible' || doc.hidden === false) onVisible?.();
  };
  const nada = () => {};
  doc.addEventListener('visibilitychange', alVer);
  win.addEventListener('focus', nada);
  win.addEventListener('blur', nada);
  win.addEventListener('pageshow', nada);
  win.addEventListener('online', nada);
  return () => {
    doc.removeEventListener('visibilitychange', alVer);
    win.removeEventListener('focus', nada);
    win.removeEventListener('blur', nada);
    win.removeEventListener('pageshow', nada);
    win.removeEventListener('online', nada);
  };
}
