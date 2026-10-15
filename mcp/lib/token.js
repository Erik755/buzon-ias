import { createHash, randomBytes } from 'node:crypto';
export const PREFIJO = 'bz_';
export function nuevoToken() { return PREFIJO + randomBytes(32).toString('base64url'); }
export function hashToken(t) { return createHash('sha256').update(t, 'utf8').digest('hex'); }
export function extraerBearer(header) {
  const m = /^(?:Bearer\s+)?(bz_[A-Za-z0-9_-]{20,})$/.exec((header || '').trim());
  return m ? m[1] : null;
}
