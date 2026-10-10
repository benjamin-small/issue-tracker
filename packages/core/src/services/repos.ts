import { sql, withWriteTx, type Database, type Kysely } from '@poietic-tech/issues-db';
import {
  type AddProjectRepoInput,
  AddProjectRepoInputSchema,
  isIdOf,
  type ProjectRepo,
} from '@poietic-tech/issues-schema';
import { nowIso, type ServiceContext } from '../context.ts';
import { conflict, isUniqueViolation, notFound, parseInput } from '../errors.ts';
import { recordEvent } from '../events.ts';
import { getProjectRow, parseRepoRef } from '../refs.ts';
import { clearIssueRepo } from './issues.ts';

type Exec = Kysely<Database>;
export function toRepo(r: {
  id: string;
  owner: string;
  name: string;
  created_at: string;
}): ProjectRepo {
  const fullName = `${r.owner}/${r.name}`;
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    fullName,
    url: `https://github.com/${fullName}`,
    createdAt: r.created_at,
  };
}

/** Repos for several projects in one query, each list ordered by owner then name (case-insensitive). */
export async function reposOf(db: Exec, projectIds: string[]): Promise<Map<string, ProjectRepo[]>> {
  const out = new Map<string, ProjectRepo[]>(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return out;
  const rows = await db
    .selectFrom('project_repos')
    .selectAll()
    .where('project_id', 'in', projectIds)
    .orderBy(sql`lower(owner)`)
    .orderBy(sql`lower(name)`)
    .execute();
  for (const r of rows) out.get(r.project_id)?.push(toRepo(r));
  return out;
}

/** Finds a project's repo by `rpo_` id or by `owner/name` (case-insensitive). */
export async function findRepo(db: Exec, projectId: string, ref: string) {
  const q = db.selectFrom('project_repos').selectAll().where('project_id', '=', projectId);
  if (isIdOf('projectRepo', ref)) return q.where('id', '=', ref).executeTakeFirst();
  const { owner, name } = parseRepoRef(ref);
  return q
    .where(sql`lower(owner)`, '=', owner.toLowerCase())
    .where(sql`lower(name)`, '=', name.toLowerCase())
    .executeTakeFirst();
}

/** Links a GitHub repository to a project. Managers only; CONFLICT if it is already linked. */
export async function addRepo(
  ctx: ServiceContext,
  projectRef: string,
  input: AddProjectRepoInput,
): Promise<ProjectRepo> {
  const data = parseInput(AddProjectRepoInputSchema, input);
  const { owner, name } = parseRepoRef(data.repo);
  try {
    return await withWriteTx(ctx.db, async (tx) => {
      const project = await getProjectRow(ctx, tx, projectRef, 'manage');
      const row = await tx
        .insertInto('project_repos')
        .values({
          id: ctx.ids('projectRepo'),
          project_id: project.id,
          owner,
          name,
          created_at: nowIso(ctx),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const repo = toRepo(row);
      await recordEvent(tx, ctx, 'project.repo_added', { projectId: project.id, data: { repo } });
      return repo;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`${owner}/${name} is already linked to this project`);
    throw error;
  }
}

/** Unlinks a repository (`rpo_` id or `owner/name`) and clears it from issues that used it. Managers only. */
export async function removeRepo(
  ctx: ServiceContext,
  projectRef: string,
  repoRef: string,
): Promise<void> {
  await withWriteTx(ctx.db, async (tx) => {
    const project = await getProjectRow(ctx, tx, projectRef, 'manage');
    const row = await findRepo(tx, project.id, repoRef);
    if (!row) throw notFound('Repository', repoRef);
    const issueIds = (
      await tx.selectFrom('issues').select('id').where('repo_id', '=', row.id).execute()
    ).map((r) => r.id);
    // Clear through the issue update path so each change records issue.updated.
    for (const id of issueIds) await clearIssueRepo(ctx, tx, id);
    await tx.deleteFrom('project_repos').where('id', '=', row.id).execute();
    await recordEvent(tx, ctx, 'project.repo_removed', {
      projectId: project.id,
      data: { repo: toRepo(row) },
    });
  });
}
