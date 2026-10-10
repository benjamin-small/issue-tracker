import { type Database, type Kysely, type RawBuilder, sql } from '@poietic-tech/issues-db';
import type { ServiceContext } from './context.ts';
import { DomainError, forbidden, notFound } from './errors.ts';

type Exec = Kysely<Database>;

/** Access an actor has to one project (ADR 0021). Ordered: each level includes the ones before it. */
export type AccessLevel = 'none' | 'read' | 'write' | 'manage';
const ORDER: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, manage: 3 };
const ROLE_LEVEL = { viewer: 'read', editor: 'write', manager: 'manage' } as const;
type Role = keyof typeof ROLE_LEVEL;
/** Roles that grant at least `write` (the public floor is only `read`). */
const WRITE_ROLES = (Object.keys(ROLE_LEVEL) as Role[]).filter(
  (r) => ORDER[ROLE_LEVEL[r]] >= ORDER.write,
);

export function atLeast(have: AccessLevel, need: AccessLevel): boolean {
  return ORDER[have] >= ORDER[need];
}

/** Admins and the system actor: every project at `manage`. */
export function unrestricted(ctx: ServiceContext): boolean {
  return ctx.actor.role === 'admin' || ctx.actor.kind === 'system';
}

type Visibility = 'public' | 'private';

/** A non-admin's level: the higher of their role's level and the public floor. */
function levelOf(visibility: Visibility, role: Role | undefined): AccessLevel {
  const floor: AccessLevel = visibility === 'public' ? 'read' : 'none';
  const fromRole: AccessLevel = role ? ROLE_LEVEL[role] : 'none';
  return atLeast(fromRole, floor) ? fromRole : floor;
}

export async function projectLevel(
  ctx: ServiceContext,
  db: Exec,
  project: { id: string; visibility: Visibility },
): Promise<AccessLevel> {
  if (unrestricted(ctx)) return 'manage';
  if (ctx.actor.kind === 'anonymous') return levelOf(project.visibility, undefined);
  const member = await db
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', project.id)
    .where('user_id', '=', ctx.actor.id)
    .executeTakeFirst();
  return levelOf(project.visibility, member?.role);
}

/** `projectLevel` for many projects, from one membership query. Keyed by project id. */
export async function projectLevels(
  ctx: ServiceContext,
  db: Exec,
  projects: ReadonlyArray<{ id: string; visibility: Visibility }>,
): Promise<Map<string, AccessLevel>> {
  if (unrestricted(ctx)) return new Map(projects.map((p) => [p.id, 'manage']));
  const roles = new Map<string, Role>();
  if (ctx.actor.kind !== 'anonymous' && projects.length) {
    const rows = await db
      .selectFrom('project_members')
      .select(['project_id', 'role'])
      .where('user_id', '=', ctx.actor.id)
      .execute();
    for (const r of rows) roles.set(r.project_id, r.role);
  }
  return new Map(projects.map((p) => [p.id, levelOf(p.visibility, roles.get(p.id))]));
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
  const actor = ctx.actor;
  const rows = await db
    .selectFrom('projects')
    .select('id')
    .where((eb) =>
      actor.kind === 'anonymous'
        ? eb('visibility', '=', 'public')
        : eb.or([
            eb('visibility', '=', 'public'),
            eb(
              'id',
              'in',
              eb.selectFrom('project_members').select('project_id').where('user_id', '=', actor.id),
            ),
          ]),
    )
    .execute();
  return rows.map((r) => r.id);
}

/**
 * Ids of projects the actor can write in, or `'all'` for admins and the system actor. Only a membership grants
 * write, so anonymous actors get none. Used to show soft-deleted content, which needs write.
 */
export async function writableProjectIds(ctx: ServiceContext, db: Exec): Promise<'all' | string[]> {
  if (unrestricted(ctx)) return 'all';
  if (ctx.actor.kind === 'anonymous') return [];
  const rows = await db
    .selectFrom('project_members')
    .select('project_id')
    .where('user_id', '=', ctx.actor.id)
    .where('role', 'in', WRITE_ROLES)
    .execute();
  return rows.map((r) => r.project_id);
}

/**
 * Adds "the project id in `column` is readable" to a query (e.g. `'i.project_id'`). Admins and the system
 * actor are unrestricted; an actor who can read nothing gets no rows. Pass `known` to reuse a
 * `readableProjectIds` result.
 */
export async function whereReadable<QB extends { where(expr: RawBuilder<boolean>): QB }>(
  ctx: ServiceContext,
  db: Exec,
  qb: QB,
  column: string,
  known?: 'all' | string[],
): Promise<QB> {
  const readable = known ?? (await readableProjectIds(ctx, db));
  if (readable === 'all') return qb;
  return qb.where(
    readable.length
      ? sql<boolean>`${sql.ref(column)} in (${sql.join(readable.map((id) => sql`${id}`))})`
      : sql<boolean>`1 = 0`,
  );
}
