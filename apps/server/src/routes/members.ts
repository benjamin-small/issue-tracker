import { createRoute, z } from '@hono/zod-openapi';
import {
  addMember,
  addRepo,
  listMembers,
  removeMember,
  removeRepo,
  updateMember,
} from '@poietic-tech/issues-core';
import {
  AddProjectMemberInputSchema,
  AddProjectRepoInputSchema,
  ProjectMemberSchema,
  ProjectRepoSchema,
  UpdateProjectMemberInputSchema,
} from '@poietic-tech/issues-schema';
import type { TrackerApp } from '../env.ts';
import { errorResponses, json, jsonBody, refParam } from './common.ts';

const projectParam = z.object({
  project: refParam('project', 'Project key (e.g. `ENG`) or id.', 'ENG'),
});
const memberParam = projectParam.extend({
  user: refParam('user', 'User id, handle, `@handle` or `me`.', '@ada'),
});
const repoParam = projectParam.extend({
  repo: refParam(
    'repo',
    'Linked repository: its `rpo_` id, or `owner/name` with the slash URL-encoded (`acme%2Fapp`).',
    'acme%2Fapp',
  ),
});
const deleted = { description: 'Removed.' };

export function registerMemberRoutes(app: TrackerApp) {
  const tags = ['Project access'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/projects/{project}/members',
      tags,
      summary: 'List project members',
      description: 'Anyone who can read the project can see its members.',
      request: { params: projectParam },
      responses: {
        200: json(z.object({ data: z.array(ProjectMemberSchema) }), 'Members'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json({ data: await listMembers(c.get('ctx'), c.req.valid('param').project) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/projects/{project}/members',
      tags,
      summary: 'Add a project member',
      description: 'Needs manage on the project. `CONFLICT` if the user is already a member.',
      request: { params: projectParam, body: jsonBody(AddProjectMemberInputSchema) },
      responses: {
        201: json(ProjectMemberSchema, 'Added'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
      },
    }),
    async (c) =>
      c.json(await addMember(c.get('ctx'), c.req.valid('param').project, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/projects/{project}/members/{user}',
      tags,
      summary: "Change a member's role",
      description: 'Needs manage on the project.',
      request: { params: memberParam, body: jsonBody(UpdateProjectMemberInputSchema) },
      responses: {
        200: json(ProjectMemberSchema, 'Updated'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND'),
      },
    }),
    async (c) => {
      const { project, user } = c.req.valid('param');
      return c.json(await updateMember(c.get('ctx'), project, user, c.req.valid('json')), 200);
    },
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/projects/{project}/members/{user}',
      tags,
      summary: 'Remove a project member',
      description: 'Needs manage on the project.',
      request: { params: memberParam },
      responses: { 204: deleted, ...errorResponses('FORBIDDEN', 'NOT_FOUND') },
    }),
    async (c) => {
      const { project, user } = c.req.valid('param');
      await removeMember(c.get('ctx'), project, user);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/projects/{project}/repos',
      tags,
      summary: 'Link a GitHub repository to a project',
      description:
        'Needs manage on the project. `repo` is `owner/name` or a github.com URL. ' +
        '`CONFLICT` if it is already linked.',
      request: { params: projectParam, body: jsonBody(AddProjectRepoInputSchema) },
      responses: {
        201: json(ProjectRepoSchema, 'Linked'),
        ...errorResponses('FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
      },
    }),
    async (c) =>
      c.json(await addRepo(c.get('ctx'), c.req.valid('param').project, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/projects/{project}/repos/{repo}',
      tags,
      summary: 'Unlink a repository from a project',
      description: 'Needs manage on the project. Issues that named the repository have it cleared.',
      request: { params: repoParam },
      responses: { 204: deleted, ...errorResponses('FORBIDDEN', 'NOT_FOUND') },
    }),
    async (c) => {
      const { project, repo } = c.req.valid('param');
      await removeRepo(c.get('ctx'), project, repo);
      return c.body(null, 204);
    },
  );
}
