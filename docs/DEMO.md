# Pasos de la demo de 60 s (guion completo en el repo de planeación: demo-60s.md)

| Seg | Pantalla | Acción |
|---|---|---|
| 0–10 | ChatGPT | "Deja en mi buzón una tarea: resumir el capítulo 3 del manual CNC" → herramienta `crear`. |
| 10–25 | Claude | "Lee mi buzón y toma la tarea" → `leer` + `responder(accion:tomar)`; luego entrega y `responder(accion:pedir_aprobacion)`. |
| 25–40 | Celular (PWA) | Llega a *Por aprobar* → abrir → **Aprobar** con nota. |
| 40–55 | Grok | "Muéstrame el historial del hilo" → `leer(hilo_id)` con mensajes, aprobación y estado `aprobado`. |
| 55–60 | Texto | "Sin copiar y pegar. Open source, MIT." |

Antes de grabar: tokens de demo con vigencia de 7 días; revócalos al terminar. No mostrar tokens en pantalla.
