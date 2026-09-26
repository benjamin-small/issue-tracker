import type { ServiceContext } from './context.ts';
import { forbidden } from './errors.ts';

export function requireAdmin(ctx: ServiceContext, action = 'do this'): void {
  if (ctx.actor.role !== 'admin') throw forbidden(`Only admins can ${action}`);
}

export function isAdmin(ctx: ServiceContext): boolean {
  return ctx.actor.role === 'admin';
}
