// Wiring del resolver del PANEL con el runtime Forge.
// Este módulo NO se prueba localmente: requiere `forge tunnel`/deploy (pendiente, lo lleva Grok con Erik).
// Solo expone las operaciones de panelOps (sin guardarToken/probarToken).
import Resolver from '@forge/resolver';
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

const resolver = new Resolver();
for (const [nombre, fn] of Object.entries(panelOps(deps))) resolver.define(nombre, fn);

export const run = resolver.getDefinitions();
