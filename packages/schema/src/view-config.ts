import { z } from 'zod';
import { IssueFilterSchema, SortSpecSchema } from './filter.ts';

/**
 * Persisted configuration of a list or board view. Versioned: stored configs are passed through
 * {@link migrateViewConfig} so the shape can evolve without breaking saved views.
 */
export const ViewConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    filter: IssueFilterSchema.default({ conditions: [] }),
    sort: z
      .array(SortSpecSchema)
      .max(5)
      .default([{ field: 'rank', dir: 'asc' }]),
    list: z
      .object({
        columns: z
          .array(z.object({ field: z.string(), width: z.number().int().positive().optional() }))
          .default([
            { field: 'key' },
            { field: 'title' },
            { field: 'status' },
            { field: 'priority' },
            { field: 'assignee' },
            { field: 'labels' },
            { field: 'updatedAt' },
          ]),
        groupBy: z
          .string()
          .nullable()
          .default(null)
          .meta({ description: 'Groupable field key, or null.' }),
      })
      .default({ columns: [], groupBy: null }),
    board: z
      .object({
        groupBy: z
          .string()
          .default('status')
          .meta({ description: 'Groupable field key for columns.' }),
        cardFields: z
          .array(z.string())
          .default(['key', 'priority', 'assignee', 'labels'])
          .meta({ description: 'Field registry keys shown on cards, in order.' }),
        showEmptyGroups: z.boolean().default(true),
      })
      .default({ groupBy: 'status', cardFields: [], showEmptyGroups: true }),
    density: z.enum(['compact', 'comfortable']).default('comfortable'),
  })
  .meta({ id: 'ViewConfig' });
export type ViewConfig = z.infer<typeof ViewConfigSchema>;
export type ViewConfigInput = z.input<typeof ViewConfigSchema>;

/** Full default config (parsing `{}` would leave nested arrays empty because the parent default wins). */
export function defaultViewConfig(layout: 'list' | 'board'): ViewConfig {
  return ViewConfigSchema.parse({
    sort:
      layout === 'board' ? [{ field: 'rank', dir: 'asc' }] : [{ field: 'updatedAt', dir: 'desc' }],
    // Lists read best grouped by workflow stage, like the board.
    list: layout === 'list' ? { groupBy: 'status' } : {},
    board: {},
  });
}

/** Upgrades any stored config to the current version. */
export function migrateViewConfig(raw: unknown): ViewConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  // v1 is the only version so far; future versions transform here before parsing.
  return ViewConfigSchema.parse({ list: {}, board: {}, ...value });
}

export const ViewLayoutSchema = z.enum(['list', 'board']);

export const ViewSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    ownerId: z
      .string()
      .nullable()
      .meta({ description: 'Null for views shared with the whole project.' }),
    name: z.string(),
    layout: ViewLayoutSchema,
    config: ViewConfigSchema,
    position: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'View' });
export type View = z.infer<typeof ViewSchema>;

export const CreateViewInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    layout: ViewLayoutSchema,
    config: ViewConfigSchema.optional(),
    shared: z
      .boolean()
      .default(false)
      .meta({ description: 'Share with the project instead of keeping it personal.' }),
  })
  .meta({ id: 'CreateViewInput' });
export type CreateViewInput = z.input<typeof CreateViewInputSchema>;

export const UpdateViewInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    config: ViewConfigSchema,
    position: z.number().int().min(0),
  })
  .partial()
  .meta({ id: 'UpdateViewInput' });
export type UpdateViewInput = z.input<typeof UpdateViewInputSchema>;
