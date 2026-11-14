// Custom UI del panel (Forge): SOLO LECTURA. El veredicto (aceptar/rechazar) se decide en la PWA del dueño.
// Bridge oficial de Forge (@forge/bridge), NO el AP de Connect. Se compila con esbuild a ../build/.
// Vincular/desvincular solo se muestran a admins (r.esAdmin del servidor); el servidor vuelve
// a verificar el rol en cada llamada, esto es solo presentación.
import { invoke } from '@forge/bridge';

const app = document.getElementById('app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pintarVinculo(esAdmin) {
  if (!esAdmin) {
    app.innerHTML = '<p class="aviso">This issue is not linked to any Buzón thread. Only a site administrator can link it.</p>';
    return;
  }
  app.innerHTML = `
    <p class="aviso">Link this issue to a Buzón thread:</p>
    <input type="text" id="hilo" placeholder="thread_id (UUID)" />
    <button id="vincular">Link</button>
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
    <p class="aviso">${r.totalMensajes} messages · latest ${r.ultimos.length}:</p>
    ${ultimos || '<p class="aviso">(no messages)</p>'}
    <a class="boton" href="${esc(r.enlacePwa)}" target="_blank" rel="noopener">Open in Buzón de IAs to decide</a>
    ${r.esAdmin ? '<p><a href="#" id="desvincular">Unlink thread</a></p>' : ''}
    <p id="msg"></p>`;
  if (r.esAdmin) {
    document.getElementById('desvincular').onclick = async (e) => {
      e.preventDefault();
      try {
        await invoke('desvincularHilo', {});
        pintar();
      } catch (err) {
        document.getElementById('msg').innerHTML = `<span class="error">${esc(err.message || err)}</span>`;
      }
    };
  }
}

async function pintar() {
  app.textContent = 'Loading…';
  try {
    const r = await invoke('hiloResumen', {});
    if (!r.vinculado) pintarVinculo(r.esAdmin);
    else pintarResumen(r);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message || e)}</p>`;
  }
}

pintar();
