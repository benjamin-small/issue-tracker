import { type Tx, toJson, withWriteTx } from '@poietic-tech/issues-db';
import {
  type CreateProjectInput,
  CreateProjectInputSchema,
  defaultViewConfig,
  type Project,
  type StatusCategory,
  type UpdateProjectInput,
  UpdateProjectInputSchema,
} from '@poietic-tech/issues-schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, isUniqueViolation, parseInput } from '../errors.ts';
import { diff, recordEvent } from '../events.ts';
import { toProject, toStatus } from '../mappers.ts';
import { requireAdmin } from '../permissions.ts';
import { getProjectRow } from '../refs.ts';

/** Workflow every new project starts with. Statuses are fully editable afterwards. */
export const DEFAULT_STATUSES: ReadonlyArray<{
  name: string;
  category: StatusCategory;
  color: string;
}> = [
  { name: 'Backlog', category: 'backlog', color: '#95a2b3' },
  { name: 'Todo', category: 'unstarted', color: '#e2e2e2' },
  { name: 'In Progress', category: 'started', color: '#f2c94c' },
  { name: 'In Review', category: 'started', color: '#5e6ad2' },
  { name: 'Done', category: 'completed', color: '#4cb782' },
  { name: 'Canceled', category: 'canceled', color: '#95a2b3' },
];

export async function listProjects(
  ctx: ServiceContext,
  opts: { includeArchived?: boolean } = {},
): Promise<Project[]> {
  let q = ctx.db.kysely.selectFrom('projects').selectAll().orderBy('key');
  if (!opts.includeArchived) q = q.where('archived_at', 'is', null);
  return (await q.execute()).map(toProject);
}

export async function getProject(ctx: ServiceContext, ref: string): Promise<Project> {
  return toProject(await getProjectRow(ctx.db.kysely, ref));
}

/** Creates a project with the default workflow and two shared views (list + board). Admin only. */
export async function createProject(
  ctx: ServiceContext,
  input: CreateProjectInput,
): Promise<Project> {
  requireAdmin(ctx, 'create projects');
  const data = parseInput(CreateProjectInputSchema, input);
  const now = nowIso(ctx);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const row = await tx
        .insertInto('projects')
        .values({
          id: ctx.ids('project'),
          key: data.key,
          name: data.name,
          description: data.description,
          next_issue_number: 1,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const project = toProject(row);
      await recordEvent(tx, ctx, 'project.created', { projectId: project.id, data: { project } });
      await createDefaults(tx, ctx, project.id);
      return project;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`A project with key "${data.key}" already exists`);
    throw error;
  }
}

async function createDefaults(tx: Tx, ctx: ServiceContext, projectId: string): Promise<void> {
  const now = nowIso(ctx);
  for (const [position, s] of DEFAULT_STATUSES.entries()) {
    const row = await tx
      .insertInto('statuses')
      .values({
        id: ctx.ids('status'),
        project_id: projectId,
        name: s.name,
        category: s.category,
        color: s.color,
        position,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordEvent(tx, ctx, 'status.created', { projectId, data: { status: toStatus(row) } });
  }
  const views = [
    { name: 'All issues', layout: 'list' as const },
    { name: 'Board', layout: 'board' as const },
  ];
  for (const [position, v] of views.entries()) {
    await tx
      .insertInto('views')
      .values({
        id: ctx.ids('view'),
        project_id: projectId,
        owner_id: null,
        name: v.name,
        layout: v.layout,
        config: toJson(defaultViewConfig(v.layout)),
        position,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
}

export async function updateProject(
  ctx: ServiceContext,
  ref: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const patch = parseInput(UpdateProjectInputSchema, input);
  if (patch.archived !== undefined) requireAdmin(ctx, 'archive projects');
  return withWriteTx(ctx.db, async (tx) => {
    const row = await getProjectRow(tx, ref);
    const before = toProject(row);
    const now = nowIso(ctx);
    const updated = await tx
      .updateTable('projects')
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.archived !== undefined && {
          archived_at: patch.archived ? (row.archived_at ?? now) : null,
        }),
        updated_at: now,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    const project = toProject(updated);
    const changes = diff(before, project, ['name', 'description', 'archivedAt']);
    if (Object.keys(changes).length > 0)
      await recordEvent(tx, ctx, 'project.updated', {
        projectId: project.id,
        data: { project, changes },
      });
    return project;
  });
}
