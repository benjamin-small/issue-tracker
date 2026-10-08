// The whole tracker (API, business rules, SQLite) running inside the browser, for the hosted demo.
import './shims/buffer-global.ts';
import {
  type BlobStore,
  createContext,
  ensureBuiltins,
  EventTailer,
  seedDemoData,
  SYSTEM_ACTOR,
  WebhookRunner,
} from '@poietic-tech/issues-core';
import { createDb, type Db, migrateToLatest } from '@poietic-tech/issues-db';
import { createApp } from '@poietic-tech/issues-server';
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import { configureSqlJs, currentDatabase } from './shims/better-sqlite3.ts';

const STORAGE_KEY = 'tracker-demo-db-v1';

/** Attachment bytes live in memory (and in the saved snapshot's side table below). */
class MemoryBlobStore implements BlobStore {
  readonly kind = 'local' as const;
  readonly #blobs = new Map<string, Uint8Array>();
  async put(key: string, data: Uint8Array) {
    this.#blobs.set(key, data);
  }
  async get(key: string) {
    return this.#blobs.get(key) ?? null;
  }
  async delete(key: string) {
    this.#blobs.delete(key);
  }
  entries() {
    return [...this.#blobs.entries()];
  }
}

function load(): { db?: Uint8Array; blobs?: [string, Uint8Array][] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as { db: string; blobs: [string, string][] };
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return { db: bytes(saved.db), blobs: saved.blobs.map(([k, v]) => [k, bytes(v)]) };
  } catch {
    return {};
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface DemoBackend {
  /** Handles one API request as the given user (null = signed out). */
  fetch(request: Request, handle: string | null): Promise<Response>;
  users(): Promise<Array<{ handle: string }>>;
  reset(): void;
}

export async function startDemoBackend(): Promise<DemoBackend> {
  const saved = load();
  configureSqlJs(await initSqlJs(), saved.db);
  const db: Db = createDb('sqlite::memory:');
  await migrateToLatest(db);
  await ensureBuiltins(db);
  const blobStore = new MemoryBlobStore();
  for (const [key, data] of saved.blobs ?? []) await blobStore.put(key, data);
  if (!saved.db) await seedDemoData(createContext(db, SYSTEM_ACTOR));

  const tailer = new EventTailer(db);
  await tailer.start();
  // Webhooks can't leave the browser; a pretend receiver accepts every delivery so the log fills in.
  const webhooks = {
    allowPrivate: false,
    send: async () => ({
      statusCode: 200,
      response: 'ok (demo receiver)',
      error: null,
      durationMs: 1,
    }),
  };
  new WebhookRunner(db, { policy: webhooks }).start(tailer);

  const common = { db, tailer, blobStore, webhooks };
  const anonymous = createApp({ ...common, auth: { mode: 'standard', allowDevLogin: true } });
  const perUser = new Map<string, ReturnType<typeof createApp>>();
  const appFor = (handle: string | null) => {
    if (!handle) return anonymous;
    let app = perUser.get(handle);
    if (!app) {
      app = createApp({ ...common, auth: { mode: 'trusted', actor: handle } });
      perUser.set(handle, app);
    }
    return app;
  };

  // Save a snapshot shortly after writes, and right away when the page is hidden or unloaded, always between
  // transactions (sql.js closes and reopens the database to export it).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const flush = (): boolean => {
    const current = currentDatabase();
    if (!dirty || !current) return true;
    if (current.inTransaction) return false;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          db: toBase64(current.export()),
          blobs: blobStore.entries().map(([k, v]) => [k, toBase64(v)]),
        }),
      );
    } catch {
      // storage full or unavailable: the demo keeps working, it just won't survive a reload
    }
    dirty = false;
    return true;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!flush()) schedule();
    }, 400);
  };
  db.onCommit(() => {
    dirty = true;
    schedule();
  });
  addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return {
    fetch: async (request, handle) => appFor(handle).fetch(request),
    users: async () =>
      await db.kysely.selectFrom('users').select('handle').where('kind', '!=', 'system').execute(),
    reset() {
      dirty = false;
      clearTimeout(timer);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // nothing saved
      }
    },
  };
}
