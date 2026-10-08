import { createRoute, z } from '@hono/zod-openapi';
import {
  createComment,
  createLink,
  createView,
  deleteComment,
  deleteLink,
  deleteView,
  getView,
  listComments,
  listEvents,
  listIssueLinks,
  listLinkTypes,
  listViews,
  updateComment,
  updateView,
} from '@poietic-tech/issues-core';
import {
  CommentSchema,
  CreateCommentInputSchema,
  CreateLinkInputSchema,
  CreateViewInputSchema,
  EVENT_TYPES,
  EventSchema,
  IssueLinkSchema,
  LinkTypeSchema,
  pageOf,
  UpdateCommentInputSchema,
  UpdateViewInputSchema,
  ViewSchema,
} from '@poietic-tech/issues-schema';
import { getIssueRow, getProjectRow } from '@poietic-tech/issues-core';
import type { TrackerApp } from '../env.ts';
import { BooleanQuery, errorResponses, json, jsonBody, noContent, refParam } from './common.ts';

const issueParam = z.object({
  issue: refParam('issue', 'Issue key (e.g. `ENG-42`) or id.', 'ENG-42'),
});
const projectParam = z.object({
  project: refParam('project', 'Project key (e.g. `ENG`) or id.', 'ENG'),
});
const idParam = (example: string) => z.object({ id: refParam('id', 'Resource id.', example) });

export function registerCollaborationRoutes(app: TrackerApp) {
  // ---- comments ----
  let tags = ['Comments'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/issues/{issue}/comments',
      tags,
      summary: 'List comments (oldest first)',
      request: { params: issueParam, query: z.object({ includeDeleted: BooleanQuery }) },
      responses: {
        200: json(z.object({ data: z.array(CommentSchema) }), 'Comments'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json(
        {
          data: await listComments(c.get('ctx'), c.req.valid('param').issue, c.req.valid('query')),
        },
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/issues/{issue}/comments',
      tags,
      summary: 'Add a comment',
      description: 'Markdown body. Supports `Idempotency-Key`.',
      request: { params: issueParam, body: jsonBody(CreateCommentInputSchema) },
      responses: {
        201: json(CommentSchema, 'Created'),
        ...errorResponses('NOT_FOUND', 'CONFLICT'),
      },
    }),
    async (c) =>
      c.json(
        await createComment(c.get('ctx'), c.req.valid('param').issue, c.req.valid('json')),
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/comments/{id}',
      tags,
      summary: 'Edit a comment (author or admin)',
      request: {
        params: idParam('cmt_01h455vb4pex5vsknk084sn02q'),
        body: jsonBody(UpdateCommentInputSchema),
      },
      responses: {
        200: json(CommentSchema, 'Updated'),
        ...errorResponses('NOT_FOUND', 'FORBIDDEN'),
      },
    }),
    async (c) =>
      c.json(await updateComment(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/comments/{id}',
      tags,
      summary: 'Delete a comment (author or admin)',
      request: { params: idParam('cmt_01h455vb4pex5vsknk084sn02q') },
      responses: {
        200: json(CommentSchema, 'Deleted'),
        ...errorResponses('NOT_FOUND', 'FORBIDDEN'),
      },
    }),
    async (c) => c.json(await deleteComment(c.get('ctx'), c.req.valid('param').id), 200),
  );

  // ---- links ----
  tags = ['Links'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/link-types',
      tags,
      summary: 'List link types',
      responses: {
        200: json(z.object({ data: z.array(LinkTypeSchema) }), 'Link types'),
        ...errorResponses(),
      },
    }),
    async (c) => c.json({ data: await listLinkTypes(c.get('ctx')) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/issues/{issue}/links',
      tags,
      summary: "List an issue's links, from its perspective",
      request: { params: issueParam },
      responses: {
        200: json(z.object({ data: z.array(IssueLinkSchema) }), 'Links'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json({ data: await listIssueLinks(c.get('ctx'), c.req.valid('param').issue) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/issues/{issue}/links',
      tags,
      summary: 'Link to another issue',
      description:
        '`{"type":"blocks","target":"ENG-7"}` reads "this issue blocks ENG-7". Use `direction: "inward"` to reverse.',
      request: { params: issueParam, body: jsonBody(CreateLinkInputSchema) },
      responses: {
        201: json(IssueLinkSchema, 'Created'),
        ...errorResponses('NOT_FOUND', 'CONFLICT', 'INVALID_RELATION'),
      },
    }),
    async (c) =>
      c.json(await createLink(c.get('ctx'), c.req.valid('param').issue, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/links/{id}',
      tags,
      summary: 'Remove a link',
      request: { params: idParam('lnk_01h455vb4pex5vsknk084sn02q') },
      responses: { 204: noContent, ...errorResponses('NOT_FOUND') },
    }),
    async (c) => {
      await deleteLink(c.get('ctx'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  // ---- views ----
  tags = ['Views'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/projects/{project}/views',
      tags,
      summary: 'List views (shared + yours)',
      request: { params: projectParam },
      responses: {
        200: json(z.object({ data: z.array(ViewSchema) }), 'Views'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) => c.json({ data: await listViews(c.get('ctx'), c.req.valid('param').project) }, 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/projects/{project}/views',
      tags,
      summary: 'Save a view',
      request: { params: projectParam, body: jsonBody(CreateViewInputSchema) },
      responses: { 201: json(ViewSchema, 'Created'), ...errorResponses('NOT_FOUND') },
    }),
    async (c) =>
      c.json(
        await createView(c.get('ctx'), c.req.valid('param').project, c.req.valid('json')),
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: 'get',
      path: '/views/{id}',
      tags,
      summary: 'Get a view',
      request: { params: idParam('viw_01h455vb4pex5vsknk084sn02q') },
      responses: { 200: json(ViewSchema, 'View'), ...errorResponses('NOT_FOUND') },
    }),
    async (c) => c.json(await getView(c.get('ctx'), c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/views/{id}',
      tags,
      summary: 'Update a view (name, config, position)',
      request: {
        params: idParam('viw_01h455vb4pex5vsknk084sn02q'),
        body: jsonBody(UpdateViewInputSchema),
      },
      responses: { 200: json(ViewSchema, 'Updated'), ...errorResponses('NOT_FOUND') },
    }),
    async (c) =>
      c.json(await updateView(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/views/{id}',
      tags,
      summary: 'Delete a view',
      request: { params: idParam('viw_01h455vb4pex5vsknk084sn02q') },
      responses: { 200: json(ViewSchema, 'Deleted'), ...errorResponses('NOT_FOUND', 'FORBIDDEN') },
    }),
    async (c) => c.json(await deleteView(c.get('ctx'), c.req.valid('param').id), 200),
  );

  // ---- events ----
  tags = ['Events'];
  app.openapi(
    createRoute({
      method: 'get',
      path: '/events',
      tags,
      summary: 'Read the event log',
      description:
        'Events in commit order. Poll with `after=<last seq seen>`; `nextCursor` is the seq to pass next. ' +
        'Ideal for agents that need "what changed since X".',
      request: {
        query: z.object({
          after: z.coerce.number().int().min(0).optional(),
          limit: z.coerce.number().int().min(1).max(1000).optional(),
          project: z.string().optional().openapi({ description: 'Project key or id.' }),
          issue: z.string().optional().openapi({ description: 'Issue key or id.' }),
          types: z
            .string()
            .optional()
            .openapi({ description: `Comma-separated event types: ${EVENT_TYPES.join(', ')}.` }),
        }),
      },
      responses: {
        200: json(pageOf(EventSchema).meta({ id: 'EventPage' }), 'Events'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const ctx = c.get('ctx');
      const project = q.project ? (await getProjectRow(ctx.db.kysely, q.project)).id : undefined;
      const issue = q.issue ? (await getIssueRow(ctx.db.kysely, q.issue)).id : undefined;
      const types = q.types?.split(',').map((t) => t.trim()) as
        (typeof EVENT_TYPES)[number][] | undefined;
      return c.json(
        await listEvents(ctx, { after: q.after, limit: q.limit, project, issue, types }),
        200,
      );
    },
  );
}
