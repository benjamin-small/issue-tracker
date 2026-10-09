import { z } from '@hono/zod-openapi';
import {
  type EventTailer,
  filterEventsForViewer,
  getProjectRow,
  listEvents,
  readableProjectIds,
} from '@poietic-tech/issues-core';
import type { TrackerEvent } from '@poietic-tech/issues-schema';
import { streamSSE } from 'hono/streaming';
import type { ResolvedDeps, TrackerApp } from '../env.ts';
import { problem } from '../problem.ts';

const HEARTBEAT_MS = 15_000;
const MAX_REPLAY = 1000;

/** Events after which a viewer's readable projects may differ (membership, visibility, a new project). */
const changesAccess = (e: TrackerEvent) =>
  e.type.startsWith('project.member_') ||
  e.type === 'project.updated' ||
  e.type === 'project.created';

/**
 * `GET /events/stream` — live events as Server-Sent Events.
 *
 * Each message has `id: <seq>`, `event: <type>` and the event JSON as `data`. Browsers reconnect automatically
 * and send `Last-Event-ID`; the server replays what was missed (up to 1000 events — beyond that it sends a
 * `reset` event, telling the client to refetch). Optional `?project=` filters to one project.
 *
 * The tailer fans out every event, so each connection applies its viewer's access (the same rules as
 * `GET /events`): only readable projects, and the readable set is re-read when memberships or a project's
 * visibility change.
 */
export function registerStreamRoute(
  app: TrackerApp,
  deps: ResolvedDeps & { tailer?: EventTailer },
) {
  app.openAPIRegistry.registerPath({
    method: 'get',
    path: '/events/stream',
    tags: ['Events'],
    summary: 'Live event stream (Server-Sent Events)',
    description:
      'Streams events as `text/event-stream`: `id` is the event seq, `event` its type, `data` the Event JSON. ' +
      'Reconnect with `Last-Event-ID` (or `?after=<seq>`) to resume without gaps. A `reset` event means the gap ' +
      'was too large to replay: refetch state. Comment lines are heartbeats.',
    request: {
      query: z.object({
        project: z
          .string()
          .optional()
          .openapi({ description: 'Only events of this project (key or id).' }),
        after: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .openapi({ description: 'Resume after this seq.' }),
      }),
    },
    responses: {
      200: {
        description: 'Event stream',
        content: { 'text/event-stream': { schema: z.string() } },
      },
    },
  });

  app.get('/events/stream', async (c) => {
    const tailer = deps.tailer;
    if (!tailer) return problem(c, 'UNAVAILABLE', 'Live events are not enabled on this server');
    const ctx = c.get('ctx');
    const projectRef = c.req.query('project');
    const projectId = projectRef
      ? (await getProjectRow(ctx, ctx.db.kysely, projectRef, 'read')).id
      : undefined;
    const resumeRaw = c.req.header('last-event-id') ?? c.req.query('after');
    const resume =
      resumeRaw !== undefined && /^\d+$/.test(resumeRaw) ? Number(resumeRaw) : undefined;

    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache');
    return streamSSE(c, async (stream) => {
      const queue: TrackerEvent[] = [];
      let wake: (() => void) | undefined;
      const matches = (e: TrackerEvent) => !projectId || e.projectId === projectId;
      // Subscribe and read the position together, before any await, so nothing committed afterwards is
      // missed (replay and live may overlap; duplicates are dropped by seq).
      const unsubscribe = tailer.subscribe((e) => {
        if (matches(e)) {
          queue.push(e);
          wake?.();
        }
      });
      let last = resume ?? tailer.lastSeq;
      stream.onAbort(unsubscribe);
      // Read access only after subscribing: any change committed after this read is queued, and
      // re-reads it before the events that follow are filtered.
      let readable = await readableProjectIds(ctx, ctx.db.kysely);
      const refresh = async (events: TrackerEvent[]) => {
        if (events.some(changesAccess)) readable = await readableProjectIds(ctx, ctx.db.kysely);
      };
      /** Filters and redacts one live event for this viewer, first catching up on access changes. */
      const visible = async (e: TrackerEvent) => {
        await refresh([e]);
        return filterEventsForViewer(ctx, [e], readable);
      };

      const send = async (e: TrackerEvent) => {
        if (e.seq <= last) return;
        last = e.seq;
        await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) });
      };

      try {
        if (resume !== undefined) {
          const replay = await listEvents(ctx, {
            after: resume,
            limit: MAX_REPLAY,
            project: projectId,
          });
          if (replay.nextCursor) {
            last = tailer.lastSeq;
            await stream.writeSSE({
              id: String(last),
              event: 'reset',
              data: JSON.stringify({ seq: last }),
            });
          } else {
            for (const e of replay.data) await send(e);
          }
          // Replayed events are filtered by listEvents; catch the live filter up on access they changed.
          await refresh(replay.data);
        }
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ seq: last }) });
        const stopping = () => stream.aborted || deps.shutdownSignal?.aborted === true;
        const onShutdown = () => wake?.();
        deps.shutdownSignal?.addEventListener('abort', onShutdown);
        stream.onAbort(() => deps.shutdownSignal?.removeEventListener('abort', onShutdown));
        while (!stopping()) {
          while (queue.length) for (const e of await visible(queue.shift()!)) await send(e);
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, HEARTBEAT_MS);
          });
          wake = undefined;
          if (!queue.length && !stopping()) await stream.write(': heartbeat\n\n');
        }
        if (deps.shutdownSignal?.aborted) {
          // Ask the browser to reconnect soon (to another replica, or this one once restarted).
          await stream.writeSSE({ event: 'shutdown', data: '{}', retry: 1000 });
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
