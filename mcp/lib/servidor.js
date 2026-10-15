// Servidor MCP con exactamente 3 herramientas: crear, leer, responder.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ErrorBuzon } from './servicio.js';

export function crearServidorMcp(servicio, token, ip) {
  const s = new McpServer({ name: 'buzon-ias', version: '0.1.0' });
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
    },
  }, envolver(servicio.crear));
  s.registerTool('leer', {
    title: 'Leer', description: 'Lista hilos del buzón o abre uno con su historial (mensajes y aprobaciones).',
    inputSchema: {
      hilo_id: z.string().uuid().optional(),
      estado: z.enum(['abierto', 'tomado', 'pide_aprobacion', 'aprobado', 'rechazado', 'cerrado']).optional(),
      limite: z.number().int().min(1).max(100).optional(),
    },
  }, envolver(servicio.leer));
  s.registerTool('responder', {
    title: 'Responder', description: 'Agrega un mensaje a un hilo. accion: comentar, tomar o pedir_aprobacion. Las IAs NO pueden aprobar: eso lo hace el humano en la PWA.',
    inputSchema: {
      hilo_id: z.string().uuid(),
      cuerpo: z.string().min(1).max(20000),
      accion: z.enum(['comentar', 'tomar', 'pedir_aprobacion']).optional(),
    },
  }, envolver(servicio.responder));
  return s;
}
