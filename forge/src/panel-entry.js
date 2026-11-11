// Wiring del resolver del PANEL con el runtime Forge.
// Wiring verificado en entorno Forge real (deploy development, 11-nov-2026): la CLI (webpack)
// compila `import Resolver from` roto (new namespaceObject()); por eso se usa la exportacion nombrada makeResolver.
// Solo expone las operaciones de panelOps (sin guardarToken/probarToken).
import { makeResolver } from '@forge/resolver';
import { fetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import { panelOps } from './panel.js';
import { exigirAdmin, soyAdmin } from './permisos.js';
import { KVS_TOKEN } from './comun.js';

// El vínculo issue<->hilo en KVS: solo la app lo escribe (a diferencia de una propiedad del
// issue, editable por REST por cualquiera con EDIT_ISSUES). Clave por issue.id.
const claveVinculo = (issueId) => `hilo:${issueId}`;

const deps = {
  fetchImpl: (url, opts) => fetch(url, opts),
  leerToken: () => kvs.getSecret(KVS_TOKEN),
  requireAdmin: exigirAdmin,
  esAdmin: soyAdmin,
  leerVinculo: (issueId) => kvs.get(claveVinculo(issueId)),
  guardarVinculo: (issueId, hiloId) => kvs.set(claveVinculo(issueId), hiloId),
  borrarVinculo: (issueId) => kvs.delete(claveVinculo(issueId)),
};

export const run = makeResolver(panelOps(deps));
