// Custom UI del panel (Forge): SOLO LECTURA. El veredicto (aceptar/rechazar) se decide en la PWA del dueño.
// Bridge oficial de Forge (@forge/bridge), NO el AP de Connect. Se compila con esbuild a ../build/.
import { invoke } from '@forge/bridge';

const app = document.getElementById('app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pintarVinculo() {
  app.innerHTML = `
    <p class="aviso">Vincula este issue con un hilo del buzón:</p>
    <input type="text" id="hilo" placeholder="hilo_id (UUID)" />
    <button id="vincular">Vincular</button>
    <p id="msg"></p>`;
  document.getElementById('vincular').onclick = async () => {
    const hiloId = document.getElementById('hilo').value.trim();
    try {
      await invoke('vincularHilo', { hiloId });
      pintar();
    } catch (e) {
      document.getElementById('msg').innerHTML = `<span class="error">${esc(e.message || e)}</span>`;
    }
  };
}

function pintarResumen(r) {
  const ultimos = r.ultimos.map((m) => `
    <div class="msg"><b>${esc(m.autor)} · ${esc(m.creado_en)}</b><p>${esc(m.cuerpo)}</p></div>`).join('');
  app.innerHTML = `
    <h2>${esc(r.titulo)} <span class="estado">${esc(r.estado)}</span></h2>
    <p class="aviso">${r.totalMensajes} mensajes · últimos ${r.ultimos.length}:</p>
    ${ultimos || '<p class="aviso">(sin mensajes)</p>'}
    <a class="boton" href="${esc(r.enlacePwa)}" target="_blank" rel="noopener">Abrir en el Buzón para decidir</a>
    <p><a href="#" id="desvincular">Desvincular hilo</a></p>`;
  document.getElementById('desvincular').onclick = async (e) => {
    e.preventDefault();
    await invoke('desvincularHilo', {});
    pintar();
  };
}

async function pintar() {
  app.textContent = 'Cargando…';
  try {
    const r = await invoke('hiloResumen', {});
    if (!r.vinculado) pintarVinculo();
    else pintarResumen(r);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message || e)}</p>`;
  }
}

pintar();
