import type { Issue, User } from './api.ts';
import { PRIORITY_LABELS, PRIORITY_ORDER } from './format.ts';
import type { ProjectData } from './project-data.svelte.ts';

export type GroupHeaderSpec =
  | { kind: 'status'; label: string; category: string; color: string }
  | { kind: 'priority'; label: string; priority: number }
  | { kind: 'user'; label: string; user: User | null }
  | { kind: 'plain'; label: string };

const groupHeader = (spec: GroupHeaderSpec) => spec;

export interface IssueGroup {
  /** Group value: status id, priority number (string), user id, option value, or `__none__`. */
  id: string;
  label: string;
  issues: Issue[];
  header: GroupHeaderSpec;
}

export const NONE = '__none__';

/**
 * Splits issues into groups for a groupable field (list groups / board columns). Group order follows the
 * domain: statuses by position, priorities urgent→none, users alphabetically with "No assignee" first.
 */
export function groupIssues(
  issues: Issue[],
  groupBy: string | null,
  project: ProjectData,
  includeEmpty: boolean,
): IssueGroup[] {
  if (!groupBy)
    return [
      { id: 'all', label: 'All', issues, header: groupHeader({ kind: 'plain', label: 'All' }) },
    ];

  let groups: Array<Omit<IssueGroup, 'issues'> & { match: (i: Issue) => boolean }>;
  if (groupBy === 'status') {
    groups = project.statuses.map((s) => ({
      id: s.id,
      label: s.name,
      header: groupHeader({ kind: 'status', label: s.name, category: s.category, color: s.color }),
      match: (i) => i.statusId === s.id,
    }));
  } else if (groupBy === 'priority') {
    groups = PRIORITY_ORDER.map((p) => ({
      id: String(p),
      label: PRIORITY_LABELS[p],
      header: groupHeader({ kind: 'priority', label: PRIORITY_LABELS[p], priority: p }),
      match: (i) => i.priority === p,
    }));
  } else if (groupBy === 'assignee' || groupBy === 'creator') {
    const users = [...project.users].sort((a, b) => a.name.localeCompare(b.name));
    const field = groupBy === 'assignee' ? 'assigneeId' : 'creatorId';
    groups = [
      ...(groupBy === 'assignee'
        ? [
            {
              id: NONE,
              label: 'No assignee',
              header: groupHeader({ kind: 'user', label: 'No assignee', user: null }),
              match: (i: Issue) => i.assigneeId === null,
            },
          ]
        : []),
      ...users.map((u) => ({
        id: u.id,
        label: u.name,
        header: groupHeader({ kind: 'user', label: u.name, user: u }),
        match: (i: Issue) => i[field] === u.id,
      })),
    ];
  } else if (groupBy.startsWith('cf:')) {
    const key = groupBy.slice(3);
    const values = [
      ...new Set(
        issues
          .map((i) => i.customFields[key])
          .filter((v) => v !== null && v !== undefined)
          .map(String),
      ),
    ].sort();
    groups = [
      {
        id: NONE,
        label: 'None',
        header: groupHeader({ kind: 'plain', label: 'None' }),
        match: (i) => i.customFields[key] === null || i.customFields[key] === undefined,
      },
      ...values.map((v) => ({
        id: v,
        label: v,
        header: groupHeader({ kind: 'plain', label: v }),
        match: (i: Issue) => String(i.customFields[key]) === v,
      })),
    ];
  } else {
    return [
      { id: 'all', label: 'All', issues, header: groupHeader({ kind: 'plain', label: 'All' }) },
    ];
  }
  return groups
    .map(({ match, ...g }) => ({ ...g, issues: issues.filter(match) }))
    .filter((g) => includeEmpty || g.issues.length > 0);
}
