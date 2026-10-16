// Protección SSRF para webhooks y endpoints push. JS puro (Deno y Node 22).
// Reglas: solo https, puerto 443, sin usuario/clave en la URL, el host no puede ser IP privada/reservada
// ni resolver a una (A y AAAA). Las peticiones se hacen con redirect:'manual' (no se siguen redirecciones).
const V4_BLOQUEADAS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4num = (ip) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
export function esIPv4(s) { return /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((o) => +o <= 255); }
export function ipv4Bloqueada(ip) {
  const n = v4num(ip);
  return V4_BLOQUEADAS.some(([base, bits]) => ((n ^ v4num(base)) >>> (32 - bits)) === 0);
}
function expandir6(ip) {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const n = v4num(m[1]); s = s.slice(0, -m[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16)); }
  const [a, b] = s.split('::');
  const izq = a ? a.split(':') : [], der = b !== undefined && b ? b.split(':') : [];
  const relleno = b !== undefined ? Array(8 - izq.length - der.length).fill('0') : [];
  return [...izq, ...relleno, ...der].map((x) => parseInt(x || '0', 16));
}
export function esIPv6(s) { return s.includes(':'); }
export function ipv6Bloqueada(ip) {
  const g = expandir6(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x) || x > 0xffff)) return true;
  if (g.every((x) => x === 0)) return true;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;          // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) // ::ffff:a.b.c.d y ::a.b.c.d
    return ipv4Bloqueada([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.'));
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                           // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                 // fc00::/7 (incluye fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                 // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true;                                 // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                         // documentación
  if (g[0] === 0x2002) return true;                                            // 6to4 (puede envolver IPv4 privada)
  return false;
}
export const HOSTS_BLOQUEADOS = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$|^metadata(\.google\.internal)?$/i;

// Valida la URL y resuelve el host. `resolver(host)` devuelve una lista de IPs.
export async function validarDestino(url, resolver) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, motivo: 'url_invalida' }; }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'solo_https' };
  if (u.username || u.password) return { ok: false, motivo: 'credenciales_en_url' };
  if (u.port && u.port !== '443') return { ok: false, motivo: 'puerto_no_permitido' };
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || HOSTS_BLOQUEADOS.test(host)) return { ok: false, motivo: 'host_bloqueado' };
  if (esIPv4(host)) return ipv4Bloqueada(host) ? { ok: false, motivo: 'ip_privada' } : { ok: true, ips: [host] };
  if (esIPv6(host)) return ipv6Bloqueada(host) ? { ok: false, motivo: 'ip_privada' } : { ok: true, ips: [host] };
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return { ok: false, motivo: 'ip_ofuscada' };
  let ips;
  try { ips = await resolver(host); } catch { return { ok: false, motivo: 'dns_fallo' }; }
  if (!ips?.length) return { ok: false, motivo: 'dns_vacio' };
  for (const ip of ips) if (esIPv4(ip) ? ipv4Bloqueada(ip) : ipv6Bloqueada(ip)) return { ok: false, motivo: 'resuelve_a_ip_privada' };
  return { ok: true, ips };
}
