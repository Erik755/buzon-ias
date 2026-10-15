// Lógica de las 3 acciones. Independiente del transporte para poder probarla.
import { hashToken } from './token.js';

export const LIMITE_POR_MINUTO = 60;
export class ErrorBuzon extends Error { constructor(codigo, msg) { super(msg); this.codigo = codigo; } }

export function crearServicio(repo, { limite = LIMITE_POR_MINUTO } = {}) {
  async function autorizar(token, alcance, ip) {
    if (!token) throw new ErrorBuzon(401, 'Falta token Bearer bz_...');
    const ctx = await repo.validarToken(hashToken(token), alcance);
    if (!ctx) throw new ErrorBuzon(403, 'Token inválido, vencido, revocado o sin el alcance "' + alcance + '"');
    if ((await repo.llamadasUltimoMinuto(ctx.agente_id)) >= limite) throw new ErrorBuzon(429, 'Límite de ' + limite + ' llamadas por minuto');
    return { ...ctx, ip };
  }
  const audit = (ctx, accion, objeto_id) =>
    repo.auditar({ buzon_id: ctx.buzon_id, actor: 'agente:' + ctx.agente_id, accion, objeto_id, ip: ctx.ip ?? null });

  return {
    async crear(token, { tipo, titulo, contexto, enlaces = [] }, ip) {
      const ctx = await autorizar(token, 'crear', ip);
      const cuerpo = [contexto, ...enlaces.map((e) => '🔗 ' + e)].filter(Boolean).join('\n');
      const hilo = await repo.crearHilo({ buzon_id: ctx.buzon_id, tipo, titulo, contexto: cuerpo || null, creado_por_agente: ctx.agente_id });
      await audit(ctx, 'crear', hilo.id);
      return { id: hilo.id, estado: hilo.estado, creado_por: ctx.agente_nombre };
    },
    async leer(token, { hilo_id, estado, limite = 20 }, ip) {
      const ctx = await autorizar(token, 'leer', ip);
      if (!hilo_id) {
        const hilos = await repo.listarHilos(ctx.buzon_id, { estado, limite: Math.min(limite, 100) });
        await audit(ctx, 'leer:lista', null);
        return { hilos };
      }
      const hilo = await repo.obtenerHilo(ctx.buzon_id, hilo_id);
      if (!hilo) throw new ErrorBuzon(404, 'Hilo no encontrado en tu buzón');
      const [mensajes, aprobaciones] = await Promise.all([repo.mensajes(hilo.id), repo.aprobaciones(hilo.id)]);
      await audit(ctx, 'leer:hilo', hilo.id);
      return { hilo, mensajes, aprobaciones };
    },
    async responder(token, { hilo_id, cuerpo, accion = 'comentar' }, ip) {
      const ctx = await autorizar(token, 'responder', ip);
      const hilo = await repo.obtenerHilo(ctx.buzon_id, hilo_id);
      if (!hilo) throw new ErrorBuzon(404, 'Hilo no encontrado en tu buzón');
      if (['aprobado', 'rechazado', 'cerrado'].includes(hilo.estado) && accion !== 'comentar')
        throw new ErrorBuzon(409, 'El hilo ya está ' + hilo.estado);
      const msg = await repo.insertarMensaje({ hilo_id: hilo.id, autor_agente: ctx.agente_id, cuerpo });
      let estado = hilo.estado;
      if (accion === 'tomar') estado = (await repo.cambiarEstado(ctx.buzon_id, hilo.id, { estado: 'tomado', tomado_por_agente: ctx.agente_id })).estado;
      if (accion === 'pedir_aprobacion') estado = (await repo.cambiarEstado(ctx.buzon_id, hilo.id, { estado: 'pide_aprobacion' })).estado;
      await audit(ctx, 'responder:' + accion, hilo.id);
      return { mensaje_id: msg.id, estado };
    },
  };
}
