// Lógica pura del layout de historial (filtrable y comprobable en tests).
import { normalizar } from './conectar.js';

export const PENDIENTES = ['pide_aprobacion', 'pide_cierre'];

export function filtrarHilos(hilos, { q = '', filtro = 'todos' } = {}) {
  const nq = normalizar(q);
  return (hilos ?? []).filter((h) => {
    if (filtro === 'pendientes' && !PENDIENTES.includes(h.estado)) return false;
    if (!nq) return true;
    const hay = [h.titulo, h.contexto, h.estado].map(normalizar).join(' ');
    return nq.split(/\s+/).every((tok) => hay.includes(tok));
  });
}

export function inicialDe(nombre) {
  const s = String(nombre ?? '').trim();
  if (!s) return '?';
  const ch = [...s].find((c) => /\p{L}|\p{N}/u.test(c));
  return (ch || s[0]).toUpperCase();
}

export function hiloCerrado(estado) {
  return ['cerrado', 'aprobado', 'rechazado'].includes(estado);
}
