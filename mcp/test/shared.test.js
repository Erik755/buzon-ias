// Módulos compartidos de las Edge Functions (SSRF, HMAC, Web Push, tipos de archivo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarDestino, ipv4Bloqueada, ipv6Bloqueada } from '../../supabase/functions/_shared/ssrf.js';
import { firmar, verificar, payloadTarea } from '../../supabase/functions/_shared/hmac.js';
import { cifrar, vapid, b64u, payloadPush } from '../../supabase/functions/_shared/webpush.js';
import { detectarTipo, deBase64, nombreSeguro, MAX_BYTES } from '../../supabase/functions/_shared/tipos.js';

const dns = (mapa) => async (h) => { if (!(h in mapa)) throw new Error('nx'); return mapa[h]; };

test('SSRF: bloquea esquemas, puertos, credenciales y hosts internos', async () => {
  const r = dns({});
  for (const [u, m] of [['http://example.com/x', 'solo_https'], ['ftp://x.com', 'solo_https'], ['https://a:b@x.com', 'credenciales_en_url'],
    ['https://x.com:8443/', 'puerto_no_permitido'], ['https://localhost/', 'host_bloqueado'], ['https://foo.internal/', 'host_bloqueado'],
    ['https://metadata.google.internal/', 'host_bloqueado'], ['https://169.254.169.254/latest/meta-data', 'ip_privada'], ['https://127.0.0.1/', 'ip_privada'],
    ['https://10.1.2.3/', 'ip_privada'], ['https://192.168.0.1/', 'ip_privada'], ['https://172.20.0.1/', 'ip_privada'], ['https://100.64.0.1/', 'ip_privada'],
    ['https://[::1]/', 'ip_privada'], ['https://[fd00:ec2::254]/', 'ip_privada'], ['https://[::ffff:169.254.169.254]/', 'ip_privada'], ['https://[fe80::1]/', 'ip_privada'],
    ['https://2130706433/', 'ip_privada'], ['https://0x7f000001/', 'ip_privada'], ['no es url', 'url_invalida']])
    assert.equal((await validarDestino(u, r)).motivo, m, u);
});
test('SSRF: bloquea dominios que resuelven a IP privada o de metadata (DNS)', async () => {
  const r = dns({ 'rebind.example': ['93.184.216.34', '169.254.169.254'], 'v6.example': ['fd12::1'], 'ok.example': ['93.184.216.34'] });
  assert.equal((await validarDestino('https://rebind.example/h', r)).motivo, 'resuelve_a_ip_privada');
  assert.equal((await validarDestino('https://v6.example/h', r)).motivo, 'resuelve_a_ip_privada');
  assert.equal((await validarDestino('https://noexiste.example/h', r)).motivo, 'dns_fallo');
  assert.equal((await validarDestino('https://ok.example/h', r)).ok, true);
  assert.equal(ipv4Bloqueada('8.8.8.8'), false); assert.equal(ipv6Bloqueada('2607:f8b0::1'), false);
});
test('HMAC: firma verificable, rechaza alteraciones y firmas viejas; payload sin contenido', async () => {
  const s = 'whsec_prueba', body = payloadTarea('11111111-1111-1111-1111-111111111111');
  const f = await firmar(s, body);
  assert.equal(await verificar(s, body, f), true);
  assert.equal(await verificar(s, body + ' ', f), false);
  assert.equal(await verificar('otro', body, f), false);
  assert.equal(await verificar(s, body, await firmar(s, body, 1000)), false);
  assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['aviso', 'evento', 'hilo_id']);
});
test('Web Push: cifrado idéntico al ejemplo del RFC 8291', async () => {
  const esperado = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  const out = await cifrar('When I grow up, I want to be a watermelon',
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { privada: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', publica: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(b64u.enc(out), esperado);
});
test('Web Push: JWT VAPID ES256 válido y payload solo con título', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const h = await vapid('https://fcm.googleapis.com/fcm/send/abc', { publica: b64u.enc(raw), privada: jwk.d, sujeto: 'mailto:x@y.z' });
  const [, jwt] = /t=([^,]+),/.exec(h); const [a, b, c] = jwt.split('.');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64u.dec(c), new TextEncoder().encode(`${a}.${b}`)));
  assert.equal(JSON.parse(new TextDecoder().decode(b64u.dec(b))).aud, 'https://fcm.googleapis.com');
  const p = JSON.parse(payloadPush('pide_aprobacion', 'x'.repeat(500), 'id'));
  assert.equal(p.cuerpo.length, 80); assert.deepEqual(Object.keys(p).sort(), ['cuerpo', 'titulo', 'url']);
});
test('Adjuntos: tipo real por bytes mágicos; rechaza disfraces, SVG y HTML', () => {
  const B = (s) => new TextEncoder().encode(s), H = (...x) => new Uint8Array(x);
  assert.equal(detectarTipo(B('%PDF-1.7\n...'), 'a.pdf'), 'application/pdf');
  assert.equal(detectarTipo(H(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'a.png'), 'image/png');
  assert.equal(detectarTipo(H(0xff, 0xd8, 0xff, 0xe0), 'a.JPG'), 'image/jpeg');
  assert.equal(detectarTipo(B('RIFF\0\0\0\0WEBPVP8 '), 'a.webp'), 'image/webp');
  assert.equal(detectarTipo(B('# Hola\nmundo'), 'n.md'), 'text/markdown');
  assert.equal(detectarTipo(B('hola'), 'n.txt'), 'text/plain');
  assert.equal(detectarTipo(B('%PDF-1.7'), 'a.png'), null, 'PDF disfrazado de PNG');
  assert.equal(detectarTipo(B('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'), 'a.txt'), null);
  assert.equal(detectarTipo(B('<!doctype html><script>alert(1)</script>'), 'a.md'), null);
  assert.equal(detectarTipo(B('MZ\x90\0'), 'a.exe'), null);
  assert.equal(detectarTipo(H(0xc3, 0x28), 'a.txt'), null, 'UTF-8 inválido');
  assert.equal(detectarTipo(B('hola\0'), 'a.txt'), null, 'binario');
  assert.equal(detectarTipo(B('<svg/>'), 'a.svg'), null);
  assert.equal(deBase64('A'.repeat(Math.ceil(MAX_BYTES / 3) * 4 + 8)), 'grande');
  assert.equal(deBase64('no*es*base64'), null);
  assert.equal(nombreSeguro('../../etc/passwd'), '_.._etc_passwd'.replace(/^_/, '_'));
  assert.ok(!/[\\/]/.test(nombreSeguro('a/b\\c.pdf')));
});
