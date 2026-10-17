// POST /api/canje {codigo:"bzc_…"} -> {token:"bz_…"}  (o el token solo, si Accept: text/plain)
// Sin estado: la BD aplica un solo uso, caducidad, límite de intentos y auditoría (canjear_codigo_config).
export function crearCanje(rpc) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(); }
    let cuerpo = req.body;
    if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = null; } }
    const codigo = typeof cuerpo?.codigo === 'string' ? cuerpo.codigo.trim() : '';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
    const texto = /text\/plain/.test(req.headers.accept || '');
    const fin = (status, obj) => {
      res.statusCode = status;
      if (texto) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end(obj.token ?? ''); }
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(JSON.stringify(obj));
    };
    let r;
    try { r = await rpc('canjear_codigo_config', { p_codigo: codigo, p_ip: ip }); }
    catch (e) {
      const m = /^(\d{3}):(.*)$/s.exec(e.message || '');
      if (m) return fin(+m[1], { error: m[2] });
      console.error(e); return fin(500, { error: 'Error interno' });
    }
    if (r?.error) { const m = /^(\d{3}):(.*)$/s.exec(r.error); return fin(m ? +m[1] : 400, { error: m ? m[2] : r.error }); }
    return fin(200, { token: r.token, agente: r.agente, alcances: r.alcances, vence_en: r.vence_en,
      siguiente: 'Guarda el token solo en una variable de entorno o gestor de secretos. No lo pegues en el chat.' });
  };
}
