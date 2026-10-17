// POST HTTP/1.1 por TLS a una IP YA VALIDADA (anti DNS rebinding): no se vuelve a resolver el DNS.
// SNI, verificación del certificado y cabecera Host usan el nombre original.
// conectar(ip, puerto, nombreTls) -> { readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>, close() }
const enc = new TextEncoder();
export async function postFijo({ url, ip, headers = {}, body, conectar, timeoutMs = 5000 }) {
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
      const r = c.readable.getReader(); let txt = '';
      while (!txt.includes('\r\n')) { const { value, done } = await r.read(); if (done) break; txt += new TextDecoder().decode(value); if (txt.length > 8192) break; }
      await r.cancel().catch(() => {});
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(txt);
      if (!m) throw new Error('respuesta invalida');
      return +m[1];
    })()]);
  } finally { clearTimeout(timer); try { c?.close(); } catch {} }
}
