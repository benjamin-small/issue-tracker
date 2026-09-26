import type { Db } from '@tracker/db';
import { newId } from '@tracker/schema';
import { type Clock, systemClock } from '../context.ts';
import type { EventTailer } from '../events/tailer.ts';
import {
  deliverDueWebhooks,
  dispatchWebhookEvents,
  type WebhookPolicy,
} from '../services/webhooks.ts';

export interface WebhookRunnerOptions {
  policy: WebhookPolicy;
  clock?: Clock;
  /** Fallback poll interval for due retries (new events wake the runner through the tailer). */
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * Background webhook processing for a server process: turns new events into deliveries and sends due ones.
 * Woken by the event tailer on new events and by a timer for retries. Several replicas can run it at once —
 * dispatch runs under the write lock and deliveries are claimed with leases.
 */
export class WebhookRunner {
  readonly #db: Db;
  readonly #options: WebhookRunnerOptions;
  #timer: ReturnType<typeof setInterval> | undefined;
  #unsubscribe: (() => void) | undefined;
  #running: Promise<void> | undefined;
  #again = false;
  #stopped = false;

  constructor(db: Db, options: WebhookRunnerOptions) {
    this.#db = db;
    this.#options = options;
  }

  start(tailer?: EventTailer): void {
    this.#stopped = false;
    this.#unsubscribe = tailer?.subscribe(() => this.wake());
    this.#timer = setInterval(() => this.wake(), this.#options.intervalMs ?? 5_000);
    this.#timer.unref?.();
    this.wake();
  }

  /** Runs a round now (coalescing with one in progress). */
  wake(): void {
    if (this.#stopped) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#running = this.runOnce()
      .catch((error: unknown) => this.#options.onError?.(error))
      .finally(() => {
        this.#running = undefined;
        if (this.#again) {
          this.#again = false;
          this.wake();
        }
      });
  }

  /** Dispatches new events, then sends due deliveries until none are left. */
  async runOnce(): Promise<void> {
    const ctx = { db: this.#db, clock: this.#options.clock ?? systemClock, ids: newId };
    await dispatchWebhookEvents(ctx);
    while (!this.#stopped && (await deliverDueWebhooks(ctx, { policy: this.#options.policy })) > 0);
  }

  /** Stops scheduling and waits for the round in progress. */
  async stop(): Promise<void> {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#unsubscribe?.();
    await this.#running;
  }
}
