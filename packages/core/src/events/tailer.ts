import type { Db } from '@tracker/db';
import type { TrackerEvent } from '@tracker/schema';
import type { ServiceContext } from '../context.ts';
import { EVENTS_CHANNEL } from '../events.ts';
import { latestEventSeq, listEvents } from '../services/events.ts';

export type EventListener = (event: TrackerEvent) => void;

export interface EventTailerOptions {
  /** Poll interval when nothing wakes the tailer (catches writes from other processes on SQLite). */
  intervalMs?: number;
  /** Max events read per poll. */
  batchSize?: number;
}

/**
 * Follows the event log (ADR 0004) and fans new events out to in-process subscribers (SSE connections, the
 * webhook dispatcher). One per server process.
 *
 * It wakes on local commits (`Db.onCommit`), on Postgres `NOTIFY` from any process, and on a poll interval —
 * so writes made by the CLI in local mode or by other replicas are delivered too. Because `seq` values become
 * visible in increasing order (ADR 0003), reading `seq > last` never skips an event.
 */
export class EventTailer {
  readonly #db: Db;
  readonly #intervalMs: number;
  readonly #batchSize: number;
  readonly #listeners = new Set<EventListener>();
  #last = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #polling: Promise<void> | undefined;
  #again = false;
  #unsubscribe: Array<() => unknown> = [];

  constructor(db: Db, options: EventTailerOptions = {}) {
    this.#db = db;
    this.#intervalMs = options.intervalMs ?? 300;
    this.#batchSize = options.batchSize ?? 500;
  }

  /** Sequence number of the last event delivered (events after it are "new"). */
  get lastSeq(): number {
    return this.#last;
  }

  /** Starts following from the current end of the log (or `fromSeq`). */
  async start(fromSeq?: number): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#last = fromSeq ?? (await latestEventSeq({ db: this.#db }));
    this.#unsubscribe.push(this.#db.onCommit(() => this.wake()));
    this.#unsubscribe.push(await this.#db.listen(EVENTS_CHANNEL, () => this.wake()));
    this.#schedule();
  }

  async stop(): Promise<void> {
    this.#running = false;
    clearTimeout(this.#timer);
    for (const off of this.#unsubscribe.splice(0)) await off();
    await this.#polling;
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Polls now (coalesced with a poll already in flight). */
  wake(): void {
    if (!this.#running) return;
    if (this.#polling) {
      this.#again = true;
      return;
    }
    clearTimeout(this.#timer);
    this.#polling = this.#poll().finally(() => {
      this.#polling = undefined;
      if (this.#again) {
        this.#again = false;
        this.wake();
      } else this.#schedule();
    });
  }

  #schedule() {
    if (!this.#running) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.wake(), this.#intervalMs);
    this.#timer.unref?.();
  }

  async #poll(): Promise<void> {
    const ctx = { db: this.#db } as ServiceContext;
    for (;;) {
      let page;
      try {
        page = await listEvents(ctx, { after: this.#last, limit: this.#batchSize });
      } catch {
        return; // transient (e.g. database restarting); the next poll retries
      }
      for (const event of page.data) {
        this.#last = event.seq;
        for (const listener of this.#listeners) {
          try {
            listener(event);
          } catch {
            // a failing subscriber must not affect others
          }
        }
      }
      if (!page.nextCursor || !this.#running) return;
    }
  }
}
