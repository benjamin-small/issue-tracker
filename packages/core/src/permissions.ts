import { isAnonymous, type ServiceContext } from './context.ts';
import { DomainError, forbidden } from './errors.ts';

export function requireAdmin(ctx: ServiceContext, action = 'do this'): void {
  if (ctx.actor.role !== 'admin') throw forbidden(`Only admins can ${action}`);
}

export function isAdmin(ctx: ServiceContext): boolean {
  return ctx.actor.role === 'admin';
}

/** Rejects the anonymous actor before anything is looked up, so the answer reveals nothing (ADR 0021). */
export function requireSignedIn(ctx: ServiceContext, action = 'do this'): void {
  if (isAnonymous(ctx)) throw new DomainError('UNAUTHENTICATED', `Sign in to ${action}`);
}
