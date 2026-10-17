// Secreto interno entre el MCP (o pg_cron) y las Edge Functions. Comparación en tiempo constante.
export function secretoValido(recibido, esperado) {
  if (!esperado || esperado.length < 32 || typeof recibido !== 'string' || recibido.length !== esperado.length) return false;
  let d = 0; for (let i = 0; i < esperado.length; i++) d |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return d === 0;
}
