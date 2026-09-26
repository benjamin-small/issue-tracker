import { type Tx, toJson } from '@tracker/db';
import type { EventType } from '@tracker/schema';
import { nowIso, type ServiceContext } from './context.ts';

export interface RecordEventInput {
  projectId?: string | null;
  issueId?: string | null;
  data: Record<string, unknown>;
}

/**
 * Appends to the event log inside the caller's write transaction (ADR 0004). The row commits
 * atomically with the change it describes; consumers (SSE, webhooks, activity, agents) read it later.
 */
export async function recordEvent(
  tx: Tx,
  ctx: ServiceContext,
  type: EventType,
  input: RecordEventInput,
): Promise<void> {
  const data = ctx.requestId ? { ...input.data, requestId: ctx.requestId } : input.data;
  await tx
    .insertInto('events')
    .values({
      id: ctx.ids('event'),
      type,
      actor_id: ctx.actor.id,
      project_id: input.projectId ?? null,
      issue_id: input.issueId ?? null,
      data: toJson(data),
      created_at: nowIso(ctx),
    })
    .execute();
}

/** Computes `{ field: { from, to } }` for fields whose JSON representation changed. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes[field] = { from: before[field], to: after[field] };
    }
  }
  return changes;
}
