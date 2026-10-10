import { type Tx, withWriteTx } from '@poietic-tech/issues-db';
import {
  type CreateStatusInput,
  CreateStatusInputSchema,
  type Status,
  type UpdateStatusInput,
  UpdateStatusInputSchema,
} from '@poietic-tech/issues-schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, isUniqueViolation, notFound, parseInput, validationError } from '../errors.ts';
import { diff, recordEvent } from '../events.ts';
import { toStatus } from '../mappers.ts';
import { getProjectRow, getStatusRow, requireProjectId } from '../refs.ts';

export async function listStatuses(ctx: ServiceContext, projectRef: string): Promise<Status[]> {
  const project = await getProjectRow(ctx, ctx.db.kysely, projectRef, 'read');
  const rows = await ctx.db.kysely
    .selectFrom('statuses')
    .selectAll()
    .where('project_id', '=', project.id)
    .orderBy('position')
    .orderBy('id')
    .execute();
  return rows.map(toStatus);
}

async function statusRowById(db: Tx, id: string) {
  const row = await db.selectFrom('statuses').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Status', id);
  return row;
}

export async function createStatus(
  ctx: ServiceContext,
  projectRef: string,
  input: CreateStatusInput,
): Promise<Status> {
  const data = parseInput(CreateStatusInputSchema, input);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const project = await getProjectRow(ctx, tx, projectRef, 'write');
      const existing = await tx
        .selectFrom('statuses')
        .select('id')
        .where('project_id', '=', project.id)
        .orderBy('position')
        .orderBy('id')
        .execute();
      const position = Math.min(data.position ?? existing.length, existing.length);
      const now = nowIso(ctx);
      // Shift later statuses down to make room.
      await tx
        .updateTable('statuses')
        .set((eb) => ({ position: eb('position', '+', 1) }))
        .where('project_id', '=', project.id)
        .where('position', '>=', position)
        .execute();
      const row = await tx
        .insertInto('statuses')
        .values({
          id: ctx.ids('status'),
          project_id: project.id,
          name: data.name,
          category: data.category,
          color: data.color,
          position,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const status = toStatus(row);
      await recordEvent(tx, ctx, 'status.created', { projectId: project.id, data: { status } });
      return status;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A status named "${data.name}" already exists in this project`);
    throw error;
  }
}

export async function updateStatus(
  ctx: ServiceContext,
  statusId: string,
  input: UpdateStatusInput,
): Promise<Status> {
  const patch = parseInput(UpdateStatusInputSchema, input);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const row = await statusRowById(tx, statusId);
      await requireProjectId(ctx, tx, row.project_id, 'write', 'Status', statusId);
      const before = toStatus(row);
      const updated = await tx
        .updateTable('statuses')
        .set({ ...patch, updated_at: nowIso(ctx) })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const status = toStatus(updated);
      const changes = diff(before, status, ['name', 'category', 'color']);
      if (Object.keys(changes).length > 0)
        await recordEvent(tx, ctx, 'status.updated', {
          projectId: status.projectId,
          data: { status, changes },
        });
      return status;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A status named "${patch.name}" already exists in this project`);
    throw error;
  }
}

/**
 * Deletes a status. If issues (including trashed ones) use it, `moveIssuesTo` (status id or name in the same
 * project) is required and those issues are moved there first.
 */
export async function deleteStatus(
  ctx: ServiceContext,
  statusId: string,
  opts: { moveIssuesTo?: string } = {},
): Promise<Status> {
  return withWriteTx(ctx.db, async (tx) => {
    const row = await statusRowById(tx, statusId);
    await requireProjectId(ctx, tx, row.project_id, 'write', 'Status', statusId);
    const count = await tx
      .selectFrom('statuses')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('project_id', '=', row.project_id)
      .executeTakeFirstOrThrow();
    if (Number(count.n) <= 1) throw validationError('A project must keep at least one status');
    const used = await tx
      .selectFrom('issues')
      .select('id')
      .where('status_id', '=', row.id)
      .limit(1)
      .execute();
    if (used.length > 0) {
      if (!opts.moveIssuesTo)
        throw conflict(
          'Issues use this status; pass moveIssuesTo with the status they should move to',
        );
      const target = await getStatusRow(tx, row.project_id, opts.moveIssuesTo);
      if (target.id === row.id) throw validationError('moveIssuesTo must be a different status');
      await tx
        .updateTable('issues')
        .set((eb) => ({
          status_id: target.id,
          version: eb('version', '+', 1),
          updated_at: nowIso(ctx),
        }))
        .where('status_id', '=', row.id)
        .execute();
    }
    await tx.deleteFrom('statuses').where('id', '=', row.id).execute();
    await compactPositions(tx, row.project_id);
    const status = toStatus(row);
    await recordEvent(tx, ctx, 'status.deleted', { projectId: row.project_id, data: { status } });
    return status;
  });
}

async function compactPositions(tx: Tx, projectId: string) {
  const rows = await tx
    .selectFrom('statuses')
    .select('id')
    .where('project_id', '=', projectId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  for (const [position, r] of rows.entries()) {
    await tx.updateTable('statuses').set({ position }).where('id', '=', r.id).execute();
  }
}

/** Sets the full column order of a project's statuses. `ids` must list every status exactly once. */
export async function reorderStatuses(
  ctx: ServiceContext,
  projectRef: string,
  ids: string[],
): Promise<Status[]> {
  return withWriteTx(ctx.db, async (tx) => {
    const project = await getProjectRow(ctx, tx, projectRef, 'write');
    const rows = await tx
      .selectFrom('statuses')
      .selectAll()
      .where('project_id', '=', project.id)
      .execute();
    const known = new Set(rows.map((r) => r.id));
    if (
      ids.length !== rows.length ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => known.has(id))
    )
      throw validationError('ids must list every status of the project exactly once');
    const now = nowIso(ctx);
    for (const [position, id] of ids.entries()) {
      await tx
        .updateTable('statuses')
        .set({ position, updated_at: now })
        .where('id', '=', id)
        .execute();
    }
    const updated = await tx
      .selectFrom('statuses')
      .selectAll()
      .where('project_id', '=', project.id)
      .orderBy('position')
      .execute();
    for (const r of updated) {
      const before = rows.find((b) => b.id === r.id)!;
      if (before.position !== r.position)
        await recordEvent(tx, ctx, 'status.updated', {
          projectId: project.id,
          data: {
            status: toStatus(r),
            changes: { position: { from: before.position, to: r.position } },
          },
        });
    }
    return updated.map(toStatus);
  });
}
