import type { Db } from '@tracker/db';
import { type EntityKind, newId } from '@tracker/schema';

/** The authenticated principal performing an operation. Humans and agents are both actors. */
export interface Actor {
  id: string;
  handle: string;
  name: string;
  kind: 'human' | 'agent' | 'system';
  role: 'admin' | 'member';
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  (kind: EntityKind): string;
}

/**
 * Everything a service needs, passed explicitly (no globals). Transports build one per request:
 * the HTTP server from the authenticated request, the CLI's local mode from its trusted actor,
 * tests with a fixed clock and deterministic ids.
 */
export interface ServiceContext {
  db: Db;
  actor: Actor;
  clock: Clock;
  ids: IdGenerator;
  /** Correlates events with the request that caused them (echoed in event payloads). */
  requestId?: string;
}

export const systemClock: Clock = { now: () => new Date() };

export const SYSTEM_ACTOR: Actor = {
  id: 'usr_system',
  handle: 'system',
  name: 'System',
  kind: 'system',
  role: 'admin',
};

export function createContext(
  db: Db,
  actor: Actor,
  overrides: Partial<Omit<ServiceContext, 'db' | 'actor'>> = {},
): ServiceContext {
  return { db, actor, clock: systemClock, ids: newId, ...overrides };
}

/** Returns a copy of the context acting as a different actor. */
export function withActor(ctx: ServiceContext, actor: Actor): ServiceContext {
  return { ...ctx, actor };
}

export function nowIso(ctx: Pick<ServiceContext, 'clock'>): string {
  return ctx.clock.now().toISOString();
}
