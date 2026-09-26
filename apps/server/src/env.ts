import type { OpenAPIHono } from '@hono/zod-openapi';
import type {
  Actor,
  BlobStore,
  Clock,
  EventTailer,
  IdGenerator,
  ServiceContext,
} from '@tracker/core';
import type { Db } from '@tracker/db';

/**
 * How requests are authenticated.
 * - `standard`: bearer tokens (`Authorization: Bearer trk_…`) and web session cookies. With `allowDevLogin`,
 *   `POST /auth/dev-login` lets the web UI sign in as any user — development only.
 * - `trusted`: every request acts as a fixed user, no credentials. Used only in-process by the CLI's local mode
 *   (which already has direct database access); never mounted on a listening server.
 */
export type AuthConfig =
  | {
      mode: 'standard';
      allowDevLogin?: boolean;
      secureCookies?: boolean;
      allowedOrigins?: string[];
    }
  | { mode: 'trusted'; actor: string };

export interface AppDeps {
  /** Database handle; resolved lazily so the app (and its OpenAPI document) can be built without one. */
  db?: Db | (() => Db);
  auth?: AuthConfig;
  clock?: Clock;
  ids?: IdGenerator;
  /** Directory with the built web app to serve at `/` (production). */
  webDir?: string;
  /** Where attachment bytes are stored. Without one, attachment routes answer 503. */
  blobStore?: BlobStore;
  /** Upload size limit in bytes (default 25 MB). */
  maxUploadBytes?: number;
  /** Follows the event log for live streaming (`GET /events/stream`) and webhooks. */
  tailer?: EventTailer;
  /** Extra hooks for features that attach to the app (attachments, …). */
  extensions?: AppExtension[];
}

export type AppExtension = (app: TrackerApp, deps: ResolvedDeps) => void;

export interface ResolvedDeps extends Omit<AppDeps, 'db'> {
  getDb(): Db;
  auth: AuthConfig;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    actor: Actor | null;
    authVia: 'bearer' | 'session' | 'trusted' | null;
    ctx: ServiceContext;
  };
}

export type TrackerApp = OpenAPIHono<AppEnv>;

export const SESSION_COOKIE = 'tracker_session';
export const API_PREFIX = '/api/v1';
