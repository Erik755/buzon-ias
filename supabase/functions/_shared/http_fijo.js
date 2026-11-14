// POST HTTP/1.1 por TLS a una IP YA VALIDADA (anti DNS rebinding): no se vuelve a resolver el DNS.
// SNI, verificación del certificado y cabecera Host usan el nombre original.
// conectar(ip, puerto, nombreTls) -> { readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>, close() }
const enc = new TextEncoder();
// Extrae del cuerpo de un error del receptor SOLO una pista corta y saneada para el log de la función
// (p. ej. "Automation [id] is disabled"): sin URLs, ids, claves ni nada largo; nunca va a la BD.
export function pistaReceptor(txt) {
  const i = (txt || '').indexOf('\r\n\r\n'); if (i < 0) return null;
  const m = /"(?:error|message|detail)"\s*:\s*"([^"]{1,300})"/.exec(txt.slice(i + 4));
  if (!m) return null;
  const limpio = m[1]
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\bbearer\s+\S+|\b(?:crsr_|whsec_|sk_|gh[opsu]_)\S*/gi, '[oculto]')
    .replace(/[A-Za-z0-9_+\/=.-]{20,}/g, '[oculto]')
    .replace(/[^\p{L}\p{N} .,:;'()\[\]_-]/gu, '')
    .slice(0, 120).trim();
  return limpio || null;
}
// conPista: devuelve { status, pista } (pista solo si no es 2xx) en lugar del número.
export async function postFijo({ url, ip, headers = {}, body, conectar, timeoutMs = 5000, conPista = false }) {
  const u = new URL(url);
  const cuerpo = typeof body === 'string' ? enc.encode(body) : new Uint8Array(body ?? []);
  const lineas = [`POST ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, 'Connection: close', `Content-Length: ${cuerpo.length}`,
    ...Object.entries(headers).filter(([k]) => !/^(host|connection|content-length)$/i.test(k)).map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]/g, '')}`)];
  let c, timer, vencido = false;
  const tiempo = new Promise((_, no) => { timer = setTimeout(() => { vencido = true; no(new Error('timeout')); }, timeoutMs); });
  try {
    return await Promise.race([tiempo, (async () => {
      c = await conectar(ip, Number(u.port || 443), u.hostname);
      // Si la conexión terminó de abrir después del timeout, se cierra de inmediato (no queda colgada).
      if (vencido) { try { c.close(); } catch {} throw new Error('timeout'); }
      const w = c.writable.getWriter();
      await w.write(enc.encode(lineas.join('\r\n') + '\r\n\r\n')); await w.write(cuerpo); w.releaseLock();
      const r = c.readable.getReader(); let txt = ''; const dec = new TextDecoder();
      while (!txt.includes('\r\n')) { const { value, done } = await r.read(); if (done) break; txt += dec.decode(value, { stream: true }); if (txt.length > 8192) break; }
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(txt);
      if (!m) { await r.cancel().catch(() => {}); throw new Error('respuesta invalida'); }
      const status = +m[1];
      if (!conPista) { await r.cancel().catch(() => {}); return status; }
      if (status >= 200 && status < 300) { await r.cancel().catch(() => {}); return { status, pista: null }; }
      // Error del receptor: se lee un poco más (máx. 4 KB) para la pista del log.
      while (txt.length < 4096 && !/"(?:error|message|detail)"\s*:\s*"[^"]*"/.test(txt)) { const { value, done } = await r.read(); if (done) break; txt += dec.decode(value, { stream: true }); }
      await r.cancel().catch(() => {});
      return { status, pista: pistaReceptor(txt.slice(0, 4096)) };
    })()]);
  } finally { clearTimeout(timer); try { c?.close(); } catch {} }
}
