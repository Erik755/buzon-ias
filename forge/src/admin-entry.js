// Wiring del resolver de ADMINISTRACIÓN con el runtime Forge.
// Este módulo NO se prueba localmente: requiere `forge tunnel`/deploy (pendiente, lo lleva Grok con Erik).
// Solo expone las operaciones de adminOps (guardarToken/probarToken), ambas con requireAdmin().
import Resolver from '@forge/resolver';
import api, { route, fetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import { adminOps } from './admin.js';
import { ErrorPanel, KVS_TOKEN } from './comun.js';

// Rol de administrador del SITIO: permiso global ADMINISTER del usuario que llama.
async function exigirAdmin() {
  const r = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?permissions=ADMINISTER`,
    { headers: { Accept: 'application/json' } },
  );
  if (!r.ok) throw new Error(`jira mypermissions: HTTP ${r.status}`);
  const d = await r.json();
  if (!d.permissions?.ADMINISTER?.havePermission) {
    throw new ErrorPanel('se requiere rol de administrador del sitio');
  }
}

const deps = {
  fetchImpl: (url, opts) => fetch(url, opts),
  leerToken: () => kvs.getSecret(KVS_TOKEN),
  guardarSecreto: (k, v) => kvs.setSecret(k, v),
  requireAdmin: exigirAdmin,
};

const resolver = new Resolver();
for (const [nombre, fn] of Object.entries(adminOps(deps))) resolver.define(nombre, fn);

export const run = resolver.getDefinitions();
