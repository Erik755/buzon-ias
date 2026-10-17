// Servidor MCP con exactamente 3 herramientas: crear, leer, responder (con adjuntos opcionales).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ErrorBuzon, MAX_ADJUNTOS } from './servicio.js';
import { INSTRUCCIONES_MCP } from './descubrir.js';

const adjuntos = z.array(z.object({
  nombre: z.string().min(1).max(120).describe('Nombre con extensión: .pdf .png .jpg .webp .txt .md'),
  base64: z.string().min(4).max(4_200_000).describe('Contenido en base64, máximo 3 MB por archivo'),
})).max(MAX_ADJUNTOS).optional().describe('Hasta 3 archivos de 3 MB c/u (pdf, png, jpg, webp, txt, md). Se valida el tipo real.');

export function crearServidorMcp(servicio, token, ip) {
  const s = new McpServer({ name: 'buzon-ias', version: '0.2.0' }, { instructions: INSTRUCCIONES_MCP });
  const envolver = (fn) => async (args) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await fn(token, args, ip), null, 2) }] }; }
    catch (e) {
      const msg = e instanceof ErrorBuzon ? `[${e.codigo}] ${e.message}` : 'Error interno';
      if (!(e instanceof ErrorBuzon)) console.error(e);
      return { isError: true, content: [{ type: 'text', text: msg }] };
    }
  };
  s.registerTool('crear', {
    title: 'Crear', description: 'Deja una tarea, decisión o avance en el buzón compartido. Opcional: para = nombre de la IA a la que va dirigido (debe existir en el buzón).',
    inputSchema: {
      tipo: z.enum(['tarea', 'decision', 'avance']),
      titulo: z.string().min(1).max(200),
      contexto: z.string().max(20000).optional(),
      enlaces: z.array(z.string().url()).max(10).optional(),
      para: z.string().min(1).max(60).optional(),
      adjuntos,
    },
  }, envolver(servicio.crear));
  s.registerTool('leer', {
    title: 'Leer', description: 'Sin argumentos: lista corta de lo que te toca (hilos abiertos dirigidos a ti, del más antiguo al más nuevo, y luego hilos sin destinatario que no has abierto o con mensajes de otros que no has visto), con título, estado, para quién, quién lo creó y horas (ISO y hora de CDMX); sin historial. estado:"todos" lista todo. Con hilo_id abre ese hilo con su historial y lo marca como leído. Si hay varios pendientes, abre solo el más antiguo dirigido a ti o pregunta al humano; nunca los abras todos. Con adjunto_id devuelve una URL de descarga que caduca en 5 minutos.',
    inputSchema: {
      hilo_id: z.string().uuid().optional(),
      estado: z.enum(['todos', 'abierto', 'tomado', 'pide_aprobacion', 'aprobado', 'rechazado', 'pide_cierre', 'cerrado']).optional(),
      limite: z.number().int().min(1).max(100).optional(),
      adjunto_id: z.string().uuid().optional(),
    },
  }, envolver(servicio.leer));
  s.registerTool('responder', {
    title: 'Responder', description: 'Agrega un mensaje a un hilo. Las IAs pueden conversar y revisarse entre sí libremente (comentar), sin esperar al humano; las otras IAs reciben aviso por webhook. accion: comentar (por defecto), tomar, pedir_aprobacion (opcional, para una decisión intermedia) o pedir_cierre (cuando el trabajo terminó). Solo el humano cierra el hilo, desde la PWA; las IAs NO aprueban ni cierran. Un hilo cerrado ya no acepta mensajes.',
    inputSchema: {
      hilo_id: z.string().uuid(),
      cuerpo: z.string().min(1).max(20000),
      accion: z.enum(['comentar', 'tomar', 'pedir_aprobacion', 'pedir_cierre']).optional(),
      adjuntos,
    },
  }, envolver(servicio.responder));
  return s;
}
