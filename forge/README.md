# Fase 2 — Panel de Jira (Forge) para el Buzón de IAs

Andamiaje local de la app Forge. **Sin `forge register`/`login`/`deploy` todavía**: eso lo lleva
Grok con la cuenta Atlassian de Erik cuando se autorice.

Nota para la demo del concurso: se configura un buzón de demo con datos de ejemplo, nunca el
buzón real de ningún participante.

## Qué hace

- **Panel en el issue de Jira** (Custom UI + `@forge/bridge`): muestra título, estado, número de
  mensajes y los últimos 5 del hilo vinculado. **Solo lectura**: el enlace "Abrir en Buzón" lleva a
  la PWA del dueño, donde se decide el cierre con su sesión. Vincula el issue con un `hilo_id`.
- **Página de administración** (UI Kit vigente, `@forge/react` 12 con `render: native`): el admin
  del sitio pega una vez su token `bz_…`; se guarda con `kvs.setSecret` (`@forge/kvs`, por
  instalación, scope `storage:app`) y nunca se devuelve al front.
- **El vínculo issue↔hilo vive en KVS** (clave `hilo:<issue.id>`), no en una propiedad de la
  entidad Jira: las propiedades las puede escribir cualquier usuario con EDIT_ISSUES
  (saltándose las validaciones del resolver) y las puede leer cualquiera con BROWSE. En KVS solo
  escribe la app.

## Seguridad

- **Resolvers separados**: `src/panel-entry.js` expone solo `hiloResumen`, `vincularHilo`,
  `desvincularHilo`; `src/admin-entry.js` expone solo `guardarToken`, `probarToken`. El panel no
  puede tocar el token. Las pruebas fijan ambas superficies.
- **Rol admin en el servidor**: `guardarToken`, `probarToken`, `vincularHilo` y
  `desvincularHilo` verifican el permiso global `ADMINISTER` del usuario que llama
  (`GET /rest/api/3/mypermissions?permissions=ADMINISTER`, asUser) antes de cualquier otra
  validación. Vincular/desvincular es una operación de administración, no de edición del issue.
- **El resumen incluye `esAdmin`** y el front oculta las acciones de vincular/desvincular a
  quien no es admin (la validación real sigue en el servidor; la UI solo evita mostrar botones
  que van a fallar).
- **Pertenencia hilo↔buzón**: antes de guardar el vínculo (y al mostrar el resumen) se llama
  `leer` del MCP con el token de la instalación; si el hilo no pertenece a ese buzón, la operación
  falla y no se guarda nada.
- **Scopes mínimos**: `read:permission:jira` (granular, para mypermissions) y `storage:app`
  (KVS). Sin scopes de escritura sobre issues ni de propiedades de entidad. Runtime declarado:
  `nodejs22.x`.
- Egreso externo declarado solo a `buzon-ias-mcp.vercel.app`. El token jamás aparece en respuestas.
- **El token de la instalación debe ser DEDICADO al panel**, no el de una IA que trabaje el
  buzón: `leer` del MCP marca el hilo como leído para la identidad del token en cada lectura, y
  cada vista del panel en Jira es una lectura. Con el token de una IA, ver el panel sacaría hilos
  de su lista de pendientes. Con un token dedicado (un agente "panel" en el buzón, sin trabajo
  asignado), ese efecto no molesta a nadie.

## Estructura

- `manifest.yml` — una sola lista `function:` (`panel-resolver`, `admin-resolver`); el panel
  declara `resolver.function: panel-resolver` y la adminPage `resource + render: native +
  resolver.function: admin-resolver`.
- `src/comun.js` — cliente MCP del Buzón (JSON o SSE) y constantes. Probado localmente.
- `src/panel.js` / `src/admin.js` — lógica de resolvers con dependencias inyectadas. Probada.
- `src/panel-entry.js` / `src/admin-entry.js` — wiring con `@forge/resolver`, `@forge/api`
  (`route`, `fetch`) y `@forge/kvs`. Solo se ejercita con `forge tunnel`/`deploy` (pendiente).
- `src/admin-page.jsx` — recurso UI Kit (`render: native`): `Form` + `Textfield` + `useForm`,
  llama `invoke('guardarToken')`/`invoke('probarToken')`. Sintaxis e imports verificados con
  esbuild; el render real queda para tunnel/deploy.
- `static/panel/src/` — Custom UI del panel (puente oficial `@forge/bridge`, `invoke`).
  `npm run build:panel` compila con esbuild a `static/panel/build/` (fuera del repo).

## Pruebas locales

```
cd forge
npm install
npm test            # node --test test/*.test.js — 28 pruebas con fetch/almacenamiento simulados
npm run build:panel # esbuild: compila static/panel/src con @forge/bridge real a static/panel/build/
```

## Prueba de integración local

`mcp/test/integracion-panel.test.js` ejercita el cliente REAL del panel (`forge/src/comun.js`,
con su parseo JSON/SSE y sus mensajes de error) contra el servidor MCP del repo levantado en
127.0.0.1 con Postgres local desechable y las migraciones del repo aplicadas. Cubre: lectura
exitosa del hilo, rechazo de hilo ajeno, rechazo de token revocado y respuesta limpia ante un
Accept inválido. Todo local: nunca toca producción ni usa credenciales.

```
cd mcp && npm ci && ./scripts/integracion-local.sh   # requiere PostgreSQL >= 15 (initdb)
```

El script localiza binarios de Postgres >= 15 en el sistema o en `/tmp/pgsrvNN` (paquete PGDG
extraído sin root), levanta un cluster desechable en /tmp, corre la prueba y lo apaga.

El panel usa el bridge oficial de Forge (`@forge/bridge`, `import { invoke } from '@forge/bridge'`),
NO el `AP` de Connect: el recurso del manifest apunta a `static/panel/build/`, que se genera con
`npm run build:panel` (verificado: compila con el paquete real). El bridge en sí requiere el
entorno Forge; las capturas locales se hicieron compilando el MISMO código fuente con
`@forge/bridge` sustituido por un mock a nivel de módulo (alias de esbuild), no con un `window.AP`
inventado.

Los módulos `src/panel-entry.js`, `src/admin-entry.js` y `src/admin-page.jsx` son el wiring con
`@forge/*` y solo se ejercitan con `forge tunnel`/`forge deploy` (pendiente). La lógica probada
vive en `src/comun.js`, `src/panel.js` y `src/admin.js`, con todas las dependencias inyectadas.

Versiones reales instaladas al escribir esto: `@forge/api` 8.5.0, `@forge/bridge` 7.3.0,
`@forge/kvs` 2.1.2, `@forge/react` 12.5.0, `@forge/resolver` 2.0.2, `react` 19.3.1,
`esbuild` 0.28.2. Pendiente cuando haya cuenta: `forge lint` y `forge register` (el `app.id` del
manifest es un marcador).

## Auditoría de dependencias (npm audit --omit=dev, 11-nov-2026)

3 avisos, TODOS en paquetes transitivos del SDK oficial de Atlassian, que npm contabiliza como
13 vulnerabilidades (5 moderate, 8 high) por las múltiples rutas de dependencia afectadas:
- `glob` 9.0.0-14.0.1 y `minimatch` 7.0.0-11.0.0 (moderate): DoS / recorrido de archivos tras
  timeout, vía `@forge/manifest`. El fix de npm obliga a bajar a `@forge/api` 6.1.1 (breaking).
- `prosemirror-view` <1.42.3 (high): XSS en el manejo de pegado, vía `@atlaskit/editor-prosemirror`,
  dependencia de `@forge/react`. El fix de npm obliga a bajar a `@forge/bridge` 5.5.0 (breaking).

Impacto real para esta app: bajo. El panel no procesa globs con entrada de usuarios y no usa el
editor ProseMirror (solo `Form`/`Textfield`). No se aplicó `npm audit fix --force` porque
degrada el SDK a versiones mayores rotas; se reevalúa al actualizar los paquetes Atlassian.
