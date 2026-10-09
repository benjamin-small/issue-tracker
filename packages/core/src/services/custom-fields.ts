import { fromJson, toJson, type Tx, withWriteTx } from '@poietic-tech/issues-db';
import {
  type CreateCustomFieldInput,
  CreateCustomFieldInputSchema,
  type CreateFieldOptionInput,
  CreateFieldOptionInputSchema,
  type CustomField,
  isIdOf,
  type UpdateCustomFieldInput,
  UpdateCustomFieldInputSchema,
  type UpdateFieldOptionInput,
  UpdateFieldOptionInputSchema,
} from '@poietic-tech/issues-schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, isUniqueViolation, notFound, parseInput, validationError } from '../errors.ts';
import { diff, recordEvent } from '../events.ts';
import { getProjectRow, requireProjectId } from '../refs.ts';

const SELECT_TYPES = new Set(['select', 'multi_select']);
const PALETTE = [
  '#5e6ad2',
  '#26b5ce',
  '#4cb782',
  '#f2c94c',
  '#f2994a',
  '#eb5757',
  '#bb87fc',
  '#95a2b3',
];

async function loadFields(
  db: Tx,
  where: { projectId?: string; id?: string },
  includeArchived = true,
): Promise<CustomField[]> {
  let q = db.selectFrom('custom_fields').selectAll().orderBy('position').orderBy('created_at');
  if (where.projectId) q = q.where('project_id', '=', where.projectId);
  if (where.id) q = q.where('id', '=', where.id);
  if (!includeArchived) q = q.where('archived_at', 'is', null);
  const rows = await q.execute();
  if (rows.length === 0) return [];
  const options = await db
    .selectFrom('custom_field_options')
    .selectAll()
    .where(
      'field_id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    key: r.key,
    name: r.name,
    description: r.description,
    type: r.type,
    config: fromJson<Record<string, unknown>>(r.config, {}),
    position: r.position,
    options: options
      .filter((o) => o.field_id === r.id)
      .map((o) => ({
        id: o.id,
        value: o.value,
        label: o.label,
        color: o.color,
        position: o.position,
        archivedAt: o.archived_at,
      })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  }));
}

async function fieldById(db: Tx, id: string): Promise<CustomField> {
  const [field] = isIdOf('customField', id) ? await loadFields(db, { id }) : [];
  if (!field) throw notFound('Custom field', id);
  return field;
}

/** Custom fields of a project in display order (archived ones only when asked). */
export async function listCustomFields(
  ctx: ServiceContext,
  projectRef: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CustomField[]> {
  const project = await getProjectRow(ctx, ctx.db.kysely, projectRef, 'read');
  return loadFields(ctx.db.kysely, { projectId: project.id }, opts.includeArchived ?? false);
}

export async function getCustomField(ctx: ServiceContext, id: string): Promise<CustomField> {
  const field = await fieldById(ctx.db.kysely, id);
  await requireProjectId(ctx, ctx.db.kysely, field.projectId, 'read');
  return field;
}

async function insertOption(
  tx: Tx,
  ctx: ServiceContext,
  fieldId: string,
  input: CreateFieldOptionInput,
  position: number,
) {
  const data = parseInput(CreateFieldOptionInputSchema, input);
  const now = nowIso(ctx);
  try {
    await tx
      .insertInto('custom_field_options')
      .values({
        id: ctx.ids('customFieldOption'),
        field_id: fieldId,
        value: data.value,
        label: data.label ?? data.value,
        color: data.color ?? PALETTE[position % PALETTE.length]!,
        position,
        created_at: now,
        updated_at: now,
        archived_at: null,
      })
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`Option "${data.value}" already exists`);
    throw error;
  }
}

/** Creates a custom field (with options for select types). New fields go last. */
export async function createCustomField(
  ctx: ServiceContext,
  projectRef: string,
  input: CreateCustomFieldInput,
): Promise<CustomField> {
  const data = parseInput(CreateCustomFieldInputSchema, input);
  if (!SELECT_TYPES.has(data.type) && data.options.length)
    throw validationError(`Options are only allowed for select and multi_select fields`);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const project = await getProjectRow(ctx, tx, projectRef, 'write');
      const count = await tx
        .selectFrom('custom_fields')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('project_id', '=', project.id)
        .executeTakeFirstOrThrow();
      const now = nowIso(ctx);
      const id = ctx.ids('customField');
      await tx
        .insertInto('custom_fields')
        .values({
          id,
          project_id: project.id,
          key: data.key,
          name: data.name,
          description: data.description,
          type: data.type,
          config: toJson(data.config),
          position: Number(count.n),
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      for (const [i, option] of data.options.entries()) await insertOption(tx, ctx, id, option, i);
      const field = await fieldById(tx, id);
      await recordEvent(tx, ctx, 'field.created', { projectId: project.id, data: { field } });
      return field;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A field with key "${data.key}" already exists in this project`);
    throw error;
  }
}

/** Renames, re-describes, reorders or (un)archives a field. The key and type are immutable. */
export async function updateCustomField(
  ctx: ServiceContext,
  id: string,
  input: UpdateCustomFieldInput,
): Promise<CustomField> {
  const patch = parseInput(UpdateCustomFieldInputSchema, input);
  return withWriteTx(ctx.db, async (tx) => {
    const before = await fieldById(tx, id);
    await requireProjectId(ctx, tx, before.projectId, 'write');
    const now = nowIso(ctx);
    await tx
      .updateTable('custom_fields')
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.config !== undefined && { config: toJson(patch.config) }),
        ...(patch.position !== undefined && { position: patch.position }),
        ...(patch.archived !== undefined && {
          archived_at: patch.archived ? (before.archivedAt ?? now) : null,
        }),
        updated_at: now,
      })
      .where('id', '=', before.id)
      .execute();
    const field = await fieldById(tx, id);
    const changes = diff(before, field, [
      'name',
      'description',
      'config',
      'position',
      'archivedAt',
    ]);
    if (Object.keys(changes).length)
      await recordEvent(tx, ctx, 'field.updated', {
        projectId: field.projectId,
        data: { field, changes },
      });
    return field;
  });
}

/** Deletes a field and all its values permanently (project managers). Prefer archiving. */
export async function deleteCustomField(ctx: ServiceContext, id: string): Promise<CustomField> {
  return withWriteTx(ctx.db, async (tx) => {
    const field = await fieldById(tx, id);
    await requireProjectId(ctx, tx, field.projectId, 'manage');
    await tx.deleteFrom('custom_fields').where('id', '=', field.id).execute();
    await recordEvent(tx, ctx, 'field.deleted', { projectId: field.projectId, data: { field } });
    return field;
  });
}

/** Adds a choice to a select / multi_select field. */
export async function addFieldOption(
  ctx: ServiceContext,
  fieldId: string,
  input: CreateFieldOptionInput,
): Promise<CustomField> {
  return withWriteTx(ctx.db, async (tx) => {
    const before = await fieldById(tx, fieldId);
    await requireProjectId(ctx, tx, before.projectId, 'write');
    if (!SELECT_TYPES.has(before.type))
      throw validationError(`"${before.key}" is a ${before.type} field; it has no options`);
    await insertOption(tx, ctx, before.id, input, before.options.length);
    const field = await fieldById(tx, fieldId);
    await recordEvent(tx, ctx, 'field.updated', {
      projectId: field.projectId,
      data: { field, changes: diff(before, field, ['options']) },
    });
    return field;
  });
}

/** Relabels, recolors, reorders or (un)archives an option. Values are immutable so stored data stays valid. */
export async function updateFieldOption(
  ctx: ServiceContext,
  optionId: string,
  input: UpdateFieldOptionInput,
): Promise<CustomField> {
  const patch = parseInput(UpdateFieldOptionInputSchema, input);
  return withWriteTx(ctx.db, async (tx) => {
    const row = isIdOf('customFieldOption', optionId)
      ? await tx
          .selectFrom('custom_field_options')
          .selectAll()
          .where('id', '=', optionId)
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound('Option', optionId);
    const before = await fieldById(tx, row.field_id);
    await requireProjectId(ctx, tx, before.projectId, 'write');
    const now = nowIso(ctx);
    await tx
      .updateTable('custom_field_options')
      .set({
        ...(patch.label !== undefined && { label: patch.label }),
        ...(patch.color !== undefined && { color: patch.color }),
        ...(patch.position !== undefined && { position: patch.position }),
        ...(patch.archived !== undefined && {
          archived_at: patch.archived ? (row.archived_at ?? now) : null,
        }),
        updated_at: now,
      })
      .where('id', '=', row.id)
      .execute();
    const field = await fieldById(tx, row.field_id);
    const changes = diff(before, field, ['options']);
    if (Object.keys(changes).length)
      await recordEvent(tx, ctx, 'field.updated', {
        projectId: field.projectId,
        data: { field, changes },
      });
    return field;
  });
}
