// Validación del tipo REAL de un adjunto (bytes mágicos), no de la extensión.
export const MAX_BYTES = 3 * 1024 * 1024; // 3 MB: cabe en el límite de 4.5 MB por petición de Vercel en base64
const empieza = (b, sig, off = 0) => sig.every((x, i) => b[off + i] === x);
export function detectarTipo(bytes, nombre = '') {
  const b = bytes, ext = (nombre.split('.').pop() || '').toLowerCase();
  if (empieza(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return ext === 'pdf' ? 'application/pdf' : null;              // %PDF-
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ext === 'png' ? 'image/png' : null;
  if (empieza(b, [0xff, 0xd8, 0xff])) return ['jpg', 'jpeg'].includes(ext) ? 'image/jpeg' : null;
  if (empieza(b, [0x52, 0x49, 0x46, 0x46]) && empieza(b, [0x57, 0x45, 0x42, 0x50], 8)) return ext === 'webp' ? 'image/webp' : null;
  if (ext === 'txt' || ext === 'md') {
    if (b.includes(0)) return null;
    let texto; try { texto = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
    if (/^\s*(<\?xml|<!doctype|<html|<svg|<script)/i.test(texto) || /<svg[\s>]|<script[\s>]/i.test(texto.slice(0, 4096))) return null;
    return ext === 'md' ? 'text/markdown' : 'text/plain';
  }
  return null;
}
export function nombreSeguro(n) {
  const s = String(n || '').normalize('NFC').replace(/[\\/\u0000-\u001f\u007f"<>|:*?]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return s || 'archivo';
}
export function deBase64(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const limpio = b64.replace(/\s+/g, '');
  if (limpio.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) return 'grande';
  try { const bin = atob(limpio); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch { return null; }
}
