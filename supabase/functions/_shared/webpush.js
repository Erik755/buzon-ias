// Web Push sin dependencias (WebCrypto): cifrado RFC 8291 (aes128gcm) + VAPID RFC 8292 (ES256). Deno y Node 22.
const enc = new TextEncoder();
export const b64u = {
  dec: (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); },
  enc: (u) => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
};
const cat = (...a) => { const r = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { r.set(x, o); o += x.length; } return r; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
const jwkPub = (raw) => ({ kty: 'EC', crv: 'P-256', x: b64u.enc(raw.slice(1, 33)), y: b64u.enc(raw.slice(33, 65)), ext: true });

// Cifra `texto` para la suscripción { p256dh, auth }. `prueba` permite fijar llaves y salt (vectores del RFC).
export async function cifrar(texto, { p256dh, auth }, prueba = {}) {
  const uaPub = b64u.dec(p256dh), secreto = b64u.dec(auth);
  let asPriv, asPub;
  if (prueba.privada) {
    asPub = b64u.dec(prueba.publica);
    asPriv = await crypto.subtle.importKey('jwk', { ...jwkPub(asPub), d: prueba.privada }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPriv = kp.privateKey; asPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  const ikm = await hkdf(secreto, compartido, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = prueba.salt ? b64u.dec(prueba.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

// Cabecera VAPID: "vapid t=<JWT>, k=<clave pública>"
export async function vapid(endpoint, { publica, privada, sujeto }, ahora = Math.floor(Date.now() / 1000)) {
  const pub = b64u.dec(publica);
  const key = await crypto.subtle.importKey('jwk', { ...jwkPub(pub), d: privada }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: ahora + 12 * 3600, sub: sujeto })));
  const firma = b64u.enc(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${h}.${p}`)));
  return `vapid t=${h}.${p}.${firma}, k=${publica}`;
}

// Notificación mínima: solo un título corto y la ruta a abrir. Nunca el contenido.
export function payloadPush(evento, titulo, hiloId) {
  const t = String(titulo || '').slice(0, 80);
  return JSON.stringify({ titulo: evento === 'pide_aprobacion' ? 'Te piden aprobación' : 'Hilo nuevo en tu buzón', cuerpo: t, url: `./?hilo=${hiloId}` });
}

export async function enviarPush(sub, payload, claves, fetchFn = fetch) {
  const cuerpo = await cifrar(payload, sub);
  return fetchFn(sub.endpoint, { method: 'POST', redirect: 'manual', headers: {
    Authorization: await vapid(sub.endpoint, claves), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal',
  }, body: cuerpo });
}
