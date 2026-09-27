import type { QueryClient } from '@tanstack/svelte-query';
import {
  api,
  call,
  type CreateIssueInput,
  errorMessage,
  type Issue,
  type UpdateIssueInput,
} from './api.ts';
import { keys } from './queries.ts';
import { toast } from './toast.svelte.ts';

export const projectKeyOf = (issueKey: string) => issueKey.split('-')[0]!;

/** Writes an issue snapshot into the detail cache and every cached list that contains it. */
export function upsertIssue(qc: QueryClient, issue: Issue) {
  qc.setQueryData(keys.issue(issue.key), issue);
  for (const [key, list] of qc.getQueriesData<Issue[]>({
    queryKey: keys.issueLists(projectKeyOf(issue.key)),
  })) {
    if (list?.some((i) => i.id === issue.id))
      qc.setQueryData(
        key,
        list.map((i) => (i.id === issue.id ? issue : i)),
      );
  }
  for (const [key, list] of qc.getQueriesData<Issue[]>({ queryKey: ['children'] })) {
    if (list?.some((i) => i.id === issue.id))
      qc.setQueryData(
        key,
        list.map((i) => (i.id === issue.id ? issue : i)),
      );
  }
}

function snapshot(qc: QueryClient, issue: Issue) {
  const detail = qc.getQueryData<Issue>(keys.issue(issue.key));
  const lists = qc.getQueriesData<Issue[]>({ queryKey: keys.issueLists(projectKeyOf(issue.key)) });
  return () => {
    qc.setQueryData(keys.issue(issue.key), detail);
    for (const [key, data] of lists) qc.setQueryData(key, data);
  };
}

function afterChange(qc: QueryClient, issue: Issue) {
  void qc.invalidateQueries({ queryKey: keys.activity(issue.key) });
  void qc.invalidateQueries({ queryKey: keys.issueLists(projectKeyOf(issue.key)) });
  if (issue.parent) void qc.invalidateQueries({ queryKey: keys.children(issue.parent.key) });
}

/**
 * PATCHes an issue. `optimistic` fields are applied to caches immediately and rolled back on failure.
 * Returns the server's issue, or undefined if the update failed (an error toast is shown).
 */
export async function updateIssue(
  qc: QueryClient,
  issue: Issue,
  patch: UpdateIssueInput,
  optimistic?: Partial<Issue>,
): Promise<Issue | undefined> {
  const rollback = snapshot(qc, issue);
  if (optimistic) upsertIssue(qc, { ...issue, ...optimistic });
  try {
    const updated = await call(
      api.PATCH('/issues/{issue}', { params: { path: { issue: issue.key } }, body: patch }),
    );
    upsertIssue(qc, updated);
    afterChange(qc, updated);
    return updated;
  } catch (error) {
    rollback();
    toast(`Couldn't update ${issue.key}: ${errorMessage(error)}`, 'error');
    return undefined;
  }
}

export interface MovePlacement {
  status?: string;
  afterId?: string | null;
  beforeId?: string | null;
  position?: 'top' | 'bottom';
}

/** Moves an issue on the board (status + position). Optimistic fields are applied first. */
export async function moveIssue(
  qc: QueryClient,
  issue: Issue,
  placement: MovePlacement,
  optimistic?: Partial<Issue>,
): Promise<Issue | undefined> {
  const rollback = snapshot(qc, issue);
  if (optimistic) upsertIssue(qc, { ...issue, ...optimistic });
  try {
    const moved = await call(
      api.POST('/issues/{issue}/move', { params: { path: { issue: issue.key } }, body: placement }),
    );
    upsertIssue(qc, moved);
    afterChange(qc, moved);
    return moved;
  } catch (error) {
    rollback();
    toast(`Couldn't move ${issue.key}: ${errorMessage(error)}`, 'error');
    return undefined;
  }
}

export async function createIssue(
  qc: QueryClient,
  project: string,
  input: CreateIssueInput,
): Promise<Issue | undefined> {
  try {
    const issue = await call(
      api.POST('/projects/{project}/issues', { params: { path: { project } }, body: input }),
    );
    qc.setQueryData(keys.issue(issue.key), issue);
    afterChange(qc, issue);
    return issue;
  } catch (error) {
    toast(`Couldn't create the issue: ${errorMessage(error)}`, 'error');
    return undefined;
  }
}

export async function deleteIssue(qc: QueryClient, issue: Issue): Promise<Issue | undefined> {
  try {
    const deleted = await call(
      api.DELETE('/issues/{issue}', { params: { path: { issue: issue.key }, query: {} } }),
    );
    upsertIssue(qc, deleted);
    afterChange(qc, deleted);
    toast(`${issue.key} moved to the trash`, 'info', {
      label: 'Undo',
      run: () => void restoreIssue(qc, deleted),
    });
    return deleted;
  } catch (error) {
    toast(`Couldn't delete ${issue.key}: ${errorMessage(error)}`, 'error');
    return undefined;
  }
}

export async function restoreIssue(qc: QueryClient, issue: Issue): Promise<Issue | undefined> {
  try {
    const restored = await call(
      api.POST('/issues/{issue}/restore', { params: { path: { issue: issue.key } } }),
    );
    upsertIssue(qc, restored);
    afterChange(qc, restored);
    return restored;
  } catch (error) {
    toast(`Couldn't restore ${issue.key}: ${errorMessage(error)}`, 'error');
    return undefined;
  }
}
