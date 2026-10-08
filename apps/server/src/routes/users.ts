import { createRoute, z } from '@hono/zod-openapi';
import {
  createToken,
  createUser,
  getUser,
  listTokens,
  listUsers,
  revokeToken,
  updateUser,
} from '@poietic-tech/issues-core';
import {
  ApiTokenSchema,
  CreatedApiTokenSchema,
  CreateTokenInputSchema,
  CreateUserInputSchema,
  UpdateUserInputSchema,
  UserSchema,
} from '@poietic-tech/issues-schema';
import type { TrackerApp } from '../env.ts';
import { BooleanQuery, errorResponses, json, jsonBody, refParam } from './common.ts';

const tags = ['Users'];
const userParam = z.object({ user: refParam('user', 'User id, handle, `@handle` or `me`.', 'me') });

export function registerUserRoutes(app: TrackerApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/users',
      tags,
      summary: 'List users',
      request: { query: z.object({ includeDeactivated: BooleanQuery }) },
      responses: {
        200: json(z.object({ data: z.array(UserSchema) }), 'Users'),
        ...errorResponses(),
      },
    }),
    async (c) => c.json({ data: await listUsers(c.get('ctx'), c.req.valid('query')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/users',
      tags,
      summary: 'Create a user (human or agent)',
      description:
        'Admin only. Create an `agent` user per automated worker so its changes are attributed.',
      request: { body: jsonBody(CreateUserInputSchema) },
      responses: { 201: json(UserSchema, 'Created'), ...errorResponses('FORBIDDEN', 'CONFLICT') },
    }),
    async (c) => c.json(await createUser(c.get('ctx'), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/users/{user}',
      tags,
      summary: 'Get a user',
      request: { params: userParam },
      responses: { 200: json(UserSchema, 'User'), ...errorResponses('NOT_FOUND') },
    }),
    async (c) => c.json(await getUser(c.get('ctx'), c.req.valid('param').user), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/users/{user}',
      tags,
      summary: 'Update a user',
      description: 'Users may edit their own name, email and avatar; admins may change anything.',
      request: { params: userParam, body: jsonBody(UpdateUserInputSchema) },
      responses: { 200: json(UserSchema, 'Updated'), ...errorResponses('FORBIDDEN', 'NOT_FOUND') },
    }),
    async (c) =>
      c.json(await updateUser(c.get('ctx'), c.req.valid('param').user, c.req.valid('json')), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/users/{user}/tokens',
      tags,
      summary: "List a user's API tokens",
      request: { params: userParam },
      responses: {
        200: json(z.object({ data: z.array(ApiTokenSchema) }), 'Tokens'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND'),
      },
    }),
    async (c) => c.json({ data: await listTokens(c.get('ctx'), c.req.valid('param').user) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/users/{user}/tokens',
      tags,
      summary: 'Create an API token',
      description: 'The secret `token` is returned only in this response.',
      request: { params: userParam, body: jsonBody(CreateTokenInputSchema) },
      responses: {
        201: json(CreatedApiTokenSchema, 'Created'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json(await createToken(c.get('ctx'), c.req.valid('param').user, c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tokens/{id}',
      tags,
      summary: 'Revoke an API token',
      request: {
        params: z.object({ id: refParam('id', 'Token id.', 'tok_01h455vb4pex5vsknk084sn02q') }),
      },
      responses: {
        200: json(ApiTokenSchema, 'Revoked'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND'),
      },
    }),
    async (c) => c.json(await revokeToken(c.get('ctx'), c.req.valid('param').id), 200),
  );
}
