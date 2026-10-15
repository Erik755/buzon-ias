import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (f) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
let usuario, buzon, vista = 'pendientes';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

$('#f-login').onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithOtp({ email: $('#email').value, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
  $('#login-msg').textContent = error ? 'Error: ' + error.message : 'Revisa tu correo 📩';
};
$('#salir').onclick = () => sb.auth.signOut();
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('activa', x === b)); vista = b.dataset.vista; pintar();
});

sb.auth.onAuthStateChange(async (_ev, ses) => {
  usuario = ses?.user ?? null;
  $('#login').hidden = !!usuario; $('#app').hidden = !usuario; $('#salir').hidden = !usuario;
  if (usuario) { await asegurarBuzon(); pintar(); }
});

async function asegurarBuzon() {
  let { data } = await sb.from('buzones').select('*').limit(1);
  if (!data?.length) ({ data } = await sb.from('buzones').insert({ dueno_id: usuario.id, nombre: 'Mi buzón' }).select());
  buzon = data[0];
}

async function pintar() {
  const v = $('#vista'); v.innerHTML = '<p class="meta">Cargando…</p>';
  if (vista === 'agentes') return pintarAgentes(v);
  let q = sb.from('hilos').select('*, agentes!hilos_creado_por_agente_fkey(nombre)').eq('buzon_id', buzon.id).order('creado_en', { ascending: false }).limit(50);
  if (vista === 'pendientes') q = q.eq('estado', 'pide_aprobacion');
  const { data, error } = await q;
  if (error) return v.textContent = error.message;
  v.innerHTML = data.length ? '' : '<p class="meta">Nada pendiente 🎉</p>';
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
  const { data: ags } = await sb.from('agentes').select('*, tokens(id,alcances,vence_en,revocado_en,ultimo_uso)').eq('buzon_id', buzon.id).order('creado_en');
  v.innerHTML = `<form id="f-ag" class="tarjeta"><b>Nuevo agente</b><input id="ag-nombre" required placeholder="Claude, ChatGPT, Grok…">
    <select id="ag-dias"><option value="7">7 días</option><option value="30" selected>30 días</option><option value="90">90 días</option></select>
    <button class="ok">Crear y generar token</button></form>`;
  for (const a of ags) {
    const d = document.createElement('div'); d.className = 'tarjeta';
    d.innerHTML = `<b>${esc(a.nombre)}</b>` + a.tokens.map((t) => `<div class="meta">${t.revocado_en ? '⛔ revocado' : new Date(t.vence_en) < new Date() ? '⌛ vencido' : '🟢 activo'}
      · vence ${fecha(t.vence_en)} · último uso ${t.ultimo_uso ? fecha(t.ultimo_uso) : 'nunca'}
      ${!t.revocado_en ? `<button data-rev="${t.id}" class="no">Revocar</button>` : ''}</div>`).join('');
    v.append(d);
  }
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
    $('#dlg-cuerpo').innerHTML = `<h3>Token de ${esc(ag.nombre)}</h3><p>Cópialo ahora: <b>no se vuelve a mostrar</b>.</p><code>${esc(token)}</code>`;
    $('#dlg').showModal(); pintar();
  };
}
