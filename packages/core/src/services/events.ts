import { fromJson, sql } from '@tracker/db';
import type { EventType, Page, TrackerEvent } from '@tracker/schema';
import type { ServiceContext } from '../context.ts';
import { validationError } from '../errors.ts';

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
  let q = ctx.db.kysely
    .selectFrom('events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_id')
    .selectAll('e')
    .select([
      'u.handle as u_handle',
      'u.name as u_name',
      'u.kind as u_kind',
      'u.avatar_url as u_avatar',
    ])
    .orderBy('e.seq')
    .limit(limit + 1);
  if (input.after !== undefined) q = q.where('e.seq', '>', input.after);
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
  return {
    data: page.map((r) => ({
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
    })),
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
