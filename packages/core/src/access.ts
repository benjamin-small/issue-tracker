import { type Database, type Kysely, type RawBuilder, sql } from '@poietic-tech/issues-db';
import type { ServiceContext } from './context.ts';
import { DomainError, forbidden, notFound } from './errors.ts';

type Exec = Kysely<Database>;

/** Access an actor has to one project (ADR 0021). Ordered: each level includes the ones before it. */
export type AccessLevel = 'none' | 'read' | 'write' | 'manage';
const ORDER: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, manage: 3 };
const ROLE_LEVEL = { viewer: 'read', editor: 'write', manager: 'manage' } as const;

export function atLeast(have: AccessLevel, need: AccessLevel): boolean {
  return ORDER[have] >= ORDER[need];
}

function unrestricted(ctx: ServiceContext): boolean {
  return ctx.actor.role === 'admin' || ctx.actor.kind === 'system';
}

export async function projectLevel(
  ctx: ServiceContext,
  db: Exec,
  project: { id: string; visibility: 'public' | 'private' },
): Promise<AccessLevel> {
  if (unrestricted(ctx)) return 'manage';
  const floor: AccessLevel = project.visibility === 'public' ? 'read' : 'none';
  if (ctx.actor.kind === 'anonymous') return floor;
  const member = await db
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', project.id)
    .where('user_id', '=', ctx.actor.id)
    .executeTakeFirst();
  const fromRole: AccessLevel = member ? ROLE_LEVEL[member.role] : 'none';
  return atLeast(fromRole, floor) ? fromRole : floor;
}

/**
 * Throws unless `have` reaches `need`. Below read, the resource is reported as not found, so private
 * projects don't reveal that they exist. Anonymous actors asking for more than read get UNAUTHENTICATED.
 */
export function requireLevel(
  ctx: ServiceContext,
  have: AccessLevel,
  need: Exclude<AccessLevel, 'none'>,
  what: string,
  ref: string,
): void {
  if (atLeast(have, need)) return;
  if (have === 'none') throw notFound(what, ref);
  if (ctx.actor.kind === 'anonymous')
    throw new DomainError('UNAUTHENTICATED', 'Sign in to make changes');
  throw forbidden(
    need === 'manage'
      ? 'Only project managers can do this'
      : 'You have read-only access to this project',
  );
}

/** Ids of projects the actor can read, or `'all'` for admins and the system actor. */
export async function readableProjectIds(ctx: ServiceContext, db: Exec): Promise<'all' | string[]> {
  if (unrestricted(ctx)) return 'all';
  let q = db.selectFrom('projects').select('id').where('visibility', '=', 'public');
  if (ctx.actor.kind !== 'anonymous') {
    const actorId = ctx.actor.id;
    q = db
      .selectFrom('projects')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('visibility', '=', 'public'),
          eb(
            'id',
            'in',
            eb.selectFrom('project_members').select('project_id').where('user_id', '=', actorId),
          ),
        ]),
      );
  }
  return (await q.execute()).map((r) => r.id);
}

/**
 * Adds "the project id in `column` is readable" to a query (e.g. `'i.project_id'`). Admins and the system
 * actor are unrestricted; an actor who can read nothing gets no rows.
 */
export async function whereReadable<QB extends { where(expr: RawBuilder<boolean>): QB }>(
  ctx: ServiceContext,
  db: Exec,
  qb: QB,
  column: string,
): Promise<QB> {
  const readable = await readableProjectIds(ctx, db);
  if (readable === 'all') return qb;
  return qb.where(
    readable.length
      ? sql<boolean>`${sql.ref(column)} in (${sql.join(readable.map((id) => sql`${id}`))})`
      : sql<boolean>`1 = 0`,
  );
}
