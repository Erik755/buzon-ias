import { createClient } from './vendor/supabase.js';
import * as CFG from './config.js';
import { GUIAS, ETIQUETA, QUE_HACER } from './guias.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, MCP_URL } = CFG;
const VAPID = CFG.VAPID_PUBLIC_KEY || '';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (f) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
let usuario, buzon, vista = 'pendientes', tokenGuia = '';
const URL_MCP = MCP_URL || 'https://buzon-ias-mcp.vercel.app/api/mcp';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
const avisoRed = () => { $('#sin-red').hidden = navigator.onLine; };
addEventListener('online', () => { avisoRed(); if (usuario) asegurarBuzon().then(pintar).catch(() => {}); });
addEventListener('offline', avisoRed); avisoRed();

$('#f-login').onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithOtp({ email: $('#email').value, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
  $('#login-msg').textContent = error ? (/signups? not allowed|not found/i.test(error.message) ? 'Ese correo no tiene cuenta todavía. Pídele al administrador que te invite.' : 'Error: ' + error.message) : 'Listo. Revisa tu correo 📩 y abre el enlace en este mismo teléfono.';
};
$('#salir').onclick = () => sb.auth.signOut();
$('#ver-guias').onclick = () => { const g = $('#guias-publicas'); if (g.childElementCount) g.innerHTML = ''; else pintarGuias(g, false); };
function irA(v) { document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('activa', x.dataset.vista === v)); vista = v; pintar(); }
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('activa', x === b)); vista = b.dataset.vista; pintar();
});

sb.auth.onAuthStateChange(async (_ev, ses) => {
  usuario = ses?.user ?? null;
  $('#login').hidden = !!usuario; $('#app').hidden = !usuario; $('#salir').hidden = !usuario;
  if (usuario) {
    try { await asegurarBuzon(); pintar(); const h = new URLSearchParams(location.search).get('hilo'); if (/^[0-9a-f-]{36}$/.test(h || '')) { history.replaceState(null, '', location.pathname); abrirHilo(h); } }
    catch (e) { $('#vista').innerHTML = !navigator.onLine || /fetch|network/i.test(e.message)
      ? `<div class="vacio"><b>📡 Sin conexión</b>Tus tareas se cargarán solas cuando vuelva internet.</div>`
      : `<div class="vacio"><b>No pudimos abrir tu buzón</b>${esc(e.message)}<br><br>Toca <b>Salir</b> y vuelve a entrar con el enlace de tu correo.</div>`; }
  }
});

async function asegurarBuzon() {
  let { data, error } = await sb.from('buzones').select('*').limit(1);
  if (!error && !data?.length) ({ data, error } = await sb.from('buzones').insert({ dueno_id: usuario.id, nombre: 'Mi buzón' }).select());
  if (error || !data?.length) throw new Error(error?.message || 'No se pudo abrir tu buzón');
  buzon = data[0];
}

async function pintar() {
  const v = $('#vista'); v.innerHTML = '<p class="meta">Cargando…</p>';
  if (vista === 'agentes') return pintarAgentes(v);
  if (vista === 'conectar') { v.innerHTML = ''; return pintarGuias(v, true); }
  let q = sb.from('hilos').select('*, agentes!hilos_creado_por_agente_fkey(nombre,eliminado_en)').eq('buzon_id', buzon.id).order('creado_en', { ascending: false }).limit(50);
  if (vista === 'pendientes') q = q.eq('estado', 'pide_aprobacion');
  const { data, error } = await q;
  if (error) return v.innerHTML = !navigator.onLine || /fetch|network/i.test(error.message) ? '<div class="vacio"><b>📡 Sin conexión</b>Se cargará cuando vuelva internet.</div>' : esc(error.message);
  if (!data.length) {
    const { count } = await sb.from('agentes').select('id', { count: 'exact', head: true }).eq('buzon_id', buzon.id).is('eliminado_en', null);
    v.innerHTML = !count
      ? `<div class="vacio"><b>👋 Empecemos</b>Todavía no conectas ninguna IA.<br>1) Crea un agente en <b>Agentes</b> (uno por IA).<br>2) Sigue la guía en <b>Conectar</b>.<br>3) Pídele a tu IA: <i>"Deja una tarea en mi buzón"</i>.<br><br><button class="ok" id="ir-agentes">Crear mi primer agente</button></div>`
      : vista === 'pendientes'
        ? `<div class="vacio"><b>Nada por aprobar 🎉</b>Cuando una IA te pida permiso, aparecerá aquí. Prueba pedirle a una IA: <i>"Lee mi buzón, toma la tarea y pídeme aprobación cuando acabes"</i>.</div>`
        : `<div class="vacio"><b>Tu historial está vacío</b>Pídele a una IA conectada: <i>"Deja en mi buzón una tarea: …"</i> y aquí verás todo lo que pase.</div>`;
    $('#ir-agentes') && ($('#ir-agentes').onclick = () => irA('agentes'));
    return;
  }
  v.innerHTML = '';
  for (const h of data) {
    const d = document.createElement('div'); d.className = 'tarjeta';
    d.innerHTML = `<span class="estado">${esc(h.estado)}</span><b>${esc(h.titulo)}</b>
      <div class="meta">${esc(h.tipo)} · ${esc(nombreAutor(h.agentes, '—'))} · ${fecha(h.creado_en)}</div>`;
    d.onclick = () => abrirHilo(h.id); v.append(d);
  }
}

async function abrirHilo(id) {
  const [{ data: h }, { data: ms }, { data: ap }, { data: adj }] = await Promise.all([
    sb.from('hilos').select('*').eq('id', id).single(),
    sb.from('mensajes').select('*, agentes(nombre,eliminado_en)').eq('hilo_id', id).order('creado_en'),
    sb.from('aprobaciones').select('*').eq('hilo_id', id).order('creado_en'),
    sb.from('adjuntos').select('id,nombre,tipo,tamano,creado_en').eq('hilo_id', id).order('creado_en'),
  ]);
  if (!h) return;
  const c = $('#dlg-cuerpo');
  c.innerHTML = `<h3>${esc(h.titulo)}</h3><p class="meta">${esc(h.estado)}</p><div class="msg">${esc(h.contexto)}</div>
    ${ms.map((m) => `<div class="msg"><span class="meta">${esc(nombreAutor(m.agentes, 'Tú'))} · ${fecha(m.creado_en)}</span><br>${esc(m.cuerpo)}</div>`).join('')}
    ${adj?.length ? `<div class="msg"><b>📎 Adjuntos</b>${adj.map((a) => `<div class="fila-adj"><span>${ICONO[a.tipo] ?? '📄'} ${esc(a.nombre)} <span class="meta">${kb(a.tamano)}</span></span><button class="copiar" data-adj="${a.id}">Descargar</button></div>`).join('')}<p class="meta">Se descargan a tu teléfono; la app no los abre ni los ejecuta. El enlace dura 5 minutos.</p></div>` : ''}
    ${ap.map((a) => `<p>✅ ${esc(a.decision)} · ${esc(a.nota)} <span class="meta">${fecha(a.creado_en)}</span></p>`).join('')}
    <textarea id="nota" placeholder="Nota (opcional)"></textarea>
    ${h.estado === 'pide_aprobacion' ? '<div class="fila"><button class="ok" id="aprobar">Aprobar</button><button class="no" id="rechazar">Rechazar</button></div>' : ''}
    <button id="comentar">Comentar</button>`;
  const decidir = async (decision) => {
    const { error } = await sb.from('aprobaciones').insert({ hilo_id: id, humano_id: usuario.id, decision, nota: $('#nota').value || null });
    if (error) return alert(error.message);
    $('#dlg').close(); pintar();
  };
  c.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => descargarAdjunto(b.dataset.adj, b));
  $('#aprobar') && ($('#aprobar').onclick = () => decidir('aprobado'));
  $('#rechazar') && ($('#rechazar').onclick = () => decidir('rechazado'));
  $('#comentar').onclick = async () => {
    const cuerpo = $('#nota').value.trim(); if (!cuerpo) return;
    const { error } = await sb.from('mensajes').insert({ hilo_id: id, autor_humano: usuario.id, cuerpo });
    if (error) return alert(error.message); abrirHilo(id);
  };
  $('#dlg').showModal();
}

const ICONO = { 'application/pdf': '📕', 'image/png': '🖼️', 'image/jpeg': '🖼️', 'image/webp': '🖼️', 'text/plain': '📄', 'text/markdown': '📝' };
const kb = (n) => n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
// Pide a la Edge Function una URL firmada (5 min) con la sesión del dueño; la descarga va como archivo adjunto.
async function descargarAdjunto(id, boton) {
  boton.disabled = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/adjuntos`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ accion: 'firmar', adjunto_id: id }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'No se pudo descargar');
    const u = new URL(j.url);
    if (u.origin !== new URL(SUPABASE_URL).origin) throw new Error('Enlace inesperado');
    const a = document.createElement('a'); a.href = u.href; a.rel = 'noopener noreferrer'; a.download = j.nombre; document.body.append(a); a.click(); a.remove();
  } catch (e) { alert(e.message); } finally { boton.disabled = false; }
}

async function sha256hex(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function nuevoToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return 'bz_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const nombreAutor = (ag, sin) => (!ag ? sin : ag.eliminado_en ? 'agente eliminado' : ag.nombre);
const DIAS_INACTIVO = 30;
const esInactivo = (u) => !u || Date.now() - new Date(u) > DIAS_INACTIVO * 864e5;
let soloActivos = false;

async function borrarAgentes(ids) {
  const { data, error } = await sb.rpc('borrar_agentes', { p_agentes: ids });
  if (error) { alert('No se pudo borrar: ' + error.message); return false; }
  return data;
}

async function pintarAgentes(v) {
  const [{ data: ags }, { data: est }] = await Promise.all([
    sb.from('agentes').select('id,nombre,creado_en,webhook_url, tokens(id,alcances,vence_en,revocado_en,ultimo_uso)').eq('buzon_id', buzon.id).is('eliminado_en', null).order('creado_en'),
    sb.from('estado_agentes').select('agente_id,ultimo_uso,ultima_accion,accion').eq('buzon_id', buzon.id),
  ]);
  const estado = Object.fromEntries((est ?? []).map((e) => [e.agente_id, e]));
  v.innerHTML = (ags.length ? '' : `<div class="vacio"><b>Crea un agente por cada IA</b>Un "agente" es la llave de una IA para entrar a tu buzón. Ponle el nombre de la IA (ej. "Claude"). Te daremos un token para pegar en esa IA; si un día no quieres que entre, lo revocas aquí.</div>`)
    + `<form id="f-ag" class="tarjeta"><b>Nuevo agente</b><input id="ag-nombre" required placeholder="Claude, ChatGPT, Grok…">
    <select id="ag-dias"><option value="7">7 días</option><option value="30" selected>30 días</option><option value="90">90 días</option></select>
    <button class="ok">Crear y generar clave</button></form>
    <form id="f-nl" class="tarjeta"><b>🗣️ Conectar con lenguaje natural (Grok, Codex)</b>
    <p class="meta">Genera un <b>código de un solo uso</b> que dura pocos minutos. Tu IA te guía para cambiarlo por su token en tu terminal, sin pegar nada en el chat. Guía en <b>Conectar</b>.</p>
    <input id="nl-nombre" required maxlength="60" placeholder="Nombre de la IA (Grok, Codex…)">
    <select id="nl-min"><option value="5">Dura 5 min</option><option value="10" selected>Dura 10 min</option><option value="15">Dura 15 min</option></select>
    <button class="ok">Generar código</button><div id="nl-lista"></div></form>
    <div class="tarjeta"><b>Tus agentes</b> <span class="meta">(${ags.length})</span>
    <label class="meta" style="display:flex;align-items:center;gap:8px;margin:8px 0"><input type="checkbox" id="solo-act" style="width:20px;height:20px;margin:0;flex:none" ${soloActivos ? 'checked' : ''}> Mostrar solo activos</label>
    <button class="secundario" id="limpiar">🧹 Limpiar inactivos</button><div id="limpiar-lista"></div>
    <p class="meta">Inactivo = no se ha usado en ${DIAS_INACTIVO} días o nunca se conectó. Borrar un agente quita su acceso para siempre; sus hilos y mensajes se quedan como "agente eliminado".</p></div>
    <div class="tarjeta"><b>🔔 Avisos en este teléfono</b><p class="meta">Te avisamos cuando una IA te pida aprobación o deje un hilo nuevo. El aviso solo trae el título, nunca el contenido.</p><div id="push-caja"></div></div>`;
  for (const a of ags) {
    if (soloActivos && esInactivo(estado[a.id]?.ultimo_uso)) continue;
    const d = document.createElement('div'); d.className = 'tarjeta';
    const e = estado[a.id];
    d.innerHTML = `<b>${esc(a.nombre)}</b> <span class="estado">${conexion(e?.ultimo_uso)}</span>
      <div class="meta">${e?.ultima_accion ? 'Última acción: ' + esc(e.accion) + ' · ' + hace(e.ultima_accion) : 'Todavía no ha usado el buzón'}</div>
      <div class="fila"><button class="copiar" data-probar="${a.id}">Probar conexión</button><button class="no" data-borrar="${a.id}">Borrar</button></div>
      <details class="guia"><summary>Webhook (opcional)</summary><p class="meta">Si esta IA tiene una dirección https que recibe avisos, le mandamos solo el id de la tarea nueva, firmado con HMAC. Nunca el contenido.</p>
      <input data-wh="${a.id}" type="url" placeholder="https://…" value="${esc(a.webhook_url ?? '')}" maxlength="500"><div class="fila"><button data-whg="${a.id}">Guardar</button><button data-whs="${a.id}" class="secundario">Generar secreto</button></div></details>` + a.tokens.map((t) => `<div class="meta">${t.revocado_en ? '⛔ revocado' : new Date(t.vence_en) < new Date() ? '⌛ vencido' : '🟢 activo'}
      · vence ${fecha(t.vence_en)} · último uso ${t.ultimo_uso ? fecha(t.ultimo_uso) : 'nunca'}
      ${!t.revocado_en ? `<button data-rev="${t.id}" class="no">Revocar</button>` : ''}</div>`).join('');
    v.append(d);
  }
  v.querySelectorAll('[data-probar]').forEach((b) => b.onclick = () => probarConexion(ags.find((a) => a.id === b.dataset.probar), estado[b.dataset.probar]?.ultimo_uso));
  $('#solo-act').onchange = (e) => { soloActivos = e.target.checked; pintar(); };
  v.querySelectorAll('[data-borrar]').forEach((b) => b.onclick = async () => {
    const a = ags.find((x) => x.id === b.dataset.borrar);
    if (!confirm(`¿Borrar "${a.nombre}"?\n\nSe revocan sus claves y códigos, se quita su webhook y ya no podrá entrar. Sus hilos y mensajes se quedan como "agente eliminado". No se puede deshacer.`)) return;
    if (await borrarAgentes([a.id])) pintar();
  });
  $('#limpiar').onclick = () => {
    const inact = ags.filter((a) => esInactivo(estado[a.id]?.ultimo_uso));
    const caja = $('#limpiar-lista');
    if (!inact.length) { caja.innerHTML = '<p class="meta">✓ No hay agentes inactivos.</p>'; return; }
    caja.innerHTML = `<p class="meta">Se borrarán estos ${inact.length}:</p><ul>${inact.map((a) => `<li>${esc(a.nombre)} · ${estado[a.id]?.ultimo_uso ? 'último uso ' + fecha(estado[a.id].ultimo_uso) : 'nunca se conectó'}</li>`).join('')}</ul>
      <div class="fila"><button class="no" id="limpiar-ok" style="white-space:nowrap">Borrar ${inact.length}</button><button class="secundario" id="limpiar-no">Cancelar</button></div>`;
    $('#limpiar-no').onclick = () => (caja.innerHTML = '');
    $('#limpiar-ok').onclick = async () => {
      if (!confirm(`¿Borrar ${inact.length} agente(s) inactivo(s)? No se puede deshacer.`)) return;
      if (await borrarAgentes(inact.map((a) => a.id))) pintar();
    };
  };
  v.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
    if (!confirm('¿Revocar este token? Tiene efecto inmediato.')) return;
    const { data, error } = await sb.from('tokens').update({ revocado_en: new Date().toISOString() }).eq('id', b.dataset.rev).select('id');
    if (error || !data?.length) return alert('No se pudo revocar el token: ' + (error?.message ?? 'sin permiso o no existe') + '. Intenta de nuevo.');
    pintar();
  });
  v.querySelectorAll('[data-whg]').forEach((b) => b.onclick = async () => {
    const url = v.querySelector(`[data-wh="${b.dataset.whg}"]`).value.trim() || null;
    if (url && !/^https:\/\/[^/@\s]+(\/\S*)?$/.test(url)) return alert('La dirección debe empezar con https:// (sin usuario ni contraseña).');
    const { data, error } = await sb.from('agentes').update({ webhook_url: url }).eq('id', b.dataset.whg).select('id');
    if (error || !data?.length) return alert('No se pudo guardar: ' + (error?.message ?? 'sin permiso'));
    b.textContent = '✔ Guardado'; setTimeout(() => (b.textContent = 'Guardar'), 1500);
  });
  v.querySelectorAll('[data-whs]').forEach((b) => b.onclick = async () => {
    if (!confirm('¿Generar un secreto nuevo? El anterior deja de servir.')) return;
    const { data, error } = await sb.rpc('rotar_secreto_webhook', { p_agente: b.dataset.whs });
    if (error) return alert(error.message);
    $('#dlg-cuerpo').innerHTML = `<h3>Secreto del webhook</h3><p>Cópialo ahora: <b>no se vuelve a mostrar</b>. Tu IA lo usa para verificar la cabecera <code>X-Buzon-Firma</code> (HMAC-SHA256 de "t.cuerpo").</p><code>${esc(data)}</code><div class="fila"><button class="ok" id="cp-whs">Copiar secreto</button></div>`;
    $('#cp-whs').onclick = () => copiar(data, $('#cp-whs')); $('#dlg').showModal();
  });
  pintarCodigos(); pintarPush();
  $('#f-nl').onsubmit = async (e) => {
    e.preventDefault();
    const nombre = $('#nl-nombre').value.trim();
    const { data, error } = await sb.rpc('crear_codigo_config', { p_buzon: buzon.id, p_nombre: nombre, p_minutos: +$('#nl-min').value });
    if (error) return alert(error.message);
    $('#dlg-cuerpo').innerHTML = `<h3>Código para ${esc(nombre)}</h3>
      <p class="aviso">⚠️ <b>No lo pegues en el chat.</b> Pégalo solo cuando tu terminal diga <i>"Código del buzón:"</i> (no se ve al escribir).</p>
      <code>${esc(data.codigo)}</code><div class="fila"><button class="ok" id="cp-nl">Copiar código</button></div>
      <p class="meta">Sirve una sola vez y vence el ${fecha(data.vence_en)}. Si se te escapa en un chat, anúlalo aquí abajo.</p>
      <p>Ahora dile a tu IA:</p><pre>Conéctate a mi buzón: ${esc(URL_MCP)}</pre><button class="copiar" id="cp-frase">Copiar frase</button>`;
    $('#cp-nl').onclick = () => copiar(data.codigo, $('#cp-nl'));
    $('#cp-frase').onclick = (ev) => copiar(`Conéctate a mi buzón: ${URL_MCP}`, ev.target);
    $('#dlg').showModal(); $('#nl-nombre').value = ''; pintarCodigos();
  };
  $('#f-ag').onsubmit = async (e) => {
    e.preventDefault();
    const { data: ag, error } = await sb.from('agentes').insert({ buzon_id: buzon.id, nombre: $('#ag-nombre').value }).select('id,nombre').single();
    if (error) return alert(error.message);
    const token = nuevoToken();
    const vence = new Date(Date.now() + +$('#ag-dias').value * 864e5).toISOString();
    const r = await sb.from('tokens').insert({ agente_id: ag.id, hash_token: await sha256hex(token), vence_en: vence });
    if (r.error) return alert(r.error.message);
    $('#dlg-cuerpo').innerHTML = `<h3>Clave de ${esc(ag.nombre)}</h3><p>Cópialo ahora: <b>no se vuelve a mostrar</b>. Es como una contraseña: no lo compartas ni lo pongas en capturas.</p><code id="tok">${esc(token)}</code>
      <div class="fila"><button class="ok" id="cp-tok">Copiar clave</button><button id="usar-tok">Ver dónde pegarlo</button></div>`;
    $('#cp-tok').onclick = () => copiar(token, $('#cp-tok'));
    $('#usar-tok').onclick = () => { tokenGuia = token; $('#dlg').close(); irA('conectar'); };
    $('#dlg').showModal(); pintar();
  };
}

async function pintarCodigos() {
  const caja = $('#nl-lista'); if (!caja) return;
  const { data } = await sb.from('codigos_config').select('id,nombre_agente,vence_en,usado_en,intentos_fallidos').eq('buzon_id', buzon.id).order('creado_en', { ascending: false }).limit(5);
  caja.innerHTML = (data ?? []).map((c) => `<div class="meta">${esc(c.nombre_agente)} · ${c.usado_en ? '✅ usado ' + hace(c.usado_en) : new Date(c.vence_en) < new Date() ? '⌛ vencido' : '🟡 activo hasta ' + fecha(c.vence_en)}${c.intentos_fallidos ? ` · ${c.intentos_fallidos} intento(s) fallido(s)` : ''}
    ${!c.usado_en && new Date(c.vence_en) > new Date() ? `<button class="no" data-anular="${c.id}">Anular</button>` : ''}</div>`).join('');
  caja.querySelectorAll('[data-anular]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.rpc('anular_codigo_config', { p_id: b.dataset.anular }); if (error) return alert(error.message); pintarCodigos();
  });
}

// Push: el permiso se pide SOLO al tocar el botón. La suscripción se guarda por buzón con RLS.
const b64aU8 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pintarPush() {
  const caja = $('#push-caja'); if (!caja) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
    caja.innerHTML = `<p class="meta">${VAPID ? 'Este navegador no admite avisos. En iPhone: primero agrega la app a tu pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde ahí.' : 'Los avisos todavía no están activados en este servidor.'}</p>`; return;
  }
  const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
  if (Notification.permission === 'denied') { caja.innerHTML = '<p class="aviso">Bloqueaste los avisos. Para activarlos, cambia el permiso de notificaciones de este sitio en los ajustes del navegador.</p>'; return; }
  caja.innerHTML = sub ? '<p>🟢 Activados en este teléfono.</p><button id="push-off" class="no">Desactivar</button>' : '<button id="push-on" class="ok">Activar avisos</button>';
  $('#push-on') && ($('#push-on').onclick = async () => {
    if (await Notification.requestPermission() !== 'granted') return pintarPush();
    try {
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aU8(VAPID) });
      const { error } = await sb.from('push_suscripciones').insert({ buzon_id: buzon.id, humano_id: usuario.id, endpoint: s.endpoint, p256dh: b64u(s.getKey('p256dh')), auth: b64u(s.getKey('auth')) });
      if (error) { await s.unsubscribe(); throw error; }
    } catch (e) { alert('No se pudieron activar: ' + e.message); }
    pintarPush();
  });
  $('#push-off') && ($('#push-off').onclick = async () => {
    await sb.from('push_suscripciones').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); pintarPush();
  });
}

async function copiar(texto, boton) {
  try { await navigator.clipboard.writeText(texto); } catch {
    const t = document.createElement('textarea'); t.value = texto; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  const o = boton.textContent; boton.textContent = '✔ Copiado'; setTimeout(() => (boton.textContent = o), 1500);
}

function pintarGuias(v, conSesion) {
  const caja = document.createElement('div');
  caja.innerHTML = `<div class="tarjeta"><b>Conecta tus IAs en 5 pasos</b>
    <p class="meta">Cada IA necesita dos cosas: la <b>dirección del buzón</b> (el lugar donde se conecta) y <b>tu clave</b> (una contraseña que empieza con bz_, una por IA).</p>
    <ol class="pasos">
      <li><b>Pega tu clave aquí.</b> ${conSesion ? 'Se saca en la pestaña <a href="#" id="ir-ag">Agentes</a> (botón «Crear y generar clave»).' : 'Primero entra con tu correo; la clave se saca en la pestaña Agentes. Mientras, verás TU_CLAVE donde va.'}
        ${conSesion ? '<input id="tok-guia" type="password" placeholder="bz_… (pega tu clave aquí)" autocomplete="off" aria-describedby="tok-nota"><p id="tok-ok" class="ok-msg" role="status" hidden>✓ Listo, tu clave ya quedó puesta en las guías de abajo</p><p id="tok-nota" class="meta">No se guarda; si recargas, pégala otra vez.</p>' : ''}</li>
      <li><b>Elige tu IA</b> en la lista de abajo y ábrela.</li>
      <li><b>Toca «Copiar»</b> en el recuadro gris.</li>
      <li><b>Pégalo donde dice la guía</b> de esa IA.</li>
      <li><b>Toca «Probar conexión»</b> en la pestaña Agentes para confirmar que quedó.</li>
    </ol>
    <p>Dirección del buzón:</p><pre id="url-mcp">${esc(URL_MCP)}</pre><button class="copiar" id="cp-url">Copiar dirección</button></div>
    <div class="tarjeta" id="leyenda"><b>¿Qué tan fácil es cada IA?</b>
    ${Object.keys(ETIQUETA).map((k) => `<p><b>${esc(ETIQUETA[k])}</b><br><span class="meta">${esc(QUE_HACER[k])}</span></p>`).join('')}
    <p class="meta">Palabras que verás: <b>terminal</b> = la ventana negra para escribir comandos; <b>versión de terminal</b> = la IA usada desde esa ventana; <b>archivo de configuración</b> = un archivo de texto donde la IA guarda sus ajustes.</p></div>
    <div id="lista-guias"></div>`;
  v.append(caja);
  caja.querySelector('#cp-url').onclick = (e) => copiar(URL_MCP, e.target);
  const irAg = caja.querySelector('#ir-ag'); if (irAg) irAg.onclick = (e) => { e.preventDefault(); irA('agentes'); };
  const inp = caja.querySelector('#tok-guia');
  const valida = () => /^bz_[A-Za-z0-9_-]{20,}$/.test(tokenGuia);
  if (inp) {
    inp.value = tokenGuia;
    const ok = caja.querySelector('#tok-ok'); ok.hidden = !valida();
    inp.oninput = () => {
      const antes = valida(); tokenGuia = inp.value.trim(); lista(); ok.hidden = !valida();
      if (valida() && !antes) caja.querySelector('#lista-guias').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
  const lista = () => {
    const tok = valida() ? tokenGuia : 'TU_CLAVE';
    const r = (t) => t.replaceAll('{URL}', URL_MCP).replaceAll('{CANJE}', URL_MCP.replace(/\/api\/mcp$/, '/api/canje')).replaceAll('{TOKEN}', tok);
    const abiertas = new Set([...caja.querySelectorAll('details[open]')].map((d) => d.dataset.id));
    const cont = caja.querySelector('#lista-guias'); cont.innerHTML = '<h3>Elige tu IA</h3>';
    for (const g of GUIAS) {
      const d = document.createElement('details'); d.className = 'guia'; d.dataset.id = g.id; if (abiertas.has(g.id)) d.open = true;
      d.innerHTML = `<summary>${esc(g.nombre)}<span class="etq">${ETIQUETA[g.estado]}</span></summary>
        <p class="meta">${esc(QUE_HACER[g.estado])}</p>
        <p><b>Dónde:</b> ${esc(r(g.donde))}</p><ol>${g.pasos.map((p) => `<li>${esc(r(p))}</li>`).join('')}</ol>
        ${g.codigo ? `<pre>${esc(r(g.codigo))}</pre><button class="copiar" data-c="1">Copiar</button>` : ''}
        ${g.nota ? `<p class="aviso">${esc(r(g.nota))}</p>` : ''}
        <p><b>¿Quedó?</b> ${esc(g.probar)}${g.estado !== 'no' ? ' O toca «Probar conexión» en Agentes.' : ''}</p>`;
      const b = d.querySelector('[data-c]'); if (b) b.onclick = () => copiar(r(g.codigo), b);
      cont.append(d);
    }
  };
  lista();
}

function hace(f) {
  const s = Math.round((Date.now() - new Date(f)) / 1000);
  if (s < 60) return 'hace unos segundos'; if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`; return fecha(f);
}
function conexion(u) {
  if (!u) return '⚪ Sin conectar';
  return Date.now() - new Date(u) < 15 * 60e3 ? '🟢 Conectada' : '🟡 Conectada antes · ' + hace(u);
}

// Probar conexión: la PWA nunca habla con la IA ni ve tokens; solo observa (con RLS) cuándo usó el MCP.
let sondeo;
async function probarConexion(ag, antes) {
  clearInterval(sondeo);
  const c = $('#dlg-cuerpo'), inicio = Date.now(), base = antes ? new Date(antes).getTime() : 0;
  c.innerHTML = `<h3>Probar conexión: ${esc(ag.nombre)}</h3>
    <p>1) Abre ${esc(ag.nombre)} y escríbele:</p><pre>Usa la herramienta "leer" de mi buzón y dime cuántos hilos hay.</pre>
    <button class="copiar" id="cp-ping">Copiar mensaje</button>
    <p>2) Deja esta pantalla abierta. En cuanto tu IA lea el buzón, aquí verás ✅.</p><p id="ping-estado" class="aviso">⏳ Esperando a ${esc(ag.nombre)}…</p>`;
  $('#cp-ping').onclick = (e) => copiar('Usa la herramienta "leer" de mi buzón y dime cuántos hilos hay.', e.target);
  $('#dlg').showModal();
  const revisar = async () => {
    if (!$('#dlg').open) return clearInterval(sondeo);
    const { data } = await sb.from('estado_agentes').select('ultimo_uso').eq('agente_id', ag.id).maybeSingle();
    const u = data?.ultimo_uso ? new Date(data.ultimo_uso).getTime() : 0;
    const p = $('#ping-estado'); if (!p) return clearInterval(sondeo);
    if (u > base) { clearInterval(sondeo); p.className = 'vacio'; p.innerHTML = `<b>✅ ¡${esc(ag.nombre)} está conectada!</b>Usó tu buzón ${hace(data.ultimo_uso)}.`; pintar(); }
    else if (Date.now() - inicio > 180e3) { clearInterval(sondeo); p.innerHTML = '⚠️ No vimos ninguna llamada en 3 minutos. Revisa en <b>Conectar</b> que pegaste la dirección y el token correctos, y que el token no esté revocado o vencido.'; }
  };
  sondeo = setInterval(revisar, 4000); revisar();
}
