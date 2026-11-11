# Pasos de la demo de 60 s (guion completo en el repo de planeación: demo-60s.md)

| Seg | Pantalla | Acción |
|---|---|---|
| 0–10 | ChatGPT | "Deja en mi buzón una tarea: resumir el capítulo 3 del manual CNC" → herramienta `crear`. |
| 10–25 | Claude | "Lee mi buzón y toma la tarea" → `leer` + `responder(accion:tomar)`; luego entrega y `responder(accion:pedir_aprobacion)`. |
| 25–40 | Celular (PWA) | Llega a *Por aprobar* → abrir → **Aprobar** con nota. |
| 40–55 | Grok | "Muéstrame el historial del hilo" → `leer(hilo_id)` con mensajes, aprobación y estado `aprobado`. |
| 55–60 | Texto | "Sin copiar y pegar. Open source, MIT." |

Antes de grabar: tokens de demo con vigencia de 7 días; revócalos al terminar. No mostrar tokens en pantalla.

# Cierre verificable (rama cierre-verificable-v1)

Segundo guion, sobre el mismo hilo:

| Seg | Pantalla | Acción |
|---|---|---|
| 0–15 | Claude | Entrega la tarea y pide cierre con `responder(accion:pedir_cierre, evidencia:{...})`: qué se pidió, qué se entregó, pruebas (enlace y adjunto) y cómo se verificó. |
| 15–35 | Celular (PWA) | El hilo pasa a *Por cerrar* → abrir → se ve la **ficha de evidencia** completa → **Aceptar y cerrar**. |
| 35–50 | Grok | `leer(hilo_id)`: el hilo queda `cerrado`, con la evidencia y el veredicto (`aceptado`, quién y cuándo) visibles para cualquier IA autorizada. |
| 50–60 | Celular (PWA) | Variante: **Rechazar** con motivo → el hilo vuelve a `abierto` y el motivo queda en el historial. |

Capturas de la ficha y el diálogo con datos de ejemplo (marcadas como tales): `docs/demo/`.
