import { createRoute, z } from '@hono/zod-openapi';
import {
  actorForUser,
  authenticateToken,
  createSession,
  deleteSession,
  DomainError,
  getUser,
  listUsers,
} from '@tracker/core';
import { UserSchema, UserSummarySchema } from '@tracker/schema';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { type AppEnv, type ResolvedDeps, SESSION_COOKIE, type TrackerApp } from '../env.ts';
import { errorResponses, json, jsonBody, noContent } from './common.ts';

const tags = ['Auth'];

const AuthConfigSchema = z
  .object({
    devLogin: z
      .boolean()
      .openapi({ description: 'Whether passwordless dev login is enabled (development only).' }),
    users: z
      .array(UserSummarySchema)
      .optional()
      .openapi({ description: 'Users to pick from (dev login only).' }),
  })
  .openapi('AuthConfig');

export function registerAuthRoutes(app: TrackerApp, deps: ResolvedDeps) {
  const devLogin = deps.auth.mode === 'standard' && deps.auth.allowDevLogin === true;
  const secure = deps.auth.mode === 'standard' && deps.auth.secureCookies === true;

  async function startSession(c: Context<AppEnv>, userId: string) {
    const ctx = c.get('ctx');
    const session = await createSession(ctx, userId);
    setCookie(c, SESSION_COOKIE, session.cookie, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secure || new URL(c.req.url).protocol === 'https:',
      path: '/',
      expires: new Date(session.expiresAt),
    });
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/auth/config',
      tags,
      security: [],
      summary: 'How to sign in',
      description:
        'Public. Tells the web UI whether dev login is available (and the users to pick from).',
      responses: { 200: json(AuthConfigSchema, 'Auth configuration') },
    }),
    async (c) => {
      if (!devLogin) return c.json({ devLogin: false }, 200);
      const users = await listUsers(c.get('ctx'));
      return c.json(
        {
          devLogin: true,
          users: users.map(({ id, handle, name, kind, avatarUrl }) => ({
            id,
            handle,
            name,
            kind,
            avatarUrl,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/token-login',
      tags,
      security: [],
      summary: 'Sign in with an API token',
      description: 'Exchanges an API token for an HttpOnly session cookie (used by the web UI).',
      request: { body: jsonBody(z.object({ token: z.string() }).openapi('TokenLoginInput')) },
      responses: { 200: json(UserSchema, 'Signed in'), ...errorResponses() },
    }),
    async (c) => {
      const { token } = c.req.valid('json');
      const actor = await authenticateToken(c.get('ctx'), token);
      if (!actor) throw new DomainError('UNAUTHENTICATED', 'Invalid, expired or revoked token');
      await startSession(c, actor.id);
      return c.json(await getUser(c.get('ctx'), actor.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/dev-login',
      tags,
      security: [],
      summary: 'Sign in as any user (development only)',
      description: 'Only available when the server runs with `TRACKER_AUTH_MODE=dev`.',
      request: {
        body: jsonBody(
          z
            .object({
              user: z.string().openapi({ description: 'User id or handle.', example: 'ada' }),
            })
            .openapi('DevLoginInput'),
        ),
      },
      responses: {
        200: json(UserSchema, 'Signed in'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND'),
      },
    }),
    async (c) => {
      if (!devLogin) throw new DomainError('FORBIDDEN', 'Dev login is disabled');
      const { user } = c.req.valid('json');
      const actor = await actorForUser(c.get('ctx'), user);
      if (!actor) throw new DomainError('NOT_FOUND', `User "${user}" not found`);
      await startSession(c, actor.id);
      return c.json(await getUser(c.get('ctx'), actor.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/auth/logout',
      tags,
      security: [],
      summary: 'Sign out',
      responses: { 204: noContent },
    }),
    async (c) => {
      const cookie = getCookie(c, SESSION_COOKIE);
      if (cookie) await deleteSession(c.get('ctx'), cookie);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/me',
      tags,
      summary: 'The authenticated user',
      responses: { 200: json(UserSchema, 'Current user'), ...errorResponses() },
    }),
    async (c) => c.json(await getUser(c.get('ctx'), c.get('ctx').actor.id), 200),
  );
}
