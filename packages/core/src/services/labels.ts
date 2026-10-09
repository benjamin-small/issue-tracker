import { type Tx, withWriteTx } from '@poietic-tech/issues-db';
import {
  type CreateLabelInput,
  CreateLabelInputSchema,
  isIdOf,
  type Label,
  type UpdateLabelInput,
  UpdateLabelInputSchema,
} from '@poietic-tech/issues-schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, isUniqueViolation, notFound, parseInput } from '../errors.ts';
import { diff, recordEvent } from '../events.ts';
import { toLabel } from '../mappers.ts';
import { getProjectRow, requireProjectId } from '../refs.ts';

export async function listLabels(ctx: ServiceContext, projectRef: string): Promise<Label[]> {
  const project = await getProjectRow(ctx, ctx.db.kysely, projectRef, 'read');
  const rows = await ctx.db.kysely
    .selectFrom('labels')
    .selectAll()
    .where('project_id', '=', project.id)
    .where('archived_at', 'is', null)
    .orderBy('name')
    .execute();
  return rows.map(toLabel);
}

export async function createLabel(
  ctx: ServiceContext,
  projectRef: string,
  input: CreateLabelInput,
): Promise<Label> {
  const data = parseInput(CreateLabelInputSchema, input);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const project = await getProjectRow(ctx, tx, projectRef, 'write');
      const now = nowIso(ctx);
      const row = await tx
        .insertInto('labels')
        .values({
          id: ctx.ids('label'),
          project_id: project.id,
          name: data.name,
          color: data.color,
          description: data.description,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const label = toLabel(row);
      await recordEvent(tx, ctx, 'label.created', { projectId: project.id, data: { label } });
      return label;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A label named "${data.name}" already exists in this project`);
    throw error;
  }
}

async function labelRow(db: Tx, id: string) {
  if (!isIdOf('label', id)) throw notFound('Label', id);
  const row = await db.selectFrom('labels').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Label', id);
  return row;
}

export async function updateLabel(
  ctx: ServiceContext,
  labelId: string,
  input: UpdateLabelInput,
): Promise<Label> {
  const patch = parseInput(UpdateLabelInputSchema, input);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const row = await labelRow(tx, labelId);
      await requireProjectId(ctx, tx, row.project_id, 'write', 'Label', labelId);
      const before = toLabel(row);
      const updated = await tx
        .updateTable('labels')
        .set({ ...patch, updated_at: nowIso(ctx) })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const label = toLabel(updated);
      const changes = diff(before, label, ['name', 'color', 'description']);
      if (Object.keys(changes).length > 0)
        await recordEvent(tx, ctx, 'label.updated', {
          projectId: label.projectId,
          data: { label, changes },
        });
      return label;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A label named "${patch.name}" already exists in this project`);
    throw error;
  }
}

/** Deletes a label and removes it from all issues. */
export async function deleteLabel(ctx: ServiceContext, labelId: string): Promise<Label> {
  return withWriteTx(ctx.db, async (tx) => {
    const row = await labelRow(tx, labelId);
    await requireProjectId(ctx, tx, row.project_id, 'write', 'Label', labelId);
    await tx.deleteFrom('labels').where('id', '=', row.id).execute();
    const label = toLabel(row);
    await recordEvent(tx, ctx, 'label.deleted', { projectId: label.projectId, data: { label } });
    return label;
  });
}
