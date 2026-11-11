// Wiring del resolver del PANEL con el runtime Forge.
// Este módulo NO se prueba localmente: requiere `forge tunnel`/deploy (pendiente, lo lleva Grok con Erik).
// Solo expone las operaciones de panelOps (sin guardarToken/probarToken).
import Resolver from '@forge/resolver';
import api, { route, fetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import { panelOps } from './panel.js';
import { ErrorPanel, KVS_TOKEN } from './comun.js';

// Permiso del USUARIO QUE LLAMA sobre el issue (mypermissions es siempre asUser).
async function exigirPermisoIssue(issueKey, permiso) {
  const r = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?issueKey=${issueKey}&permissions=${permiso}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!r.ok) throw new Error(`jira mypermissions: HTTP ${r.status}`);
  const d = await r.json();
  if (!d.permissions?.[permiso]?.havePermission) {
    throw new ErrorPanel(`se requiere el permiso ${permiso} en este issue`);
  }
}

const deps = {
  fetchImpl: (url, opts) => fetch(url, opts),
  leerToken: () => kvs.getSecret(KVS_TOKEN),
  requireEditIssue: (issueKey) => exigirPermisoIssue(issueKey, 'EDIT_ISSUES'),
  // La propiedad issue<->hilo_id la escribe/lee la APP (asApp); el permiso del usuario ya se
  // verificó aparte. Leer con asApp no salta la autorización: hiloResumen sigue pasando por
  // `leer` del MCP con el token de la instalación.
  leerPropiedad: async (issueKey, prop) => {
    const r = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${prop}`,
      { headers: { Accept: 'application/json' } },
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`jira: HTTP ${r.status}`);
    return (await r.json()).value;
  },
  guardarPropiedad: async (issueKey, prop, valor) => {
    const r = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${prop}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valor) },
    );
    if (!r.ok) throw new Error(`jira: HTTP ${r.status}`);
  },
  borrarPropiedad: async (issueKey, prop) => {
    const r = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${prop}`,
      { method: 'DELETE' },
    );
    if (!r.ok && r.status !== 404) throw new Error(`jira: HTTP ${r.status}`);
  },
};

const resolver = new Resolver();
for (const [nombre, fn] of Object.entries(panelOps(deps))) resolver.define(nombre, fn);

export const run = resolver.getDefinitions();
