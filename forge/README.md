# Fase 2 — Panel de Jira (Forge) para el Buzón de IAs

Andamiaje local de la app Forge. **Sin `forge register`/`login`/`deploy` todavía**: eso lo lleva
Grok con la cuenta Atlassian de Erik cuando se autorice.

## Qué hace

- **Panel en el issue de Jira** (Custom UI + `@forge/bridge`): muestra título, estado, número de
  mensajes y los últimos 5 del hilo vinculado. **Solo lectura**: el enlace "Abrir en Buzón" lleva a
  la PWA del dueño, donde se decide el cierre con su sesión. Vincula el issue con un `hilo_id`.
- **Página de administración** (UI Kit vigente, `@forge/react` 12 con `render: native`): el admin
  del sitio pega una vez su token `bz_…`; se guarda con `kvs.setSecret` (`@forge/kvs`, por
  instalación, scope `storage:app`) y nunca se devuelve al front.

## Seguridad

- **Resolvers separados**: `src/panel-entry.js` expone solo `hiloResumen`, `vincularHilo`,
  `desvincularHilo`; `src/admin-entry.js` expone solo `guardarToken`, `probarToken`. El panel no
  puede tocar el token. Las pruebas fijan ambas superficies.
- **Rol admin en el servidor**: `guardarToken` y `probarToken` verifican el permiso global
  `ADMINISTER` del usuario que llama (`GET /rest/api/3/mypermissions?permissions=ADMINISTER`,
  asUser) antes de cualquier otra validación.
- **`vincularHilo`/`desvincularHilo` exigen `EDIT_ISSUES`** del usuario que llama sobre ese issue
  (`mypermissions?issueKey=…&permissions=EDIT_ISSUES`, asUser).
- **Pertenencia hilo↔buzón**: antes de guardar el vínculo (y al mostrar el resumen) se llama
  `leer` del MCP con el token de la instalación; si el hilo no pertenece a ese buzón, la operación
  falla y no se guarda nada.
- La propiedad `buzon_hilo_id` del issue la escribe/lee la app (`asApp`) con
  `api.asApp().requestJira(route`…`)`; el permiso del usuario se verifica aparte (asUser).
- Egreso externo declarado solo a `buzon-ias-mcp.vercel.app`. El token jamás aparece en respuestas.

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
npm test            # node --test test/*.test.js — 26 pruebas con fetch/almacenamiento simulados
npm run build:panel # esbuild: compila static/panel/src con @forge/bridge real a static/panel/build/
```

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
