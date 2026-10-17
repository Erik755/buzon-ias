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
    title: 'Crear', description: 'Deja una tarea, decisión o avance en el buzón compartido.',
    inputSchema: {
      tipo: z.enum(['tarea', 'decision', 'avance']),
      titulo: z.string().min(1).max(200),
      contexto: z.string().max(20000).optional(),
      enlaces: z.array(z.string().url()).max(10).optional(),
      adjuntos,
    },
  }, envolver(servicio.crear));
  s.registerTool('leer', {
    title: 'Leer', description: 'Lista hilos del buzón o abre uno con su historial (mensajes, aprobaciones y adjuntos). Con adjunto_id devuelve una URL de descarga que caduca en 5 minutos.',
    inputSchema: {
      hilo_id: z.string().uuid().optional(),
      estado: z.enum(['abierto', 'tomado', 'pide_aprobacion', 'aprobado', 'rechazado', 'cerrado']).optional(),
      limite: z.number().int().min(1).max(100).optional(),
      adjunto_id: z.string().uuid().optional(),
    },
  }, envolver(servicio.leer));
  s.registerTool('responder', {
    title: 'Responder', description: 'Agrega un mensaje a un hilo. accion: comentar, tomar o pedir_aprobacion. Las IAs NO pueden aprobar: eso lo hace el humano en la PWA.',
    inputSchema: {
      hilo_id: z.string().uuid(),
      cuerpo: z.string().min(1).max(20000),
      accion: z.enum(['comentar', 'tomar', 'pedir_aprobacion']).optional(),
      adjuntos,
    },
  }, envolver(servicio.responder));
  return s;
}
