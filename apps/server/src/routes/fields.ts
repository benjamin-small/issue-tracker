import { createRoute, z } from '@hono/zod-openapi';
import {
  addFieldOption,
  createCustomField,
  deleteCustomField,
  listCustomFields,
  updateCustomField,
  updateFieldOption,
} from '@tracker/core';
import {
  CreateCustomFieldInputSchema,
  CreateFieldOptionInputSchema,
  CustomFieldSchema,
  UpdateCustomFieldInputSchema,
  UpdateFieldOptionInputSchema,
} from '@tracker/schema';
import type { TrackerApp } from '../env.ts';
import { BooleanQuery, errorResponses, json, jsonBody, refParam } from './common.ts';

const tags = ['Custom fields'];
const projectParam = z.object({
  project: refParam('project', 'Project key (e.g. `ENG`) or id.', 'ENG'),
});
const idParam = (example: string) => z.object({ id: refParam('id', 'Resource id.', example) });

export function registerFieldRoutes(app: TrackerApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/projects/{project}/fields',
      tags,
      summary: 'List custom fields',
      request: { params: projectParam, query: z.object({ includeArchived: BooleanQuery }) },
      responses: {
        200: json(z.object({ data: z.array(CustomFieldSchema) }), 'Fields in display order'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json(
        {
          data: await listCustomFields(
            c.get('ctx'),
            c.req.valid('param').project,
            c.req.valid('query'),
          ),
        },
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/projects/{project}/fields',
      tags,
      summary: 'Create a custom field',
      description:
        'Values are set on issues through `customFields: { <key>: value }` and filtered with `cf.<key>=…` / `cf:<key>`.',
      request: { params: projectParam, body: jsonBody(CreateCustomFieldInputSchema) },
      responses: {
        201: json(CustomFieldSchema, 'Created'),
        ...errorResponses('NOT_FOUND', 'CONFLICT'),
      },
    }),
    async (c) =>
      c.json(
        await createCustomField(c.get('ctx'), c.req.valid('param').project, c.req.valid('json')),
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/fields/{id}',
      tags,
      summary: 'Update a custom field (name, description, config, position, archived)',
      request: {
        params: idParam('fld_01h455vb4pex5vsknk084sn02q'),
        body: jsonBody(UpdateCustomFieldInputSchema),
      },
      responses: { 200: json(CustomFieldSchema, 'Updated'), ...errorResponses('NOT_FOUND') },
    }),
    async (c) =>
      c.json(
        await updateCustomField(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/fields/{id}',
      tags,
      summary: 'Delete a custom field and all its values (admin; prefer archiving)',
      request: { params: idParam('fld_01h455vb4pex5vsknk084sn02q') },
      responses: {
        200: json(CustomFieldSchema, 'Deleted'),
        ...errorResponses('NOT_FOUND', 'FORBIDDEN'),
      },
    }),
    async (c) => c.json(await deleteCustomField(c.get('ctx'), c.req.valid('param').id), 200),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/fields/{id}/options',
      tags,
      summary: 'Add an option to a select / multi_select field',
      request: {
        params: idParam('fld_01h455vb4pex5vsknk084sn02q'),
        body: jsonBody(CreateFieldOptionInputSchema),
      },
      responses: {
        201: json(CustomFieldSchema, 'The updated field'),
        ...errorResponses('NOT_FOUND', 'CONFLICT'),
      },
    }),
    async (c) =>
      c.json(await addFieldOption(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/field-options/{id}',
      tags,
      summary: 'Relabel, recolor, reorder or archive an option (values are immutable)',
      request: {
        params: idParam('opt_01h455vb4pex5vsknk084sn02q'),
        body: jsonBody(UpdateFieldOptionInputSchema),
      },
      responses: {
        200: json(CustomFieldSchema, 'The updated field'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json(
        await updateFieldOption(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')),
        200,
      ),
  );
}
