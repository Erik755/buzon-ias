import { createClient } from './vendor/supabase.js';
import * as CFG from './config.js';
import { GUIAS, ETIQUETA, QUE_HACER } from './guias.js';
import { GUIAS_EN, ETIQUETA_EN, QUE_HACER_EN } from './guias-i18n.js';
import { mensajeAmable, conBotones, avisar, mostrarAviso } from './errores.js';
import { etiquetaAviso } from './avisos.js';
import { fusionarMensajes, idsMensajes, firmaLista, debeEncuestar, debeEncuestarLista, enviarMensajeChat, INTERVALO_SONDEO_MS } from './chat.js';
import { t, setIdioma, getIdioma, onIdioma, iniciarIdioma } from './i18n.js';
import { buscarGuias, rellenarPlantilla, enmascararToken, ALIAS } from './conectar.js';
import { filtrarHilos, inicialDe, hiloCerrado } from './layout.js';
import { listaDestinatarios, idAgentePorNombre, nombresDeHilos } from './destinatarios.js';
import { aplicarTema, leerTema, alternarTema as cambiarTema, sincronizarControlTema } from './temas.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, MCP_URL } = CFG;
const VAPID = CFG.VAPID_PUBLIC_KEY || '';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (f) => new Date(f).toLocaleString(getIdioma() === 'en' ? 'en-US' : 'es-MX', { dateStyle: 'short', timeStyle: 'short' });
let usuario, buzon, buzones = [], vista = 'chat', filtro = 'todos', tokenGuia = '', buscaHilos = '';
let hiloAbierto = null, listaHilosCache = [], listaAgentesCache = [], listaRemitentesExtra = [];
const URL_MCP = MCP_URL || 'https://buzon-ias-mcp.vercel.app/api/mcp';
const URL_CANJE = URL_MCP.replace(/\/api\/mcp$/, '/api/canje');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
const avisoRed = () => { const n = $('#sin-red'); if (n) n.hidden = navigator.onLine; };
addEventListener('online', () => { avisoRed(); if (usuario) asegurarBuzon().then(pintar).catch(() => {}); });
addEventListener('offline', avisoRed); avisoRed();
$('#aviso-cerrar') && ($('#aviso-cerrar').onclick = () => mostrarAviso(''));

iniciarIdioma();
iniciarTema();
$$('[data-idioma]').forEach((b) => { b.onclick = () => setIdioma(b.dataset.idioma); });
onIdioma(() => { sincronizarControlTema($('#btn-tema'), t); refrescarListaDestino(); if (usuario) pintar(); else { aplicarCabecera(); if (!$('#guias-publicas').hidden && $('#guias-publicas').childElementCount) pintarConectar($('#guias-publicas'), false); } });
$('#btn-tema') && ($('#btn-tema').onclick = alternarTema);

function iniciarTema() {
  const almacen = typeof localStorage !== 'undefined' ? localStorage : null;
  aplicarTema(leerTema(almacen), almacen);
  sincronizarControlTema($('#btn-tema'), t);
}
function alternarTema() {
  cambiarTema(typeof localStorage !== 'undefined' ? localStorage : null);
  sincronizarControlTema($('#btn-tema'), t);
}

function aplicarCabecera() { /* data-i18n lo aplica setIdioma / iniciarIdioma */ }

function remitentesVistos() {
  return nombresDeHilos(listaHilosCache).concat(listaRemitentesExtra);
}

async function cargarAgentesDestino() {
  if (!buzon) { listaAgentesCache = []; listaRemitentesExtra = []; return; }
  const { data: ags } = await sb.from('agentes').select('id,nombre').eq('buzon_id', buzon.id).is('eliminado_en', null).order('nombre');
  listaAgentesCache = ags || [];
  const ids = (listaHilosCache || []).map((h) => h.id).filter(Boolean);
  if (!ids.length) { listaRemitentesExtra = []; return; }
  const { data: msgs, error } = await sb.from('mensajes').select('autor:agentes!mensajes_autor_agente_fkey(nombre)').in('hilo_id', ids).not('autor_agente', 'is', null).limit(200);
  listaRemitentesExtra = error ? [] : (msgs || []).map((m) => m.autor?.nombre).filter(Boolean);
}

function opcionesDestino() {
  const q = $('#nuevo-para')?.value || '';
  return listaDestinatarios({ agentes: listaAgentesCache, remitentes: remitentesVistos(), consulta: q, incluirLibre: true });
}

function actualizarHintDestino() {
  const hint = $('#nuevo-para-hint');
  const input = $('#nuevo-para');
  if (!hint || !input) return;
  const nombre = input.value.trim();
  if (!nombre) { hint.hidden = true; hint.textContent = ''; return; }
  const conectado = !!idAgentePorNombre(listaAgentesCache, nombre);
  hint.textContent = conectado ? '' : t('hilo.paraSinConectar');
  hint.hidden = conectado;
}

function ocultarListaDestino() {
  const lista = $('#nuevo-para-lista');
  const input = $('#nuevo-para');
  if (lista) lista.hidden = true;
  if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
}

function refrescarListaDestino() {
  const input = $('#nuevo-para');
  const lista = $('#nuevo-para-lista');
  if (!input || !lista) return;
  const vis = opcionesDestino();
  const actual = input.getAttribute('aria-activedescendant') || '';
  const activo = vis.findIndex((_, i) => 'para-opt-' + i === actual);
  lista.replaceChildren();
  vis.forEach((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.id = 'para-opt-' + i;
    b.setAttribute('aria-selected', i === activo ? 'true' : 'false');
    const nom = document.createElement('span');
    nom.textContent = o.fuente === 'libre' ? t('hilo.paraLibre', { nombre: o.nombre }) : o.nombre;
    b.append(nom);
    if (o.conectado) {
      const eti = document.createElement('span');
      eti.className = 'eti';
      eti.textContent = t('hilo.conectado');
      b.append(eti);
    }
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => elegirDestino(o);
    lista.append(b);
  });
  // Con el formulario abierto la lista se ve siempre (conectados primero, luego la base).
  lista.hidden = !!$('#form-nuevo')?.hidden || vis.length === 0;
  input.setAttribute('aria-expanded', lista.hidden ? 'false' : 'true');
  if (!lista.hidden && vis[activo]) input.setAttribute('aria-activedescendant', 'para-opt-' + activo);
  else input.removeAttribute('aria-activedescendant');
  actualizarHintDestino();
}

function elegirDestino(o) {
  const input = $('#nuevo-para');
  if (input) input.value = o.nombre;
  ocultarListaDestino();
  actualizarHintDestino();
}

function armarSelectorDestino() {
  const input = $('#nuevo-para');
  const lista = $('#nuevo-para-lista');
  if (!input || !lista || input.dataset.listo) return;
  input.dataset.listo = '1';
  const mover = (delta) => {
    const vis = opcionesDestino();
    if (!vis.length) return;
    const actual = input.getAttribute('aria-activedescendant') || '';
    let i = vis.findIndex((_, n) => 'para-opt-' + n === actual);
    i = i < 0 ? (delta > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, i + delta));
    input.setAttribute('aria-activedescendant', 'para-opt-' + i);
    refrescarListaDestino();
    const el = $('#para-opt-' + i);
    if (el) el.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('focus', () => { refrescarListaDestino(); });
  input.addEventListener('input', () => { input.removeAttribute('aria-activedescendant'); refrescarListaDestino(); });
  input.addEventListener('keydown', (e) => {
    const vis = opcionesDestino();
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (e.key === 'Home') { e.preventDefault(); input.setAttribute('aria-activedescendant', 'para-opt-0'); refrescarListaDestino(); }
    else if (e.key === 'End') { e.preventDefault(); input.setAttribute('aria-activedescendant', 'para-opt-' + (vis.length - 1)); refrescarListaDestino(); }
    else if (e.key === 'Enter') {
      const actual = input.getAttribute('aria-activedescendant') || '';
      const i = vis.findIndex((_, n) => 'para-opt-' + n === actual);
      if (i >= 0 && vis[i]) { e.preventDefault(); elegirDestino(vis[i]); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!lista.hidden) ocultarListaDestino();
      else { input.value = ''; actualizarHintDestino(); }
    }
  });
  input.addEventListener('blur', () => { /* la lista se queda visible mientras el formulario esté abierto */ });
}

function cerrarCajones() {
  document.body.classList.remove('izq-abierto', 'der-abierto');
  const f = $('#fondo-panel'); if (f) f.hidden = true;
  const m = $('#btn-menu'), a = $('#btn-agentes-hilo');
  if (m) m.setAttribute('aria-expanded', 'false');
  if (a) a.setAttribute('aria-expanded', 'false');
}
function abrirCajon(cual) {
  const abierto = document.body.classList.contains(cual === 'izq' ? 'izq-abierto' : 'der-abierto');
  cerrarCajones();
  if (abierto) return;
  document.body.classList.add(cual === 'izq' ? 'izq-abierto' : 'der-abierto');
  const f = $('#fondo-panel'); if (f) f.hidden = false;
  const b = cual === 'izq' ? $('#btn-menu') : $('#btn-agentes-hilo');
  if (b) b.setAttribute('aria-expanded', 'true');
}
$('#btn-menu') && ($('#btn-menu').onclick = () => abrirCajon('izq'));
$('#btn-agentes-hilo') && ($('#btn-agentes-hilo').onclick = () => abrirCajon('der'));
$('#fondo-panel') && ($('#fondo-panel').onclick = cerrarCajones);

$('#f-login').onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithOtp({ email: $('#email').value, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
  const msg = $('#login-msg');
  if (!error) { msg.textContent = t('login.enviado'); return; }
  msg.textContent = /signups? not allowed|not found/i.test(error.message)
    ? (getIdioma() === 'en' ? 'That email does not have an account yet. Ask the administrator to invite you.' : 'Ese correo no tiene cuenta todavía. Pídele al administrador que te invite.')
    : mensajeAmable(error);
};
$('#salir').onclick = () => sb.auth.signOut();
$('#ver-guias').onclick = () => {
  const g = $('#guias-publicas');
  if (g.childElementCount) g.replaceChildren();
  else pintarConectar(g, false);
};

function irA(v) {
  vista = v;
  $$('[data-vista]').forEach((x) => x.classList.toggle('activa', x.dataset.vista === v));
  if (v === 'chat') cerrarCajones();
  pintar();
}
$$('[data-vista]').forEach((b) => { b.onclick = () => irA(b.dataset.vista); });
$$('[data-filtro]').forEach((b) => {
  b.onclick = () => {
    filtro = b.dataset.filtro;
    $$('[data-filtro]').forEach((x) => x.classList.toggle('activa', x === b));
    vista = 'chat';
    dibujarListaHilos();
  };
});
$('#busca-hilos') && ($('#busca-hilos').oninput = (e) => { buscaHilos = e.target.value; dibujarListaHilos(); });
$('#btn-nuevo') && ($('#btn-nuevo').onclick = async () => {
  const f = $('#form-nuevo'); f.hidden = !f.hidden;
  if (!f.hidden) {
    await cargarAgentesDestino();
    refrescarListaDestino();
    $('#nuevo-titulo').focus();
  } else {
    ocultarListaDestino();
  }
});
$('#nuevo-cancelar') && ($('#nuevo-cancelar').onclick = () => {
  $('#form-nuevo').hidden = true;
  const p = $('#nuevo-para'); if (p) p.value = '';
  ocultarListaDestino();
  const h = $('#nuevo-para-hint'); if (h) h.hidden = true;
});
$('#form-nuevo') && ($('#form-nuevo').onsubmit = async (e) => {
  e.preventDefault();
  const titulo = $('#nuevo-titulo').value.trim() || t('hilo.sinTitulo');
  const paraNombre = ($('#nuevo-para')?.value || '').trim();
  const fila = { buzon_id: buzon.id, tipo: 'avance', titulo };
  if (paraNombre) {
    const dest = idAgentePorNombre(listaAgentesCache, paraNombre);
    if (dest) fila.para_agente = dest;
  }
  const { data, error } = await sb.from('hilos').insert(fila).select('id').single();
  if (error) return avisar(t('err.noCrearHilo'), error);
  $('#nuevo-titulo').value = '';
  if ($('#nuevo-para')) $('#nuevo-para').value = '';
  const hint = $('#nuevo-para-hint'); if (hint) hint.hidden = true;
  $('#form-nuevo').hidden = true;
  ocultarListaDestino();
  hiloAbierto = data.id;
  vista = 'chat';
  await pintar();
  if (window.matchMedia('(max-width:860px)').matches) cerrarCajones();
});
armarSelectorDestino();

sb.auth.onAuthStateChange(async (ev, ses) => {
  usuario = ses?.user ?? null;
  $('#login').hidden = !!usuario; $('#app').hidden = !usuario; $('#salir').hidden = !usuario;
  if (!usuario) { detenerEnVivo(); cerrarCajones(); return; }
  // TOKEN_REFRESHED no debe volver a pintar: eso destrozaba el chat, apagaba el sondeo y podía dejar el texto en la caja.
  if (ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') return;
  try {
    await asegurarBuzon();
    const h = new URLSearchParams(location.search).get('hilo');
    if (/^[0-9a-f-]{36}$/i.test(h || '')) { hiloAbierto = h; history.replaceState(null, '', location.pathname); }
    pintar();
  } catch (e) {
    const caja = $('#panel-centro') || $('#vista-pagina');
    if (caja) {
      caja.replaceChildren();
      const d = document.createElement('div'); d.className = 'vacio';
      const b = document.createElement('b');
      b.textContent = !navigator.onLine || /fetch|network/i.test(e.message || '')
        ? (getIdioma() === 'en' ? '📡 Offline' : '📡 Sin conexión')
        : (getIdioma() === 'en' ? 'We could not open your inbox' : 'No pudimos abrir tu buzón');
      const p = document.createElement('p'); p.textContent = mensajeAmable(e);
      d.append(b, p); caja.append(d);
    }
  }
});

async function asegurarBuzon() {
  let { data, error } = await sb.from('buzones').select('*').order('creado_en');
  if (!error && !data?.length) ({ data, error } = await sb.from('buzones').insert({ dueno_id: usuario.id, nombre: 'Mi buzón' }).select());
  if (error || !data?.length) throw new Error(error?.message || 'No se pudo abrir tu buzón');
  buzones = data;
  const guardado = localStorage.getItem('buzon_actual');
  buzon = buzones.find((b) => b.id === guardado) || buzones[0];
  pintarSelectorBuzon();
}

function pintarSelectorBuzon() {
  const barra = $('#barra-buzon'); if (!barra) return;
  barra.hidden = !usuario;
  const sel = $('#sel-buzon'); if (!sel) return;
  sel.innerHTML = buzones.map((b) => `<option value="${b.id}"${b.id === buzon.id ? ' selected' : ''}>${esc(b.nombre)}</option>`).join('');
}
$('#sel-buzon') && ($('#sel-buzon').onchange = (e) => {
  const b = buzones.find((x) => x.id === e.target.value);
  if (b) { buzon = b; localStorage.setItem('buzon_actual', b.id); hiloAbierto = null; pintar(); }
});

function consultaHilos() {
  let q = sb.from('hilos').select('*, creador:agentes!hilos_creado_por_agente_fkey(nombre,eliminado_en), destino:agentes!hilos_para_agente_fkey(nombre,eliminado_en)').eq('buzon_id', buzon.id).order('creado_en', { ascending: false }).limit(50);
  if (filtro === 'pendientes') q = q.in('estado', ['pide_aprobacion', 'pide_cierre']);
  return q;
}

function dibujarListaHilos() {
  const caja = $('#lista-hilos'); if (!caja) return;
  const lista = filtrarHilos(listaHilosCache, { q: buscaHilos, filtro });
  caja.replaceChildren();
  if (!lista.length) {
    const v = document.createElement('div'); v.className = 'vacio';
    v.textContent = listaHilosCache.length && (buscaHilos || filtro === 'pendientes') ? t('hilo.vacioFiltro') : t('hilo.vacio');
    caja.append(v);
    return;
  }
  for (const h of lista) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hilo-item' + (h.id === hiloAbierto ? ' activo' : '');
    btn.setAttribute('role', 'listitem');
    const ini = document.createElement('span'); ini.className = 'inicial'; ini.textContent = inicialDe(h.titulo);
    const info = document.createElement('span'); info.className = 'hilo-info';
    const tit = document.createElement('span'); tit.className = 'hilo-titulo'; tit.textContent = h.titulo || t('hilo.sinTitulo');
    const meta = document.createElement('span'); meta.className = 'hilo-meta meta';
    const badge = document.createElement('span'); badge.className = 'badge ' + (h.estado || ''); badge.textContent = estadoTxt(h.estado);
    const hora = document.createElement('span'); hora.textContent = '🕒 ' + fecha(h.creado_en);
    meta.append(badge, hora);
    info.append(tit, meta);
    btn.append(ini, info);
    btn.onclick = () => { hiloAbierto = h.id; vista = 'chat'; abrirConversacion(h.id); dibujarListaHilos(); if (window.matchMedia('(max-width:860px)').matches) cerrarCajones(); };
    caja.append(btn);
  }
}

async function refrescarListaHilos() {
  const { data, error } = await consultaHilos();
  if (error) return;
  const firma = firmaLista(data || [], ['id', 'estado', 'titulo', 'creado_en']);
  const previa = firmaLista(listaHilosCache, ['id', 'estado', 'titulo', 'creado_en']);
  listaHilosCache = data || [];
  if (firma !== previa) dibujarListaHilos();
}

async function pintar() {
  if (!usuario) return;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#salir').hidden = false;
  pintarSelectorBuzon();
  $$('[data-filtro]').forEach((x) => x.classList.toggle('activa', x.dataset.filtro === filtro));
  const pagina = (vista === 'agentes' || vista === 'conectar');
  const shell = $('#shell'), extra = $('#vista-pagina');
  document.getElementById('app').classList.toggle('es-pagina', pagina);
  if (pagina) {
    shell.hidden = false;
    $('#panel-der').hidden = true;
    $('#panel-centro').hidden = true;
    $('#btn-agentes-hilo').hidden = true;
    extra.hidden = false;
    extra.replaceChildren();
    if (extra.parentElement !== shell) shell.append(extra);
    if (vista === 'agentes') await pintarAgentes(extra);
    else pintarConectar(extra, true);
    await refrescarListaHilos();
    await cargarAgentesDestino();
    arrancarEnVivo();
    return;
  }
  extra.hidden = true;
  extra.replaceChildren();
  $('#panel-centro').hidden = false;
  $('#panel-der').hidden = false;
  await refrescarListaHilos();
  await cargarAgentesDestino();
  if (!hiloAbierto && listaHilosCache.length) {
    const abiertos = listaHilosCache.filter((h) => !hiloCerrado(h.estado));
    hiloAbierto = (abiertos[0] || listaHilosCache[0]).id;
  }
  if (hiloAbierto) await abrirConversacion(hiloAbierto);
  else pintarCentroVacio();
  arrancarEnVivo();
}

function pintarCentroVacio() {
  chatHilo = null;
  $('#chat-cab').hidden = true;
  $('#chat-cab').replaceChildren();
  const cuerpo = $('#chat-cuerpo');
  cuerpo.replaceChildren();
  const msgs = document.createElement('div'); msgs.id = 'chat-msgs';
  const v = document.createElement('div'); v.className = 'vacio'; v.textContent = t('hilo.elige');
  cuerpo.append(v, msgs);
  $('#chat-pie').replaceChildren();
  const avisos = $('#chat-avisos'); if (avisos) avisos.replaceChildren();
  $('#btn-agentes-hilo').hidden = true;
}

let chatHilo = null, chatTimer = null, chatCanal = null, chatVis = null, chatBorrador = '';
const consultaMensajes = (hilo) => sb.from('mensajes').select('id,cuerpo,creado_en,autor_humano,agentes(nombre,eliminado_en)').eq('hilo_id', hilo).order('creado_en');

function nodoBurbuja(m) {
  const d = document.createElement('div');
  d.className = 'burbuja ' + (m.autor_humano ? 'mia' : 'suya');
  d.dataset.id = m.id;
  const autor = document.createElement('div'); autor.className = 'autor';
  const av = document.createElement('span'); av.className = 'avatar';
  const nombre = m.autor_humano ? t('chat.tu') : nombreAutor(m.agentes, t('chat.tu'));
  av.textContent = inicialDe(nombre);
  const meta = document.createElement('span'); meta.className = 'meta';
  meta.textContent = `${nombre} · ${fecha(m.creado_en)}`;
  autor.append(av, meta);
  const cuerpo = document.createElement('div'); cuerpo.className = 'cuerpo'; cuerpo.textContent = m.cuerpo ?? '';
  d.append(autor, cuerpo);
  return d;
}

function pintarCajaMensajes(caja, lista) {
  if (!caja) return;
  const ids = idsMensajes(lista);
  if (caja.dataset.ids === ids) return;
  caja.dataset.ids = ids;
  caja.replaceChildren();
  if (!lista?.length) {
    const p = document.createElement('p'); p.className = 'meta'; p.textContent = t('chat.vacio');
    caja.append(p);
    return;
  }
  for (const m of lista) caja.append(nodoBurbuja(m));
  caja.parentElement?.scrollTo?.({ top: caja.parentElement.scrollHeight });
}

async function refrescarChat() {
  if (!chatHilo) return;
  const caja = $('#chat-msgs'); if (!caja) return;
  const { data, error } = await consultaMensajes(chatHilo);
  if (error) return;
  pintarCajaMensajes(caja, data || []);
}

function detenerEnVivo() {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  if (chatVis) { document.removeEventListener('visibilitychange', chatVis); chatVis = null; }
  if (chatCanal) { sb.removeChannel(chatCanal); chatCanal = null; }
}

function arrancarEnVivo() {
  detenerEnVivo();
  const tick = () => {
    const enChat = vista !== 'agentes' && vista !== 'conectar';
    if (debeEncuestar({ oculto: document.hidden, vista: enChat ? 'chat' : vista, hilo: chatHilo })) refrescarChat();
    const vistaLista = enChat ? (filtro === 'pendientes' ? 'pendientes' : 'todos') : vista;
    if (debeEncuestarLista({ oculto: document.hidden, vista: vistaLista })) refrescarListaHilos();
  };
  chatTimer = setInterval(tick, INTERVALO_SONDEO_MS);
  chatVis = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', chatVis);
  if (chatHilo) {
    chatCanal = sb.channel('chat-' + chatHilo)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensajes', filter: 'hilo_id=eq.' + chatHilo }, () => refrescarChat())
      .subscribe();
  }
}

async function abrirConversacion(id) {
  if (!id) return pintarCentroVacio();
  hiloAbierto = id;
  chatHilo = id;
  const [{ data: h, error: eh }, { data: ms, error: em }, { data: ap }, { data: adj }, { data: evs }, { data: cierres }] = await Promise.all([
    sb.from('hilos').select('*, creador:agentes!hilos_creado_por_agente_fkey(nombre,eliminado_en), destino:agentes!hilos_para_agente_fkey(nombre,eliminado_en)').eq('id', id).single(),
    consultaMensajes(id),
    sb.from('aprobaciones').select('decision,nota,creado_en').eq('hilo_id', id).order('creado_en'),
    sb.from('adjuntos').select('id,nombre,tipo,tamano').eq('hilo_id', id).order('creado_en'),
    sb.from('evidencias_cierre').select('*, agentes(nombre)').eq('hilo_id', id).order('creado_en'),
    sb.from('cierres').select('veredicto,motivo,creado_en').eq('hilo_id', id).order('creado_en'),
  ]);
  if (eh || !h) { if (eh) avisar(t('err.noCargar'), eh); return pintarCentroVacio(); }

  const cab = $('#chat-cab');
  cab.hidden = false;
  cab.replaceChildren();
  const info = document.createElement('div'); info.className = 'cab-info';
  const tit = document.createElement('div'); tit.className = 'cab-titulo'; tit.textContent = h.titulo || t('hilo.sinTitulo');
  const meta = document.createElement('div'); meta.className = 'meta';
  const badge = document.createElement('span'); badge.className = 'badge ' + h.estado; badge.textContent = estadoTxt(h.estado);
  meta.append(badge, document.createTextNode(` · ${t('hilo.de')}: ${nombreAutor(h.creador, t('hilo.tu'))} · ${t('hilo.para')}: ${h.destino ? nombreAutor(h.destino, '') : t('hilo.cualquier')} · 🕒 ${fecha(h.creado_en)}`));
  // Patrón histórico (pruebas): De: ${esc(nombreAutor(h.creador, 'ti'))} · Para: 
  info.append(tit, meta);
  cab.append(info);
  $('#btn-agentes-hilo').hidden = false;

  const cuerpo = $('#chat-cuerpo');
  cuerpo.replaceChildren();
  if (h.contexto) {
    const ctx = document.createElement('div'); ctx.className = 'ficha';
    const b = document.createElement('b'); b.textContent = t('hilo.contexto');
    const p = document.createElement('p'); p.textContent = h.contexto;
    ctx.append(b, p); cuerpo.append(ctx);
  }
  if (adj?.length) {
    const caja = document.createElement('div'); caja.className = 'ficha';
    const b = document.createElement('b'); b.textContent = '📎 ' + t('adjuntos.titulo'); caja.append(b);
    for (const a of adj) {
      const fila = document.createElement('div'); fila.className = 'fila adjunto';
      const sp = document.createElement('span');
      sp.textContent = `${ICONO[a.tipo] ?? '📄'} ${a.nombre} `;
      const kbsp = document.createElement('span'); kbsp.className = 'meta'; kbsp.textContent = kb(a.tamano);
      sp.append(kbsp);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'copiar'; btn.dataset.adj = a.id; btn.textContent = t('adjuntos.descargar');
      btn.onclick = () => descargarAdjunto(a.id, btn);
      fila.append(sp, btn); caja.append(fila);
    }
    cuerpo.append(caja);
  }
  const msgs = document.createElement('div'); msgs.id = 'chat-msgs';
  cuerpo.append(msgs);
  if (!em) pintarCajaMensajes(msgs, ms || []);
  else { const p = document.createElement('p'); p.className = 'meta'; p.textContent = mensajeAmable(em); cuerpo.append(p); }
  for (const a of (ap || [])) {
    const p = document.createElement('p'); p.className = 'ficha';
    p.textContent = `✅ ${a.decision}${a.nota ? ' · ' + a.nota : ''} · ${fecha(a.creado_en)}`;
    cuerpo.append(p);
  }
  for (const e of (evs || [])) {
    const wrap = document.createElement('div');
    wrap.innerHTML = fichaEvidencia(e);
    cuerpo.append(...wrap.childNodes);
  }
  for (const c of (cierres || [])) {
    const p = document.createElement('p'); p.className = 'ficha';
    p.textContent = (c.veredicto === 'aceptado' ? '✅ ' : '❌ ') + (c.motivo || '') + ' · ' + fecha(c.creado_en);
    cuerpo.append(p);
  }

  const pie = $('#chat-pie');
  pie.replaceChildren();
  const cerrado = hiloCerrado(h.estado) || h.estado === 'cerrado';
  const necesitaPie = h.estado === 'pide_aprobacion' || h.estado === 'pide_cierre' || !cerrado;
  if (necesitaPie && h.estado !== 'abierto' && h.estado !== 'tomado') {
    const pieAcc = document.createElement('div');
    pieAcc.className = 'pie';
    pieAcc.innerHTML = `<div class="pie">
    ${h.estado !== 'cerrado' ? `<label for="nota" class="meta">${h.estado === 'pide_cierre' ? (getIdioma() === 'en' ? 'Your reason (optional): it is added to the thread, AIs can read it, and it is stored with your verdict.' : 'Tu motivo (opcional): se agrega al hilo, lo leen las IAs y queda guardado con tu veredicto.') : (getIdioma() === 'en' ? 'Your message: it is added to the thread and AIs can read it.' : 'Tu mensaje: se agrega al hilo y lo leen las IAs.')}</label>
    <textarea id="nota" placeholder="${esc(t('chat.placeholder'))}"></textarea>` : ''}
    <p id="nota-aviso" class="aviso" role="status" hidden></p>
    ${h.estado === 'pide_aprobacion' ? `<div class="fila"><button type="button" class="ok" id="aprobar">${getIdioma() === 'en' ? 'Approve' : 'Aprobar'}</button><button type="button" class="no" id="rechazar">Rechazar</button></div>` : ''}
    ${h.estado === 'pide_cierre' ? `<p class="aviso">${getIdioma() === 'en' ? 'An AI says the work is done.' : 'Una IA dice que el trabajo ya terminó.'}${(evs || []).length ? (getIdioma() === 'en' ? ' Its evidence is above: review it before deciding.' : ' Arriba tienes su evidencia: revísala antes de decidir.') : (getIdioma() === 'en' ? ' <b>It did not bring structured evidence</b>; you can ask it to add some with “Reject”.' : ' <b>No trajo evidencia estructurada</b>; puedes pedirle que la agregue con «Rechazar».')}</p><div class="fila acciones"><button type="button" class="ok" id="cerrar-si">${getIdioma() === 'en' ? t('hilo.aceptarCerrar') : 'Aceptar y&nbsp;cerrar'}</button><button type="button" class="no" id="cerrar-no">${getIdioma() === 'en' ? t('hilo.rechazar') : 'Rechazar'}</button></div>` : ''}
    ${h.estado === 'cerrado' ? `<p class="meta">${t('hilo.cerrado')}</p>` : `<div class="fila">${h.estado !== 'pide_cierre' ? `<button type="button" class="secundario" id="cerrar-ya">${getIdioma() === 'en' ? t('hilo.cerrarYa') : 'Cerrar hilo'}</button>` : ''}<button type="button" id="comentar">${getIdioma() === 'en' ? t('hilo.comentar') : 'Comentar'}</button></div>`}</div>`;
    pie.append(pieAcc);
    enlazarAccionesHilo(id, pieAcc);
  }
  if (!cerrado && h.estado !== 'pide_cierre' && h.estado !== 'pide_aprobacion') {
    const form = document.createElement('form');
    form.id = 'f-chat';
    form.innerHTML = `<div class="composer"><textarea id="chat-texto" rows="1" maxlength="20000" data-i18n-placeholder="chat.placeholder" placeholder="${esc(t('chat.placeholder'))}" aria-label="${esc(t('chat.placeholder'))}"></textarea><button type="submit" class="enviar" aria-label="${esc(t('chat.enviar'))}" title="${esc(t('chat.enviar'))}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span class="visually-hidden">${esc(t('chat.enviar'))}</span></button></div>`;
    pie.append(form);
    if (h.estado !== 'pide_cierre' && !pie.querySelector('#cerrar-ya')) {
      const fila = document.createElement('div');
      fila.className = 'fila chat-meta';
      fila.innerHTML = `<div class="fila">${h.estado !== 'pide_cierre' ? '<button type="button" class="secundario" id="cerrar-ya">Cerrar hilo</button>' : ''}</div>`;
      pie.append(fila);
      $('#cerrar-ya') && ($('#cerrar-ya').onclick = () => cierreHilo(id, true));
    }
    const entrada = $('#chat-texto');
    const boton = form.querySelector('button[type="submit"]');
    const borrador = chatBorrador;
    if (borrador) entrada.value = borrador;
    entrada.addEventListener('input', () => { chatBorrador = entrada.value; entrada.style.height = 'auto'; entrada.style.height = Math.min(entrada.scrollHeight, 200) + 'px'; });
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    $('#f-chat').onsubmit = async (e) => {
      e.preventDefault();
      await enviarMensajeChat({
        cuerpo: entrada.value,
        boton,
        conBotones,
        insertar: (cuerpo) => sb.from('mensajes').insert({ hilo_id: chatHilo, autor_humano: usuario.id, cuerpo }).select('id').single(),
        alError: (err) => avisar('No se pudo enviar', err),
        alExito: async () => { entrada.value = ''; chatBorrador = ''; entrada.style.height = ''; await refrescarChat(); refrescarListaHilos(); },
      });
    };
  } else if (cerrado && !pie.childElementCount) {
    const p = document.createElement('p'); p.className = 'chat-meta'; p.textContent = t('hilo.cerrado'); pie.append(p);
  }

  pintarAvisosHilo(h.id);
  arrancarEnVivo();
  dibujarListaHilos();
}

function enlazarAccionesHilo(id, raiz) {
  const botonesCierre = () => [$('#cerrar-si'), $('#cerrar-no'), $('#cerrar-ya'), $('#comentar')];
  const cierre = (cerrar) => cierreHilo(id, cerrar, botonesCierre());
  $('#cerrar-si') && ($('#cerrar-si').onclick = () => cierre(true));
  $('#cerrar-ya') && ($('#cerrar-ya').onclick = () => cierre(true));
  $('#cerrar-no') && ($('#cerrar-no').onclick = () => cierre(false));
  const decidir = (decision) => conBotones([$('#aprobar'), $('#rechazar')], async () => {
    const { error } = await sb.from('aprobaciones').insert({ hilo_id: id, humano_id: usuario.id, decision, nota: $('#nota')?.value || null });
    if (error) return avisar(t('err.noCerrar'), error);
    pintar();
  });
  $('#aprobar') && ($('#aprobar').onclick = () => decidir('aprobado'));
  $('#rechazar') && ($('#rechazar').onclick = () => decidir('rechazado'));
  if ($('#comentar')) $('#comentar').onclick = () => conBotones(botonesCierre(), async () => {
    const cuerpo = $('#nota').value.trim();
    if (!cuerpo) { const av = $('#nota-aviso'); av.textContent = 'Escribe tu mensaje en el cuadro de arriba antes de tocar «Comentar».'; av.hidden = false; $('#nota').focus(); return; }
    const { error } = await sb.from('mensajes').insert({ hilo_id: id, autor_humano: usuario.id, cuerpo });
    if (error) return avisar('No se pudo enviar', error);
    abrirConversacion(id);
  });
}

function cierreHilo(id, cerrar, bots) {
  return conBotones(bots || [$('#cerrar-ya'), $('#cerrar-si'), $('#cerrar-no')], async () => {
    if (cerrar && !confirm(t('hilo.confirmarCerrar'))) return;
    const { error } = await sb.rpc('decidir_cierre', { p_hilo: id, p_cerrar: cerrar, p_nota: $('#nota')?.value || null });
    if (error) return avisar('No se pudo', error);
    pintar();
  });
}

// Alias: el diálogo de hilo pasa a ser el panel central.
const abrirHilo = (id) => abrirConversacion(id);

async function pintarAvisosHilo(hiloId) {
  const caja = $('#chat-avisos'); if (!caja) return;
  const { data, error } = await sb.rpc('agentes_para_avisos', { p_hilo: hiloId });
  if (error) {
    caja.replaceChildren();
    const p = document.createElement('p'); p.className = 'meta'; p.textContent = mensajeAmable(error);
    caja.append(p);
    return;
  }
  const lista = data ?? [];
  caja.replaceChildren();
  const tit = document.createElement('b'); tit.textContent = t('avisos.titulo'); caja.append(tit);
  const intro = document.createElement('p'); intro.className = 'meta';
  intro.textContent = t('avisos.ayuda');
  caja.append(intro);
  if (!lista.length) {
    const v = document.createElement('p'); v.className = 'meta';
    v.textContent = t('avisos.vacio');
    caja.append(v);
    return;
  }
  let ultimoGrupo = null;
  for (const a of lista) {
    const grupoNombre = a.participa ? 'En esta conversación' : 'Otra IA de tu buzón';
    const grupoI18n = a.participa ? t('avisos.enConversacion') : t('avisos.otraIa');
    if (ultimoGrupo !== grupoNombre) {
      const g = document.createElement('div'); g.className = 'grupo-aviso'; g.textContent = grupoI18n;
      caja.append(g);
      ultimoGrupo = grupoNombre;
    }
    const lab = document.createElement('label'); lab.className = 'chat-aviso-fila';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!a.suscrito;
    cb.dataset.avAg = a.id;
    cb.setAttribute('aria-label', `${t('avisos.titulo')}: ${a.nombre}`);
    const txt = document.createElement('span');
    const nom = document.createElement('b'); nom.textContent = a.nombre;
    const quien = document.createElement('span'); quien.className = 'meta';
    quien.textContent = ' · ' + (a.participa ? 'En esta conversación' : 'Otra IA de tu buzón');
    if (getIdioma() === 'en') quien.textContent = ' · ' + grupoI18n;
    const nota = document.createElement('span'); nota.className = 'meta chat-aviso-nota' + (a.tiene_aviso ? ' si' : '');
    nota.textContent = getIdioma() === 'en'
      ? (a.tiene_aviso ? t('avisos.inmediatos') : t('avisos.cuandoRevise'))
      : etiquetaAviso(!!a.tiene_aviso);
    txt.append(nom, quien, document.createElement('br'), nota);
    lab.append(cb, txt);
    caja.append(lab);
    cb.onchange = () => conBotones([cb], async () => {
      const { error: e2 } = await sb.rpc('suscribir_agente_hilo', { p_hilo: hiloId, p_agente: cb.dataset.avAg, p_activo: cb.checked });
      if (e2) { cb.checked = !cb.checked; return avisar('No se pudo guardar el aviso', e2); }
    });
  }
}

const ESTADO = { abierto: 'Abierto', tomado: 'Una IA lo está trabajando', pide_aprobacion: 'Espera tu aprobación', aprobado: 'Aprobado', rechazado: 'Rechazado', pide_cierre: 'Listo para cerrar: espera tu OK', cerrado: 'Cerrado' };
const estadoTxt = (e) => t('estado.' + e) !== 'estado.' + e ? t('estado.' + e) : (ESTADO[e] ?? e);

const SVG_ICONO = {
  ficha: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-2px" aria-hidden="true"><rect x="3" y="2.5" width="10" height="12" rx="1.5"/><path d="M6 2.5a2 2 0 0 1 4 0M5.8 7h4.4M5.8 10h4.4"/></svg>',
  url: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-2px" aria-hidden="true"><path d="M6.5 9.5a3 3 0 0 0 4.2.2l2-2a3 3 0 1 0-4.2-4.2l-1.1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.2-.2l-2 2a3 3 0 1 0 4.2 4.2l1.1-1"/></svg>',
  adj: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-2px" aria-hidden="true"><path d="M13.5 7.5 8 13a4 4 0 0 1-5.6-5.6l6-6A2.7 2.7 0 0 1 12.2 5l-6 6a1.3 1.3 0 0 1-1.9-1.9l5.5-5.4"/></svg>',
};
const fichaEvidencia = (e) => {
  const pruebas = (e.pruebas || []).map((p) => {
    if (p.url && /^https?:\/\//.test(p.url)) return `<div>${SVG_ICONO.url} <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url)}</a></div>`;
    if (p.adjunto_sha256) return `<div>${SVG_ICONO.adj} Adjunto del hilo · sha256 <code>${esc(p.adjunto_sha256.slice(0, 16))}…</code></div>`;
    return '';
  }).join('');
  return `<div class="msg"><b>${SVG_ICONO.ficha} ${esc(t('evidencia.titulo'))}</b> <span class="meta">${esc(e.agentes?.nombre ?? 'IA')} · ${fecha(e.creado_en)}</span>
    <br><b>${getIdioma() === 'en' ? 'Asked' : 'Se pidió'}:</b> ${esc(e.que_se_pidio)}<br><b>${getIdioma() === 'en' ? 'Delivered' : 'Se entregó'}:</b> ${esc(e.que_se_entrego)}
    ${pruebas ? `<br><b>${getIdioma() === 'en' ? 'Proof' : 'Pruebas'}:</b>${pruebas}` : ''}
    ${e.verificacion ? `<br><b>${getIdioma() === 'en' ? 'Verification' : 'Verificación'}:</b> ${esc(e.verificacion)}` : ''}</div>`;
};

const ICONO = { 'application/pdf': '📕', 'image/png': '🖼️', 'image/jpeg': '🖼️', 'image/webp': '🖼️', 'text/plain': '📄', 'text/markdown': '📝' };
const kb = (n) => n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

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
  } catch (e) { avisar('No se pudo descargar', e); } finally { boton.disabled = false; }
}

async function sha256hex(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function nuevoToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return 'bz_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const nombreAutor = (ag, sin) => (!ag ? sin : ag.eliminado_en ? t('agentes.eliminado') : ag.nombre);
const DIAS_INACTIVO = 30;
const esInactivo = (u) => !u || Date.now() - new Date(u) > DIAS_INACTIVO * 864e5;
let soloActivos = false;

async function borrarAgentes(ids) {
  const { data, error } = await sb.rpc('borrar_agentes', { p_agentes: ids });
  if (error) { avisar(t('err.noBorrar'), error); return false; }
  return data;
}

function mostrarSecreto({ titulo, aviso, valor, extraHtml, alUsar }) {
  const c = $('#dlg-cuerpo');
  c.replaceChildren();
  const h = document.createElement('h3'); h.id = 'dlg-titulo'; /* id="dlg-titulo" */ h.textContent = titulo;
  const p = document.createElement('p'); p.textContent = aviso;
  const wrap = document.createElement('div'); wrap.className = 'secreto';
  const inp = document.createElement('input');
  inp.type = 'password'; inp.value = valor; inp.readOnly = true; inp.autocomplete = 'off'; inp.spellcheck = false;
  inp.id = 'tok'; inp.setAttribute('aria-label', t('secreto.clave'));
  const revelar = document.createElement('button');
  revelar.type = 'button'; revelar.className = 'secundario'; revelar.textContent = t('secreto.revelar');
  revelar.setAttribute('aria-pressed', 'false');
  revelar.onclick = () => {
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    revelar.textContent = show ? t('secreto.ocultar') : t('secreto.revelar');
    revelar.setAttribute('aria-pressed', show ? 'true' : 'false');
  };
  const cp = document.createElement('button');
  cp.type = 'button'; cp.className = 'ok'; cp.id = 'cp-tok'; cp.textContent = t('secreto.copiar');
  cp.onclick = () => copiar(valor, cp);
  wrap.append(inp, revelar, cp);
  c.append(h, p, wrap);
  if (alUsar) {
    const usar = document.createElement('button');
    usar.type = 'button'; usar.id = 'usar-tok'; usar.textContent = t('agentes.verDonde');
    usar.onclick = alUsar;
    c.append(usar);
  }
  if (extraHtml) {
    const extra = document.createElement('div');
    extra.innerHTML = extraHtml;
    c.append(extra);
  }
  $('#dlg').showModal();
}

async function pintarAgentes(v) {
  const [{ data: ags }, { data: est }] = await Promise.all([
    sb.from('agentes').select('id,nombre,creado_en,webhook_url,webhook_tiene_clave,webhook_tiene_secreto, tokens(id,alcances,vence_en,revocado_en,ultimo_uso)').eq('buzon_id', buzon.id).is('eliminado_en', null).order('creado_en'),
    sb.from('estado_agentes').select('agente_id,ultimo_uso,ultima_accion,accion').eq('buzon_id', buzon.id),
  ]);
  const estado = Object.fromEntries((est ?? []).map((e) => [e.agente_id, e]));
  v.innerHTML = (ags.length ? '' : `<div class="vacio"><b>${esc(t('agentes.vacioTitulo'))}</b>${esc(t('agentes.vacio'))}</div>`)
    + `<form id="f-ag" class="tarjeta"><b>${esc(t('agentes.nuevo'))}</b><input id="ag-nombre" required placeholder="${esc(t('agentes.placeholder'))}">
    <select id="ag-dias"><option value="7">${esc(t('agentes.dias7'))}</option><option value="30" selected>${esc(t('agentes.dias30'))}</option><option value="90">${esc(t('agentes.dias90'))}</option></select>
    <button>${esc(t('agentes.crear'))}</button></form>
    <form id="f-nl" class="tarjeta"><b>${esc(t('agentes.nlTitulo'))}</b>
    <p class="meta">${esc(t('agentes.nlAyuda'))}</p>
    <input id="nl-nombre" required maxlength="60" placeholder="${esc(t('agentes.nlNombre'))}">
    <select id="nl-min"><option value="5">${esc(t('agentes.nl5'))}</option><option value="10" selected>${esc(t('agentes.nl10'))}</option><option value="15">${esc(t('agentes.nl15'))}</option></select>
    <button>${esc(t('agentes.nlGenerar'))}</button><div id="nl-lista"></div></form>
    <div class="tarjeta"><b>${esc(t('agentes.tus'))}</b> <span class="meta">(${ags.length})</span>
    <label class="meta" style="display:flex;align-items:center;gap:8px;margin:8px 0"><input type="checkbox" id="solo-act" style="width:20px;height:20px;margin:0;flex:none" ${soloActivos ? 'checked' : ''}> ${esc(t('agentes.soloActivos'))}</label>
    <button class="secundario" id="limpiar">${esc(t('agentes.limpiar'))}</button><div id="limpiar-lista"></div>
    <p class="meta">${esc(t('agentes.inactivoAyuda', { n: DIAS_INACTIVO }))}</p></div>
    <div class="tarjeta"><b>${esc(t('agentes.pushTitulo'))}</b><p class="meta">${esc(t('agentes.pushAyuda'))}</p><div id="push-caja"></div></div>`;
  for (const a of ags) {
    if (soloActivos && esInactivo(estado[a.id]?.ultimo_uso)) continue;
    const d = document.createElement('div'); d.className = 'tarjeta';
    const e = estado[a.id];
    const claveHay = a.webhook_tiene_clave ? t('agentes.claveHay') : t('agentes.claveOpcional');
    const whEstado = a.webhook_url
      ? (a.webhook_tiene_clave || a.webhook_tiene_secreto ? t('agentes.whListo') : t('agentes.whFalta'))
      : t('agentes.whSin');
    d.innerHTML = `<b>${esc(a.nombre)}</b> <span class="estado">${conexion(e?.ultimo_uso)}</span>
      <div class="meta">${e?.ultima_accion ? esc(t('agentes.ultimaAccion')) + ': ' + esc(e.accion) + ' · ' + hace(e.ultima_accion) : esc(t('agentes.sinUso'))}</div>
      <div class="fila"><button type="button" class="copiar" data-probar="${a.id}">${esc(t('agentes.probar'))}</button><button type="button" class="no" data-borrar="${a.id}">${esc(t('agentes.borrar'))}</button></div>
      <details class="guia"><summary>${esc(t('agentes.webhook'))}</summary><p class="meta">${esc(t('agentes.webhookAyuda'))}</p>
      <p class="meta">${esc(t('agentes.grokBot'))}</p>
      <label class="meta" for="wh-${a.id}">${esc(t('agentes.direccion'))}</label><input id="wh-${a.id}" data-wh="${a.id}" type="url" inputmode="url" autocomplete="off" placeholder="https://…" value="${esc(a.webhook_url ?? '')}" maxlength="500">
      <label class="meta" for="whk-${a.id}">${esc(t('agentes.claveReceptor'))} ${esc(claveHay)}</label><input id="whk-${a.id}" data-whk="${a.id}" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(a.webhook_tiene_clave ? '••••••••' : t('agentes.pegarClave'))}" maxlength="500">
      <div class="fila"><button type="button" data-whg="${a.id}">${esc(t('agentes.guardar'))}</button>${a.webhook_tiene_clave ? `<button type="button" data-whq="${a.id}" class="secundario">${esc(t('agentes.quitarClave'))}</button>` : ''}<button type="button" data-whs="${a.id}" class="secundario">${a.webhook_tiene_secreto ? esc(t('agentes.cambiarFirma')) : esc(t('agentes.generarFirma'))}</button></div>
      <p class="meta">${esc(whEstado)}</p></details>` + (a.tokens || []).map((tok) => `<div class="meta">${tok.revocado_en ? t('agentes.revocado') : new Date(tok.vence_en) < new Date() ? t('agentes.vencido') : t('agentes.activo')}
      · ${t('agentes.vence')} ${fecha(tok.vence_en)} · ${t('agentes.ultimoUso')} ${tok.ultimo_uso ? fecha(tok.ultimo_uso) : t('agentes.nunca')}
      ${!tok.revocado_en ? `<button type="button" data-rev="${tok.id}" class="no">${esc(t('agentes.revocar'))}</button>` : ''}</div>`).join('');
    v.append(d);
  }
  v.querySelectorAll('[data-probar]').forEach((b) => b.onclick = () => probarConexion(ags.find((a) => a.id === b.dataset.probar), estado[b.dataset.probar]?.ultimo_uso));
  $('#solo-act').onchange = (e) => { soloActivos = e.target.checked; pintar(); };
  v.querySelectorAll('[data-borrar]').forEach((b) => b.onclick = async () => {
    const a = ags.find((x) => x.id === b.dataset.borrar);
    if (!confirm(t('agentes.confirmarBorrar', { nombre: a.nombre }))) return;
    if (await borrarAgentes([a.id])) pintar();
  });
  $('#limpiar').onclick = () => {
    const inact = ags.filter((a) => esInactivo(estado[a.id]?.ultimo_uso));
    const caja = $('#limpiar-lista');
    if (!inact.length) { caja.innerHTML = `<p class="meta">${esc(t('agentes.sinInactivos'))}</p>`; return; }
    caja.innerHTML = `<p class="meta">${esc(t('agentes.seBorraran', { n: inact.length }))}</p><ul>${inact.map((a) => `<li>${esc(a.nombre)} · ${estado[a.id]?.ultimo_uso ? t('agentes.ultimoUso') + ' ' + fecha(estado[a.id].ultimo_uso) : t('agentes.nuncaConecto')}</li>`).join('')}</ul>
      <div class="fila"><button type="button" class="no" id="limpiar-ok" style="white-space:nowrap">${esc(t('agentes.borrarN', { n: inact.length }))}</button><button type="button" class="secundario" id="limpiar-no">${esc(t('agentes.cancelar'))}</button></div>`;
    $('#limpiar-no').onclick = () => (caja.innerHTML = '');
    $('#limpiar-ok').onclick = async () => {
      if (!confirm(t('agentes.confirmarInactivos', { n: inact.length }))) return;
      if (await borrarAgentes(inact.map((a) => a.id))) pintar();
    };
  };
  v.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
    if (!confirm(t('agentes.confirmarRevocar'))) return;
    const { data, error } = await sb.from('tokens').update({ revocado_en: new Date().toISOString() }).eq('id', b.dataset.rev).select('id');
    if (error || !data?.length) return avisar('No se pudo revocar la clave', error ?? { message: 'sin permiso' });
    pintar();
  });
  v.querySelectorAll('[data-whg]').forEach((b) => b.onclick = () => conBotones([b], async () => {
    const id = b.dataset.whg;
    const url = v.querySelector(`[data-wh="${id}"]`).value.trim() || null;
    const clave = v.querySelector(`[data-whk="${id}"]`).value.trim();
    if (url && !/^https:\/\/[^/@\s]+(\/\S*)?$/.test(url)) return mostrarAviso(getIdioma() === 'en' ? 'The address must start with https:// (no user or password).' : 'La dirección debe empezar con https:// (sin usuario ni contraseña).');
    if (clave && (clave.length < 8 || /\s/.test(clave))) return mostrarAviso(getIdioma() === 'en' ? 'The key looks incomplete: copy it again in full, with no spaces.' : 'La clave parece incompleta: cópiala otra vez completa, sin espacios.');
    const { error } = await sb.rpc('guardar_webhook', { p_agente: id, p_url: url, p_clave: clave || null });
    if (error) return avisar('No se pudo guardar', error);
    pintar();
  }));
  v.querySelectorAll('[data-whq]').forEach((b) => b.onclick = () => conBotones([b], async () => {
    if (!confirm(getIdioma() === 'en' ? 'Remove the key? This AI will stop receiving notices until you paste another.' : '¿Quitar la clave? Esta IA dejará de recibir avisos hasta que pegues otra.')) return;
    const { error } = await sb.rpc('guardar_clave_webhook', { p_agente: b.dataset.whq, p_clave: null });
    if (error) return avisar(getIdioma() === 'en' ? 'Could not remove the key' : 'No se pudo quitar la clave', error);
    pintar();
  }));
  v.querySelectorAll('[data-whs]').forEach((b) => b.onclick = async () => {
    if (!confirm(getIdioma() === 'en' ? 'Generate a new signature? The previous one will stop working.' : '¿Generar una firma nueva? La anterior deja de servir.')) return;
    const { data, error } = await sb.rpc('rotar_secreto_webhook', { p_agente: b.dataset.whs });
    if (error) return avisar(getIdioma() === 'en' ? 'Could not generate the signature' : 'No se pudo generar la firma', error);
    mostrarSecreto({
      titulo: getIdioma() === 'en' ? 'Webhook signature' : 'Firma del webhook',
      aviso: getIdioma() === 'en'
        ? 'Copy it now: it will not be shown again. Only a receiver you program needs it to verify the notice comes from the Inbox (header X-Buzon-Firma, HMAC-SHA256 of "t.cuerpo"). Grok Bot does not need it: it uses the Key.'
        : 'Cópiala ahora: no se vuelve a mostrar. Solo la necesita un receptor que tú programes para comprobar que el aviso viene del Buzón (técnico: cabecera X-Buzon-Firma, HMAC-SHA256 de "t.cuerpo"). Grok Bot no la necesita: usa la Clave.',
      valor: data,
    });
  });
  pintarCodigos(); pintarPush();
  $('#f-nl').onsubmit = async (e) => {
    e.preventDefault();
    const nombre = $('#nl-nombre').value.trim();
    const { data, error } = await sb.rpc('crear_codigo_config', { p_buzon: buzon.id, p_nombre: nombre, p_minutos: +$('#nl-min').value });
    if (error) return avisar('No se pudo generar el código', error);
    const frase = t('agentes.fraseConectate', { url: URL_MCP });
    mostrarSecreto({
      titulo: t('agentes.codigoPara', { nombre }),
      aviso: t('agentes.noPegarChat'),
      valor: data.codigo,
      extraHtml: `<p class="meta">${esc(t('agentes.sirveUna', { fecha: fecha(data.vence_en) }))}</p>
        <p>${esc(t('agentes.dile'))}</p><pre>${esc(frase)}</pre><button type="button" class="copiar" id="cp-frase">${esc(t('agentes.copiarFrase'))}</button>`,
    });
    $('#cp-frase') && ($('#cp-frase').onclick = (ev) => copiar(frase, ev.target));
    $('#nl-nombre').value = ''; pintarCodigos();
  };
  $('#f-ag').onsubmit = async (e) => {
    e.preventDefault();
    const { data: ag, error } = await sb.from('agentes').insert({ buzon_id: buzon.id, nombre: $('#ag-nombre').value }).select('id,nombre').single();
    if (error) return avisar('No se pudo crear el agente', error);
    const token = nuevoToken();
    const vence = new Date(Date.now() + +$('#ag-dias').value * 864e5).toISOString();
    const r = await sb.from('tokens').insert({ agente_id: ag.id, hash_token: await sha256hex(token), vence_en: vence });
    if (r.error) return avisar('No se pudo crear la clave', r.error);
    mostrarSecreto({
      titulo: t('agentes.claveDe', { nombre: ag.nombre }),
      aviso: t('agentes.claveUnaVez'),
      valor: token,
      alUsar: () => { tokenGuia = token; $('#dlg').close(); irA('conectar'); },
    });
    pintar();
  };
}

async function pintarCodigos() {
  const caja = $('#nl-lista'); if (!caja) return;
  const { data } = await sb.from('codigos_config').select('id,nombre_agente,vence_en,usado_en,intentos_fallidos').eq('buzon_id', buzon.id).order('creado_en', { ascending: false }).limit(5);
  caja.innerHTML = (data ?? []).map((c) => `<div class="meta">${esc(c.nombre_agente)} · ${c.usado_en ? '✅ ' + t('agentes.usado') + ' ' + hace(c.usado_en) : new Date(c.vence_en) < new Date() ? t('agentes.vencido') : t('agentes.activoHasta') + ' ' + fecha(c.vence_en)}${c.intentos_fallidos ? ' · ' + t('agentes.intentos', { n: c.intentos_fallidos }) : ''}
    ${!c.usado_en && new Date(c.vence_en) > new Date() ? `<button type="button" class="no" data-anular="${c.id}">${esc(t('agentes.anular'))}</button>` : ''}</div>`).join('');
  caja.querySelectorAll('[data-anular]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.rpc('anular_codigo_config', { p_id: b.dataset.anular }); if (error) return avisar('No se pudo anular el código', error); pintarCodigos();
  });
}

const b64aU8 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pintarPush() {
  const caja = $('#push-caja'); if (!caja) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
    caja.innerHTML = `<p class="meta">${VAPID ? esc(t('push.noSoporta')) : esc(t('push.noServidor'))}</p>`; return;
  }
  const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
  if (Notification.permission === 'denied') { caja.innerHTML = `<p class="aviso">${esc(t('push.bloqueado'))}</p>`; return; }
  caja.innerHTML = `<label class="interruptor"><input type="checkbox" id="push-int" role="switch" ${sub ? 'checked' : ''}><span>${esc(t('push.interruptor'))}</span></label>${sub ? `<p class="meta">${esc(t('push.activos'))}</p>` : ''}`;
  $('#push-int').onchange = async (ev) => {
    if (ev.target.checked) {
      if (await Notification.requestPermission() !== 'granted') return pintarPush();
      try {
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aU8(VAPID) });
        const { error } = await sb.from('push_suscripciones').insert({ buzon_id: buzon.id, humano_id: usuario.id, endpoint: s.endpoint, p256dh: b64u(s.getKey('p256dh')), auth: b64u(s.getKey('auth')) });
        if (error) { await s.unsubscribe(); throw error; }
      } catch (e) { avisar(getIdioma() === 'en' ? 'Could not enable notifications' : 'No se pudieron activar los avisos', e); }
    } else {
      await sb.from('push_suscripciones').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe();
    }
    pintarPush();
  };
}

async function copiar(texto, boton) {
  try { await navigator.clipboard.writeText(texto); } catch {
    const ta = document.createElement('textarea'); ta.value = texto; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (!boton) return;
  const o = boton.textContent; boton.textContent = t('conectar.copiado'); setTimeout(() => (boton.textContent = o), 1500);
}

function textoGuia(g) {
  const en = GUIAS_EN[g.id];
  if (getIdioma() === 'en' && en) {
    return { ...g, nombre: en.nombre, donde: en.donde, pasos: en.pasos, probar: en.probar ?? g.probar, nota: en.nota ?? g.nota };
  }
  return g;
}
function etiquetaDe(estado) { return (getIdioma() === 'en' ? ETIQUETA_EN : ETIQUETA)[estado] || estado; }
function queHacerDe(estado) { return (getIdioma() === 'en' ? QUE_HACER_EN : QUE_HACER)[estado] || ''; }

function pintarConectar(v, conSesion) {
  v.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'conectar';
  const tokOk = conSesion && /^bz_[A-Za-z0-9_-]{20,}$/.test(tokenGuia);
  wrap.innerHTML = `
    <div class="tarjeta">
      <label for="busca-agente"><b id="conectar-pregunta">${esc(t('conectar.pregunta'))}</b></label>
      <div class="conectar-busca">
        <input type="search" id="busca-agente" autocomplete="off" spellcheck="false"
          placeholder="${esc(t('conectar.placeholder'))}"
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="conectar-lista" aria-haspopup="listbox">
        <ul id="conectar-lista" role="listbox" aria-label="${esc(t('conectar.pregunta'))}"></ul>
      </div>
      <p class="meta">${esc(t('conectar.urlAyuda'))}</p>
      <p class="meta">${esc(t('conectar.mcpUrl'))}</p>
      <div class="bloque-copia"><pre id="url-mcp">${esc(URL_MCP)}</pre><div class="fila"><button type="button" class="copiar" id="cp-url">${esc(t('conectar.copiarUrl'))}</button></div></div>
      ${conSesion ? `<p class="meta">${tokOk ? esc(t('conectar.incluyeClave')) : esc(t('conectar.faltaClave'))}</p>
        ${tokOk ? `<div class="secreto"><input id="tok-guia" type="password" value="${esc(tokenGuia)}" readonly autocomplete="off" aria-label="${esc(t('secreto.clave'))}">
          <button type="button" class="secundario" id="tok-revelar">${esc(t('secreto.revelar'))}</button>
          <button type="button" class="secundario" id="tok-copiar">${esc(t('secreto.copiar'))}</button></div>` : `<button type="button" class="secundario" id="ir-ag">${esc(t('conectar.irAgentes'))}</button>`}` : ''}
    </div>
    <div id="guia-detalle" class="tarjeta" hidden></div>
    ${conSesion ? `<div class="tarjeta" id="caja-probar"><b>${esc(t('conectar.probar'))}</b><div id="probar-caja"></div></div>` : ''}`;
  v.append(wrap);
  $('#cp-url').onclick = (e) => copiar(URL_MCP, e.target);
  $('#ir-ag') && ($('#ir-ag').onclick = () => irA('agentes'));
  if ($('#tok-revelar')) {
    $('#tok-revelar').onclick = () => {
      const inp = $('#tok-guia');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $('#tok-revelar').textContent = show ? t('secreto.ocultar') : t('secreto.revelar');
    };
    $('#tok-copiar').onclick = (e) => copiar(tokenGuia, e.target);
  }

  let activo = -1, visible = [], elegido = null;
  const input = $('#busca-agente');
  const listaEl = $('#conectar-lista');
  const detalle = $('#guia-detalle');

  const nombresEn = Object.fromEntries(Object.entries(GUIAS_EN).map(([id, x]) => [id, x.nombre]));
  const pintarLista = () => {
    const { vacio, resultados, sugerencias } = buscarGuias(input.value, GUIAS, { idioma: getIdioma(), nombresEn });
    visible = vacio ? sugerencias : resultados;
    listaEl.replaceChildren();
    if (vacio) {
      const cap = document.createElement('li');
      const p = document.createElement('p'); p.className = 'meta'; p.style.padding = '8px 14px';
      p.textContent = t('conectar.sugerencias') + ' — ' + t('conectar.elegir');
      cap.append(p); listaEl.append(cap);
    } else if (!visible.length) {
      const cap = document.createElement('li');
      const p = document.createElement('p'); p.className = 'meta'; p.style.padding = '8px 14px';
      p.textContent = t('conectar.sinResultados');
      cap.append(p); listaEl.append(cap);
      // sugerencias debajo del vacío de resultados
      const { sugerencias: sg } = buscarGuias('', GUIAS, { idioma: getIdioma(), nombresEn });
      visible = sg;
    }
    visible.forEach((g, i) => {
      const li = document.createElement('li');
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.id = 'opt-guia-' + g.id;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', i === activo ? 'true' : 'false');
      const tg = textoGuia(g);
      opt.textContent = tg.nombre;
      const eti = document.createElement('span'); eti.className = 'eti'; eti.textContent = etiquetaDe(g.estado);
      opt.append(eti);
      opt.onclick = () => seleccionar(g);
      li.append(opt);
      listaEl.append(li);
    });
    input.setAttribute('aria-expanded', 'true');
    if (activo >= 0 && visible[activo]) input.setAttribute('aria-activedescendant', 'opt-guia-' + visible[activo].id);
    else input.removeAttribute('aria-activedescendant');
  };

  const seleccionar = (g) => {
    elegido = g;
    activo = visible.findIndex((x) => x.id === g.id);
    pintarLista();
    mostrarGuia(g);
    detalle.focus?.();
  };

  const mostrarGuia = (g) => {
    const tg = textoGuia(g);
    const vars = { url: URL_MCP, canje: URL_CANJE, token: tokOk ? tokenGuia : null };
    const r = (s) => rellenarPlantilla(s, vars);
    const codigoReal = tg.codigo ? r(tg.codigo) : '';
    const codigoVista = tokOk ? enmascararToken(codigoReal, tokenGuia) : r(tg.codigo || '').replaceAll('{TOKEN}', 'bz_…');
    detalle.hidden = false;
    detalle.replaceChildren();
    const h = document.createElement('h3'); h.textContent = tg.nombre;
    const eti = document.createElement('p'); eti.innerHTML = `<b>${esc(etiquetaDe(g.estado))}</b><br><span class="meta">${esc(queHacerDe(g.estado))}</span>`;
    const donde = document.createElement('p');
    const db = document.createElement('b'); db.textContent = t('conectar.donde') + ': ';
    donde.append(db, document.createTextNode(r(tg.donde)));
    const ol = document.createElement('ol'); ol.className = 'guia-pasos';
    (tg.pasos || []).forEach((p) => { const li = document.createElement('li'); li.textContent = r(p); ol.append(li); });
    detalle.append(h, eti, donde, ol);
    if (codigoReal || tg.codigo) {
      const bl = document.createElement('div'); bl.className = 'bloque-copia';
      const pre = document.createElement('pre'); pre.textContent = codigoVista;
      const fila = document.createElement('div'); fila.className = 'fila';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'copiar'; b.textContent = t('conectar.copiarConfig');
      b.onclick = () => copiar(codigoReal || codigoVista, b);
      fila.append(b); bl.append(pre, fila); detalle.append(bl);
    }
    if (tg.nota) {
      const n = document.createElement('p'); n.className = 'aviso'; n.textContent = r(tg.nota); detalle.append(n);
    }
    if (tg.probar && tg.probar !== '—') {
      const pr = document.createElement('p'); pr.className = 'meta';
      const b = document.createElement('b'); b.textContent = t('conectar.probar') + ': ';
      pr.append(b, document.createTextNode(r(tg.probar)));
      detalle.append(pr);
    }
  };

  input.addEventListener('input', () => { activo = -1; elegido = null; detalle.hidden = true; pintarLista(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(activo + 1, visible.length - 1); pintarLista(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(activo - 1, 0); pintarLista(); }
    else if (e.key === 'Enter' && visible[activo]) { e.preventDefault(); seleccionar(visible[activo]); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = ''; activo = -1; elegido = null; detalle.hidden = true; pintarLista(); }
    else if (e.key === 'Home') { e.preventDefault(); activo = 0; pintarLista(); }
    else if (e.key === 'End') { e.preventDefault(); activo = visible.length - 1; pintarLista(); }
  });
  pintarLista();

  if (conSesion) cargarProbar(wrap);
}

async function cargarProbar(wrap) {
  const caja = wrap.querySelector('#probar-caja'); if (!caja || !buzon) return;
  const { data: ags } = await sb.from('agentes').select('id,nombre').eq('buzon_id', buzon.id).is('eliminado_en', null).order('nombre');
  if (!ags?.length) { caja.innerHTML = `<p class="meta">${esc(t('avisos.vacio'))}</p>`; return; }
  const { data: est } = await sb.from('estado_agentes').select('agente_id,ultimo_uso').eq('buzon_id', buzon.id);
  const uso = Object.fromEntries((est ?? []).map((e) => [e.agente_id, e.ultimo_uso]));
  const sel = document.createElement('select'); sel.id = 'probar-agente'; sel.setAttribute('aria-label', t('conectar.probar'));
  for (const a of ags) {
    const o = document.createElement('option'); o.value = a.id; o.textContent = a.nombre; sel.append(o);
  }
  const b = document.createElement('button'); b.type = 'button'; b.className = 'ok'; b.textContent = t('conectar.probar');
  b.onclick = () => {
    const ag = ags.find((x) => x.id === sel.value);
    if (ag) probarConexion(ag, uso[ag.id]);
  };
  const fila = document.createElement('div'); fila.className = 'fila'; fila.style.marginTop = '8px';
  fila.append(sel, b); caja.append(fila);
}

function hace(f) {
  const s = Math.round((Date.now() - new Date(f)) / 1000);
  if (s < 60) return t('hace.seg');
  if (s < 3600) return t('hace.min', { n: Math.round(s / 60) });
  if (s < 86400) return t('hace.horas', { n: Math.round(s / 3600) });
  return fecha(f);
}
function conexion(u) {
  if (!u) return t('conexion.sin');
  return Date.now() - new Date(u) < 15 * 60e3 ? t('conexion.reciente') : t('conexion.antes', { hace: hace(u) });
}

let sondeo;
async function probarConexion(ag, antes) {
  clearInterval(sondeo);
  const c = $('#dlg-cuerpo'), inicio = Date.now(), base = antes ? new Date(antes).getTime() : 0;
  const frase = t('probar.frase');
  c.replaceChildren();
  const h = document.createElement('h3'); h.id = 'dlg-titulo'; h.textContent = t('probar.titulo', { nombre: ag.nombre });
  const p1 = document.createElement('p'); p1.textContent = t('probar.paso1', { nombre: ag.nombre });
  const pre = document.createElement('pre'); pre.textContent = frase;
  const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'copiar'; cp.id = 'cp-ping'; cp.textContent = t('probar.copiar');
  cp.onclick = (e) => copiar(frase, e.target);
  const p2 = document.createElement('p'); p2.textContent = t('probar.paso2');
  const est = document.createElement('p'); est.id = 'ping-estado'; est.className = 'aviso'; est.textContent = t('probar.esperando', { nombre: ag.nombre });
  c.append(h, p1, pre, cp, p2, est);
  $('#dlg').showModal();
  const revisar = async () => {
    if (!$('#dlg').open) return clearInterval(sondeo);
    const { data } = await sb.from('estado_agentes').select('ultimo_uso').eq('agente_id', ag.id).maybeSingle();
    const u = data?.ultimo_uso ? new Date(data.ultimo_uso).getTime() : 0;
    const p = $('#ping-estado'); if (!p) return clearInterval(sondeo);
    if (u > base) { clearInterval(sondeo); p.className = 'vacio'; p.textContent = t('probar.ok', { nombre: ag.nombre, hace: hace(data.ultimo_uso) }); pintar(); }
    else if (Date.now() - inicio > 180e3) { clearInterval(sondeo); p.textContent = t('probar.timeout'); }
  };
  sondeo = setInterval(revisar, 4000); revisar();
}
