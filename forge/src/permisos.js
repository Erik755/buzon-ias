// Verificación del rol de administrador del SITIO con mypermissions (siempre asUser).
// Solo se ejercita en runtime Forge (tunnel/deploy); fail-closed: ante cualquier error,
// se considera que el usuario NO es admin.
import api, { route } from '@forge/api';
import { ErrorPanel } from './comun.js';

export async function soyAdmin() {
  try {
    const r = await api.asUser().requestJira(
      route`/rest/api/3/mypermissions?permissions=ADMINISTER`,
      { headers: { Accept: 'application/json' } },
    );
    if (!r.ok) return false;
    const d = await r.json();
    return !!d.permissions?.ADMINISTER?.havePermission;
  } catch {
    return false;
  }
}

export async function exigirAdmin() {
  if (!(await soyAdmin())) throw new ErrorPanel('site administrator role required');
}
