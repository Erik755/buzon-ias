import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, MCP_URL } from './config.js';
import { GUIAS, ETIQUETA } from './guias.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (f) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
let usuario, buzon, vista = 'pendientes', tokenGuia = '';
const URL_MCP = MCP_URL || 'https://buzon-ias-mcp.vercel.app/api/mcp';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

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
    try { await asegurarBuzon(); pintar(); }
    catch (e) { $('#vista').innerHTML = `<div class="vacio"><b>No pudimos abrir tu buzón</b>${esc(e.message)}<br><br>Toca <b>Salir</b> y vuelve a entrar con el enlace de tu correo.</div>`; }
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
  let q = sb.from('hilos').select('*, agentes!hilos_creado_por_agente_fkey(nombre)').eq('buzon_id', buzon.id).order('creado_en', { ascending: false }).limit(50);
  if (vista === 'pendientes') q = q.eq('estado', 'pide_aprobacion');
  const { data, error } = await q;
  if (error) return v.textContent = error.message;
  if (!data.length) {
    const { count } = await sb.from('agentes').select('id', { count: 'exact', head: true }).eq('buzon_id', buzon.id);
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
      <div class="meta">${esc(h.tipo)} · ${esc(h.agentes?.nombre ?? '—')} · ${fecha(h.creado_en)}</div>`;
    d.onclick = () => abrirHilo(h.id); v.append(d);
  }
}

async function abrirHilo(id) {
  const [{ data: h }, { data: ms }, { data: ap }] = await Promise.all([
    sb.from('hilos').select('*').eq('id', id).single(),
    sb.from('mensajes').select('*, agentes(nombre)').eq('hilo_id', id).order('creado_en'),
    sb.from('aprobaciones').select('*').eq('hilo_id', id).order('creado_en'),
  ]);
  const c = $('#dlg-cuerpo');
  c.innerHTML = `<h3>${esc(h.titulo)}</h3><p class="meta">${esc(h.estado)}</p><div class="msg">${esc(h.contexto)}</div>
    ${ms.map((m) => `<div class="msg"><span class="meta">${esc(m.agentes?.nombre ?? 'Tú')} · ${fecha(m.creado_en)}</span><br>${esc(m.cuerpo)}</div>`).join('')}
    ${ap.map((a) => `<p>✅ ${esc(a.decision)} · ${esc(a.nota)} <span class="meta">${fecha(a.creado_en)}</span></p>`).join('')}
    <textarea id="nota" placeholder="Nota (opcional)"></textarea>
    ${h.estado === 'pide_aprobacion' ? '<div class="fila"><button class="ok" id="aprobar">Aprobar</button><button class="no" id="rechazar">Rechazar</button></div>' : ''}
    <button id="comentar">Comentar</button>`;
  const decidir = async (decision) => {
    const { error } = await sb.from('aprobaciones').insert({ hilo_id: id, humano_id: usuario.id, decision, nota: $('#nota').value || null });
    if (error) return alert(error.message);
    $('#dlg').close(); pintar();
  };
  $('#aprobar') && ($('#aprobar').onclick = () => decidir('aprobado'));
  $('#rechazar') && ($('#rechazar').onclick = () => decidir('rechazado'));
  $('#comentar').onclick = async () => {
    const cuerpo = $('#nota').value.trim(); if (!cuerpo) return;
    const { error } = await sb.from('mensajes').insert({ hilo_id: id, autor_humano: usuario.id, cuerpo });
    if (error) return alert(error.message); abrirHilo(id);
  };
  $('#dlg').showModal();
}

async function sha256hex(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function nuevoToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return 'bz_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pintarAgentes(v) {
  const [{ data: ags }, { data: est }] = await Promise.all([
    sb.from('agentes').select('*, tokens(id,alcances,vence_en,revocado_en,ultimo_uso)').eq('buzon_id', buzon.id).order('creado_en'),
    sb.from('estado_agentes').select('agente_id,ultimo_uso,ultima_accion,accion').eq('buzon_id', buzon.id),
  ]);
  const estado = Object.fromEntries((est ?? []).map((e) => [e.agente_id, e]));
  v.innerHTML = (ags.length ? '' : `<div class="vacio"><b>Crea un agente por cada IA</b>Un "agente" es la llave de una IA para entrar a tu buzón. Ponle el nombre de la IA (ej. "Claude"). Te daremos un token para pegar en esa IA; si un día no quieres que entre, lo revocas aquí.</div>`)
    + `<form id="f-ag" class="tarjeta"><b>Nuevo agente</b><input id="ag-nombre" required placeholder="Claude, ChatGPT, Grok…">
    <select id="ag-dias"><option value="7">7 días</option><option value="30" selected>30 días</option><option value="90">90 días</option></select>
    <button class="ok">Crear y generar token</button></form>`;
  for (const a of ags) {
    const d = document.createElement('div'); d.className = 'tarjeta';
    const e = estado[a.id];
    d.innerHTML = `<b>${esc(a.nombre)}</b> <span class="estado">${conexion(e?.ultimo_uso)}</span>
      <div class="meta">${e?.ultima_accion ? 'Última acción: ' + esc(e.accion) + ' · ' + hace(e.ultima_accion) : 'Todavía no ha usado el buzón'}</div>
      <button class="copiar" data-probar="${a.id}">Probar conexión</button>` + a.tokens.map((t) => `<div class="meta">${t.revocado_en ? '⛔ revocado' : new Date(t.vence_en) < new Date() ? '⌛ vencido' : '🟢 activo'}
      · vence ${fecha(t.vence_en)} · último uso ${t.ultimo_uso ? fecha(t.ultimo_uso) : 'nunca'}
      ${!t.revocado_en ? `<button data-rev="${t.id}" class="no">Revocar</button>` : ''}</div>`).join('');
    v.append(d);
  }
  v.querySelectorAll('[data-probar]').forEach((b) => b.onclick = () => probarConexion(ags.find((a) => a.id === b.dataset.probar), estado[b.dataset.probar]?.ultimo_uso));
  v.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
    if (!confirm('¿Revocar este token? Tiene efecto inmediato.')) return;
    const { data, error } = await sb.from('tokens').update({ revocado_en: new Date().toISOString() }).eq('id', b.dataset.rev).select('id');
    if (error || !data?.length) return alert('No se pudo revocar el token: ' + (error?.message ?? 'sin permiso o no existe') + '. Intenta de nuevo.');
    pintar();
  });
  $('#f-ag').onsubmit = async (e) => {
    e.preventDefault();
    const { data: ag, error } = await sb.from('agentes').insert({ buzon_id: buzon.id, nombre: $('#ag-nombre').value }).select().single();
    if (error) return alert(error.message);
    const token = nuevoToken();
    const vence = new Date(Date.now() + +$('#ag-dias').value * 864e5).toISOString();
    const r = await sb.from('tokens').insert({ agente_id: ag.id, hash_token: await sha256hex(token), vence_en: vence });
    if (r.error) return alert(r.error.message);
    $('#dlg-cuerpo').innerHTML = `<h3>Token de ${esc(ag.nombre)}</h3><p>Cópialo ahora: <b>no se vuelve a mostrar</b>. Es como una contraseña: no lo compartas ni lo pongas en capturas.</p><code id="tok">${esc(token)}</code>
      <div class="fila"><button class="ok" id="cp-tok">Copiar token</button><button id="usar-tok">Ver dónde pegarlo</button></div>`;
    $('#cp-tok').onclick = () => copiar(token, $('#cp-tok'));
    $('#usar-tok').onclick = () => { tokenGuia = token; $('#dlg').close(); irA('conectar'); };
    $('#dlg').showModal(); pintar();
  };
}

async function copiar(texto, boton) {
  try { await navigator.clipboard.writeText(texto); } catch {
    const t = document.createElement('textarea'); t.value = texto; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  const o = boton.textContent; boton.textContent = '✔ Copiado'; setTimeout(() => (boton.textContent = o), 1500);
}

function pintarGuias(v, conSesion) {
  const caja = document.createElement('div');
  caja.innerHTML = `<div class="tarjeta"><b>Conecta tus IAs</b>
    <p class="meta">Cada IA necesita 2 cosas: la <b>dirección del buzón</b> y su <b>token</b>.</p>
    <p>1) Dirección del buzón (MCP):</p><pre id="url-mcp">${esc(URL_MCP)}</pre><button class="copiar" id="cp-url">Copiar dirección</button>
    <p>2) Token: ${conSesion ? 'créalo en <b>Agentes</b> (uno por IA) y pégalo aquí para que las instrucciones salgan listas para copiar. No se guarda en ningún lado.' : 'entra y créalo en <b>Agentes</b>. Aquí abajo verás TU_TOKEN donde va.'}</p>
    ${conSesion ? '<input id="tok-guia" type="password" placeholder="bz_… (pega el token aquí)" autocomplete="off">' : ''}
    <p class="meta">✅ funciona directo · 🔌 necesita un pequeño puente en tu compu · ⚠️ depende de tu cuenta · ⛔ no compatible</p></div>
    <div id="lista-guias"></div>`;
  v.append(caja);
  caja.querySelector('#cp-url').onclick = (e) => copiar(URL_MCP, e.target);
  const inp = caja.querySelector('#tok-guia');
  if (inp) { inp.value = tokenGuia; inp.oninput = () => { tokenGuia = inp.value.trim(); lista(); }; }
  const lista = () => {
    const tok = /^bz_[A-Za-z0-9_-]{20,}$/.test(tokenGuia) ? tokenGuia : 'TU_TOKEN';
    const r = (t) => t.replaceAll('{URL}', URL_MCP).replaceAll('{TOKEN}', tok);
    const abiertas = new Set([...caja.querySelectorAll('details[open]')].map((d) => d.dataset.id));
    const cont = caja.querySelector('#lista-guias'); cont.innerHTML = '';
    for (const g of GUIAS) {
      const d = document.createElement('details'); d.className = 'guia'; d.dataset.id = g.id; if (abiertas.has(g.id)) d.open = true;
      d.innerHTML = `<summary>${esc(g.nombre)}<span class="etq">${ETIQUETA[g.estado]}</span></summary>
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
