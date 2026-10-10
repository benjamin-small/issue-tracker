import { fromJson, sql, type Tx } from '@poietic-tech/issues-db';
import type { EventType, Page, TrackerEvent } from '@poietic-tech/issues-schema';
import { readableProjectIds } from '../access.ts';
import { isAnonymous, type ServiceContext } from '../context.ts';
import { validationError } from '../errors.ts';
import { isAdmin } from '../permissions.ts';

export interface ListEventsInput {
  /** Only events with `seq` greater than this (exclusive cursor). */
  after?: number | undefined;
  limit?: number | undefined;
  project?: string | undefined;
  issue?: string | undefined;
  types?: EventType[] | undefined;
  /** With `issue`: also include link events where the issue is the target. */
  includeLinksTo?: boolean | undefined;
}

function eventQuery(db: Tx) {
  return db
    .selectFrom('events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_id')
    .selectAll('e')
    .select([
      'u.handle as u_handle',
      'u.name as u_name',
      'u.kind as u_kind',
      'u.avatar_url as u_avatar',
    ]);
}

type EventRow = Awaited<ReturnType<ReturnType<typeof eventQuery>['execute']>>[number];

function toTrackerEvent(r: EventRow): TrackerEvent {
  return {
    seq: Number(r.seq),
    id: r.id,
    type: r.type as EventType,
    actorId: r.actor_id,
    actor:
      r.actor_id && r.u_handle
        ? {
            id: r.actor_id,
            handle: r.u_handle,
            name: r.u_name!,
            kind: r.u_kind!,
            avatarUrl: r.u_avatar,
          }
        : null,
    projectId: r.project_id,
    issueId: r.issue_id,
    data: fromJson<Record<string, unknown>>(r.data, {}),
    createdAt: r.created_at,
  };
}

/**
 * Hides other users' emails in `user.*` events from non-admins, matching `listUsers`. Events are shared by
 * everyone who can see them, so the log must not reveal what the user list withholds.
 */
export function redactEventForViewer(
  ctx: Pick<ServiceContext, 'actor'>,
  event: TrackerEvent,
): TrackerEvent {
  if (!event.type.startsWith('user.') || isAdmin(ctx)) return event;
  const user = event.data.user as { id?: string } | undefined;
  if (!user || user.id === ctx.actor.id) return event;
  const { email: _hidden, ...changes } = (event.data.changes ?? {}) as Record<string, unknown>;
  return {
    ...event,
    data: {
      ...event.data,
      user: { ...user, email: null },
      ...(event.data.changes !== undefined && { changes }),
    },
  };
}

/**
 * Redacts events for the viewer (`redactEventForViewer`) and drops a `user.updated` whose only change was the
 * email they cannot see: it would reach them as `changes: {}`.
 */
function forViewer(ctx: Pick<ServiceContext, 'actor'>, events: TrackerEvent[]): TrackerEvent[] {
  return events.flatMap((e) => {
    const r = redactEventForViewer(ctx, e);
    const emptied =
      r.type === 'user.updated' &&
      Object.keys((r.data.changes ?? {}) as object).length === 0 &&
      Object.keys((e.data.changes ?? {}) as object).length > 0;
    return emptied ? [] : [r];
  });
}

/** Ids of the two issues a `link.*` event connects. */
function linkEnds(event: TrackerEvent): string[] {
  const link = event.data.link as
    { source?: { id?: string }; target?: { id?: string } } | undefined;
  return [link?.source?.id, link?.target?.id].filter((id): id is string => typeof id === 'string');
}

/**
 * Link events name both issues, so they are hidden when either end is in a project the actor cannot read.
 * A link event whose two ends cannot both be resolved is hidden too (fails closed on malformed data).
 */
async function dropUnreadableLinks(
  db: Tx,
  events: TrackerEvent[],
  readable: string[],
): Promise<TrackerEvent[]> {
  const linkEvents = events.filter((e) => e.type.startsWith('link.'));
  if (linkEvents.length === 0) return events;
  const ids = [...new Set(linkEvents.flatMap(linkEnds))];
  const rows = ids.length
    ? await db.selectFrom('issues').select(['id', 'project_id']).where('id', 'in', ids).execute()
    : [];
  const ok = new Set(rows.filter((r) => readable.includes(r.project_id)).map((r) => r.id));
  return events.filter((e) => {
    if (!e.type.startsWith('link.')) return true;
    const ends = linkEnds(e);
    return ends.length === 2 && ends.every((id) => ok.has(id));
  });
}

/**
 * Applies `listEvents`' per-viewer rules to events read some other way (the live stream reads every event as
 * the system actor and fans it out): only readable projects, project-less (`user.*`) events only for signed-in
 * viewers, link events only when both issues are readable, and user events redacted. Pass `readable` to reuse
 * a `readableProjectIds` result.
 */
export async function filterEventsForViewer(
  ctx: ServiceContext,
  events: TrackerEvent[],
  readable?: 'all' | string[],
): Promise<TrackerEvent[]> {
  const access = readable ?? (await readableProjectIds(ctx, ctx.db.kysely));
  const redacted = (list: TrackerEvent[]) => forViewer(ctx, list);
  if (access === 'all') return redacted(events);
  const signedIn = !isAnonymous(ctx);
  const visible = events.filter((e) =>
    e.projectId === null ? signedIn : access.includes(e.projectId),
  );
  return dropUnreadableLinks(ctx.db.kysely, redacted(visible), access);
}

/** Loads events by seq (in seq order); missing seqs are skipped. */
export async function getEventsBySeq(db: Tx, seqs: number[]): Promise<TrackerEvent[]> {
  if (seqs.length === 0) return [];
  const rows = await eventQuery(db).where('e.seq', 'in', seqs).orderBy('e.seq').execute();
  return rows.map(toTrackerEvent);
}

/**
 * Reads the event log in commit order. `seq` increases in commit order (ADR 0003), so polling
 * `after=<last seq seen>` never misses an event. `nextCursor` is the last seq as a string.
 */
export async function listEvents(
  ctx: ServiceContext,
  input: ListEventsInput = {},
): Promise<Page<TrackerEvent>> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
  if (input.after !== undefined && (!Number.isInteger(input.after) || input.after < 0))
    throw validationError('after must be a non-negative integer');
  let q = eventQuery(ctx.db.kysely)
    .orderBy('e.seq')
    .limit(limit + 1);
  if (input.after !== undefined) q = q.where('e.seq', '>', input.after);
  const readable = await readableProjectIds(ctx, ctx.db.kysely);
  if (readable !== 'all') {
    const signedIn = !isAnonymous(ctx);
    q = q.where((eb) => {
      const visible = [];
      if (readable.length) visible.push(eb('e.project_id', 'in', readable));
      if (signedIn) visible.push(eb('e.project_id', 'is', null)); // user.* events
      return visible.length ? eb.or(visible) : sql<boolean>`1 = 0`;
    });
  }
  if (input.project) q = q.where('e.project_id', '=', input.project);
  if (input.types?.length) q = q.where('e.type', 'in', input.types);
  if (input.issue) {
    const issueId = input.issue;
    q = input.includeLinksTo
      ? q.where((eb) =>
          eb.or([
            eb('e.issue_id', '=', issueId),
            eb.and([
              eb('e.type', 'in', ['link.created', 'link.deleted']),
              eb(sql`cast(e.data as text)`, 'like', `%"${issueId}"%`),
            ]),
          ]),
        )
      : q.where('e.issue_id', '=', issueId);
  }
  const rows = await q.execute();
  const page = rows.slice(0, limit);
  const events = forViewer(ctx, page.map(toTrackerEvent));
  return {
    data: readable === 'all' ? events : await dropUnreadableLinks(ctx.db.kysely, events, readable),
    nextCursor: rows.length > limit ? String(page.at(-1)!.seq) : null,
  };
}

/** Highest committed event seq (0 when the log is empty). */
export async function latestEventSeq(ctx: Pick<ServiceContext, 'db'>): Promise<number> {
  const row = await ctx.db.kysely
    .selectFrom('events')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .executeTakeFirst();
  return Number(row?.seq ?? 0);
}
