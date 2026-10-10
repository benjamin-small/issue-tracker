import { type Tx, toJson, withWriteTx } from '@poietic-tech/issues-db';
import {
  type CreateViewInput,
  CreateViewInputSchema,
  defaultViewConfig,
  isIdOf,
  type UpdateViewInput,
  UpdateViewInputSchema,
  type View,
} from '@poietic-tech/issues-schema';
import { isAnonymous, nowIso, type ServiceContext } from '../context.ts';
import { DomainError, forbidden, notFound, parseInput } from '../errors.ts';
import { toView } from '../mappers.ts';
import { getProjectRow, requireProjectId } from '../refs.ts';

/** Views visible to the actor in a project: shared ones plus the actor's personal ones. */
export async function listViews(ctx: ServiceContext, projectRef: string): Promise<View[]> {
  const project = await getProjectRow(ctx, ctx.db.kysely, projectRef, 'read');
  const rows = await ctx.db.kysely
    .selectFrom('views')
    .selectAll()
    .where('project_id', '=', project.id)
    .where((eb) => eb.or([eb('owner_id', 'is', null), eb('owner_id', '=', ctx.actor.id)]))
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  return rows.map(toView);
}

async function visibleViewRow(ctx: ServiceContext, id: string, db: Tx = ctx.db.kysely) {
  const row = isIdOf('view', id)
    ? await db.selectFrom('views').selectAll().where('id', '=', id).executeTakeFirst()
    : undefined;
  if (!row || (row.owner_id !== null && row.owner_id !== ctx.actor.id)) throw notFound('View', id);
  await requireProjectId(ctx, db, row.project_id, 'read', 'View', id);
  return row;
}

export async function getView(ctx: ServiceContext, id: string): Promise<View> {
  return toView(await visibleViewRow(ctx, id));
}

export async function createView(
  ctx: ServiceContext,
  projectRef: string,
  input: CreateViewInput,
): Promise<View> {
  const data = parseInput(CreateViewInputSchema, input);
  return withWriteTx(ctx.db, async (tx) => {
    // Personal views only need read access; shared views change the project for everyone.
    const project = await getProjectRow(ctx, tx, projectRef, data.shared ? 'manage' : 'read');
    // Anonymous actors own nothing, so even personal views need a signed-in user.
    if (isAnonymous(ctx)) throw new DomainError('UNAUTHENTICATED', 'Sign in to make changes');
    const count = await tx
      .selectFrom('views')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('project_id', '=', project.id)
      .executeTakeFirstOrThrow();
    const now = nowIso(ctx);
    const row = await tx
      .insertInto('views')
      .values({
        id: ctx.ids('view'),
        project_id: project.id,
        owner_id: data.shared ? null : ctx.actor.id,
        name: data.name,
        layout: data.layout,
        config: toJson(data.config ?? defaultViewConfig(data.layout)),
        position: Number(count.n),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toView(row);
  });
}

export async function updateView(
  ctx: ServiceContext,
  id: string,
  input: UpdateViewInput,
): Promise<View> {
  const patch = parseInput(UpdateViewInputSchema, input);
  return withWriteTx(ctx.db, async (tx) => {
    const row = await visibleViewRow(ctx, id, tx);
    if (row.owner_id === null)
      await requireProjectId(ctx, tx, row.project_id, 'manage', 'View', id);
    const updated = await tx
      .updateTable('views')
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.config !== undefined && { config: toJson(patch.config) }),
        ...(patch.position !== undefined && { position: patch.position }),
        updated_at: nowIso(ctx),
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toView(updated);
  });
}

export async function deleteView(ctx: ServiceContext, id: string): Promise<View> {
  return withWriteTx(ctx.db, async (tx) => {
    const row = await visibleViewRow(ctx, id, tx);
    if (row.owner_id === null)
      await requireProjectId(ctx, tx, row.project_id, 'manage', 'View', id);
    if (row.owner_id === null && ctx.actor.role !== 'admin') {
      const others = await tx
        .selectFrom('views')
        .select('id')
        .where('project_id', '=', row.project_id)
        .where('owner_id', 'is', null)
        .where('id', '!=', row.id)
        .execute();
      if (others.length === 0) throw forbidden('Cannot delete the last shared view of a project');
    }
    await tx.deleteFrom('views').where('id', '=', row.id).execute();
    return toView(row);
  });
}
