import { type Tx, withWriteTx } from '@poietic-tech/issues-db';
import {
  type CreateLinkInput,
  CreateLinkInputSchema,
  formatIssueKey,
  isIdOf,
  type IssueLink,
  type LinkType,
} from '@poietic-tech/issues-schema';
import { atLeast, projectLevel, readableProjectIds, requireLevel } from '../access.ts';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, invalidRelation, isUniqueViolation, notFound, parseInput } from '../errors.ts';
import { recordEvent } from '../events.ts';
import { toLinkType } from '../mappers.ts';
import { findProject, getIssueRow } from '../refs.ts';

export async function listLinkTypes(ctx: ServiceContext): Promise<LinkType[]> {
  const rows = await ctx.db.kysely.selectFrom('link_types').selectAll().orderBy('key').execute();
  return rows.map(toLinkType);
}

async function linkTypeRow(tx: Tx, ref: string) {
  const q = tx.selectFrom('link_types').selectAll();
  const row = isIdOf('linkType', ref)
    ? await q.where('id', '=', ref).executeTakeFirst()
    : await q.where('key', '=', ref.trim().toLowerCase()).executeTakeFirst();
  if (!row) {
    const keys = (await tx.selectFrom('link_types').select('key').execute()).map((r) => r.key);
    throw notFound('Link type', `${ref}" (known: ${keys.join(', ')})`.replace(/"$/, ''));
  }
  return row;
}

/** Links of an issue, each expressed from that issue's perspective ("blocks" vs "is blocked by"). */
export async function listIssueLinks(ctx: ServiceContext, issueRef: string): Promise<IssueLink[]> {
  const issue = await getIssueRow(ctx, ctx.db.kysely, issueRef, 'read');
  return linksOf(ctx, ctx.db.kysely, issue.id);
}

/** Links of an issue, leaving out those whose other end is in a project the actor cannot read. */
async function linksOf(ctx: ServiceContext, db: Tx, issueId: string): Promise<IssueLink[]> {
  const readable = await readableProjectIds(ctx, db);
  const rows = await db
    .selectFrom('issue_links as l')
    .innerJoin('link_types as t', 't.id', 'l.type_id')
    .innerJoin('issues as o', (join) =>
      join.on((eb) =>
        eb.or([
          eb.and([eb('l.source_id', '=', issueId), eb('o.id', '=', eb.ref('l.target_id'))]),
          eb.and([eb('l.target_id', '=', issueId), eb('o.id', '=', eb.ref('l.source_id'))]),
        ]),
      ),
    )
    .innerJoin('projects as p', 'p.id', 'o.project_id')
    .innerJoin('statuses as s', 's.id', 'o.status_id')
    .select([
      'l.id',
      'l.source_id',
      'l.created_at',
      't.key as type_key',
      't.outward_label',
      't.inward_label',
      'o.id as other_id',
      'o.number',
      'o.project_id as other_project_id',
      'o.title',
      'p.key as project_key',
      's.id as status_id',
      's.name as status_name',
      's.category as status_category',
      's.color as status_color',
    ])
    .where((eb) => eb.or([eb('l.source_id', '=', issueId), eb('l.target_id', '=', issueId)]))
    .where('o.deleted_at', 'is', null)
    .orderBy('t.key')
    .orderBy('l.created_at')
    .execute();
  const visible = rows.filter((r) => readable === 'all' || readable.includes(r.other_project_id));
  return visible.map((r) => {
    const outward = r.source_id === issueId;
    return {
      id: r.id,
      type: r.type_key,
      direction: outward ? 'outward' : 'inward',
      label: outward ? r.outward_label : r.inward_label,
      issue: {
        id: r.other_id,
        key: formatIssueKey(r.project_key, r.number),
        title: r.title,
        status: {
          id: r.status_id,
          name: r.status_name,
          category: r.status_category,
          color: r.status_color,
        },
      },
      createdAt: r.created_at,
    };
  });
}

async function refOf(tx: Tx, id: string) {
  const r = await tx
    .selectFrom('issues as i')
    .innerJoin('projects as p', 'p.id', 'i.project_id')
    .select(['i.id', 'i.number', 'i.title', 'p.key'])
    .where('i.id', '=', id)
    .executeTakeFirstOrThrow();
  return { id: r.id, key: formatIssueKey(r.key, r.number), title: r.title };
}

/**
 * Links two issues. `direction: "outward"` reads "<issue> <type> <target>" (e.g. ENG-1 blocks ENG-2);
 * `inward` reverses it. Symmetric types (relates) are stored once regardless of direction.
 */
export async function createLink(
  ctx: ServiceContext,
  issueRef: string,
  input: CreateLinkInput,
): Promise<IssueLink> {
  const data = parseInput(CreateLinkInputSchema, input);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const issue = await getIssueRow(ctx, tx, issueRef, 'write');
      const other = await getIssueRow(ctx, tx, data.target, 'read');
      if (issue.id === other.id) throw invalidRelation('An issue cannot link to itself');
      if (issue.deleted_at || other.deleted_at) throw invalidRelation('Cannot link deleted issues');
      const type = await linkTypeRow(tx, data.type);
      let [source, target] =
        data.direction === 'inward' ? [other.id, issue.id] : [issue.id, other.id];
      if (type.symmetric && source > target) [source, target] = [target, source];
      const existing = await tx
        .selectFrom('issue_links')
        .select('id')
        .where('type_id', '=', type.id)
        .where((eb) =>
          eb.or([
            eb.and([eb('source_id', '=', source), eb('target_id', '=', target)]),
            ...(type.symmetric
              ? [eb.and([eb('source_id', '=', target), eb('target_id', '=', source)])]
              : []),
          ]),
        )
        .executeTakeFirst();
      if (existing) throw conflict('These issues are already linked that way');
      const id = ctx.ids('issueLink');
      await tx
        .insertInto('issue_links')
        .values({
          id,
          type_id: type.id,
          source_id: source,
          target_id: target,
          created_by: ctx.actor.id,
          created_at: nowIso(ctx),
        })
        .execute();
      const link = {
        id,
        type: type.key,
        source: await refOf(tx, source),
        target: await refOf(tx, target),
      };
      await recordEvent(tx, ctx, 'link.created', {
        projectId: issue.project_id,
        issueId: source,
        data: { link },
      });
      const created = (await linksOf(ctx, tx, issue.id)).find((l) => l.id === id);
      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('These issues are already linked that way');
    throw error;
  }
}

/**
 * Deletes a link. Like creating one, it needs write access to one end and read access to the other: the actor
 * must be able to see the link (both ends readable, else NOT_FOUND, as in link lists) and write at least one end.
 */
export async function deleteLink(ctx: ServiceContext, linkId: string): Promise<void> {
  await withWriteTx(ctx.db, async (tx) => {
    const row = isIdOf('issueLink', linkId)
      ? await tx
          .selectFrom('issue_links as l')
          .innerJoin('link_types as t', 't.id', 'l.type_id')
          .innerJoin('issues as s', 's.id', 'l.source_id')
          .innerJoin('issues as d', 'd.id', 'l.target_id')
          .select([
            'l.id',
            'l.source_id',
            'l.target_id',
            't.key',
            's.project_id',
            'd.project_id as target_project_id',
          ])
          .where('l.id', '=', linkId)
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound('Link', linkId);
    const levels = await Promise.all(
      [row.project_id, row.target_project_id].map(async (id) => {
        const project = await findProject(tx, id);
        return project ? projectLevel(ctx, tx, project) : 'none';
      }),
    );
    if (levels.some((level) => !atLeast(level, 'read'))) throw notFound('Link', linkId);
    const best = levels.find((level) => atLeast(level, 'write')) ?? 'read';
    requireLevel(ctx, best, 'write', 'Link', linkId);
    const link = {
      id: row.id,
      type: row.key,
      source: await refOf(tx, row.source_id),
      target: await refOf(tx, row.target_id),
    };
    await tx.deleteFrom('issue_links').where('id', '=', row.id).execute();
    await recordEvent(tx, ctx, 'link.deleted', {
      projectId: row.project_id,
      issueId: row.source_id,
      data: { link },
    });
  });
}
