// Wiring del resolver de ADMINISTRACIÓN con el runtime Forge.
// Este módulo NO se prueba localmente: requiere `forge tunnel`/deploy (pendiente, lo lleva Grok con Erik).
// Solo expone las operaciones de adminOps (guardarToken/probarToken), ambas con requireAdmin().
import Resolver from '@forge/resolver';
import { fetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import { adminOps } from './admin.js';
import { exigirAdmin } from './permisos.js';
import { KVS_TOKEN } from './comun.js';

const deps = {
  fetchImpl: (url, opts) => fetch(url, opts),
  leerToken: () => kvs.getSecret(KVS_TOKEN),
  guardarSecreto: (k, v) => kvs.setSecret(k, v),
  requireAdmin: exigirAdmin,
};

const resolver = new Resolver();
for (const [nombre, fn] of Object.entries(adminOps(deps))) resolver.define(nombre, fn);

export const run = resolver.getDefinitions();
