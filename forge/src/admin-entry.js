// Wiring del resolver de ADMINISTRACIÓN con el runtime Forge.
// Wiring verificado en entorno Forge real (deploy development, 11-nov-2026): la CLI (webpack)
// compila `import Resolver from` roto (new namespaceObject()); por eso se usa la exportacion nombrada makeResolver.
// Solo expone las operaciones de adminOps (guardarToken/probarToken), ambas con requireAdmin().
import { makeResolver } from '@forge/resolver';
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

export const run = makeResolver(adminOps(deps));
