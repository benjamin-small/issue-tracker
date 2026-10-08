import { testDialect } from '@poietic-tech/issues-db/testing';
import {
  compareIssues,
  type FilterCondition,
  type Issue,
  type IssueFilter,
  matchesFilter,
  type SortSpec,
  FieldRegistry,
} from '@poietic-tech/issues-schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCustomField,
  createIssue,
  createLabel,
  createProject,
  listCustomFields,
  listIssues,
  listStatuses,
} from './index.ts';
import { createTestContext, type TestContext } from './testing.ts';

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let t: TestContext;
let issues: Issue[];
let statusIds: string[];
let labelIds: string[];
let registry: FieldRegistry;
const rand = prng(20260926);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const WORDS = [
  'Crash',
  'crash',
  'Login',
  'API',
  'slow',
  'Board',
  '100%',
  'under_score',
  'Ünïcode',
  'Fix',
];

beforeAll(async () => {
  t = await createTestContext();
  await createProject(t.ctx, { key: 'PROP', name: 'Property' });
  for (const name of ['a', 'b', 'c']) await createLabel(t.ctx, 'PROP', { name });
  await createCustomField(t.ctx, 'PROP', {
    key: 'sev',
    name: 'Sev',
    type: 'select',
    options: [{ value: 'lo' }, { value: 'hi' }],
  });
  await createCustomField(t.ctx, 'PROP', { key: 'pts', name: 'Pts', type: 'number' });
  await createCustomField(t.ctx, 'PROP', { key: 'ok', name: 'Ok', type: 'boolean' });
  await createCustomField(t.ctx, 'PROP', {
    key: 'tags',
    name: 'Tags',
    type: 'multi_select',
    options: [{ value: 'x' }, { value: 'y' }],
  });
  await createCustomField(t.ctx, 'PROP', { key: 'memo', name: 'Memo', type: 'text' });
  registry = new FieldRegistry(await listCustomFields(t.ctx, 'PROP'));
  statusIds = (await listStatuses(t.ctx, 'PROP')).map((s) => s.id);
  labelIds = [];
  const created: Issue[] = [];
  for (let n = 0; n < 45; n++) {
    const labels = ['a', 'b', 'c'].filter(() => rand() < 0.35);
    const issue = await createIssue(t.ctx, 'PROP', {
      title: `${pick(WORDS)} ${pick(WORDS)} ${n}`,
      description: rand() < 0.5 ? `details ${pick(WORDS)}` : '',
      status: pick(statusIds),
      priority: Math.floor(rand() * 5),
      assignee: pick([null, 'admin', 'member', 'bot']),
      labels,
      estimate: rand() < 0.3 ? null : Math.round(rand() * 80) / 8,
      customFields: {
        ...(rand() < 0.7 && { sev: pick(['lo', 'hi']) }),
        ...(rand() < 0.7 && { pts: Math.round(rand() * 10) }),
        ...(rand() < 0.6 && { ok: rand() < 0.5 }),
        ...(rand() < 0.6 && { tags: ['x', 'y'].filter(() => rand() < 0.5) }),
        ...(rand() < 0.6 && { memo: pick(WORDS) }),
      },
      dueDate:
        rand() < 0.4
          ? null
          : `2026-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-1${Math.floor(rand() * 9)}`,
    });
    created.push(issue);
  }
  issues = created;
  labelIds = [...new Set(issues.flatMap((i) => i.labelIds))];
});
afterAll(() => t.destroy());

function randomCondition(): FilterCondition {
  const users = [t.admin.id, 'me', null, issues[0]!.creatorId as string];
  const gens: Array<() => FilterCondition> = [
    () => ({ field: 'cf:sev', op: pick(['eq', 'neq'] as const), value: pick(['lo', 'hi']) }),
    () => ({
      field: 'cf:sev',
      op: pick(['in', 'nin'] as const),
      value: ['lo', 'hi', null].filter(() => rand() < 0.5),
    }),
    () => ({ field: 'cf:sev', op: 'isNull', value: rand() < 0.5 }),
    () => ({
      field: 'cf:pts',
      op: pick(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const),
      value: Math.round(rand() * 10),
    }),
    () => ({ field: 'cf:pts', op: 'isNull', value: rand() < 0.5 }),
    () => ({ field: 'cf:ok', op: 'eq', value: rand() < 0.5 }),
    () => ({ field: 'cf:ok', op: 'isNull', value: rand() < 0.5 }),
    () => ({ field: 'cf:tags', op: pick(['eq', 'neq'] as const), value: pick(['x', 'y']) }),
    () => ({
      field: 'cf:tags',
      op: pick(['in', 'nin'] as const),
      value: ['x', 'y'].filter(() => rand() < 0.5),
    }),
    () => ({ field: 'cf:tags', op: 'isNull', value: rand() < 0.5 }),
    () => ({
      field: 'cf:memo',
      op: pick(['eq', 'neq', 'contains'] as const),
      value: pick(['crash', 'Crash', 'API', 'ash']),
    }),
    () => ({ field: 'status', op: pick(['eq', 'neq'] as const), value: pick(statusIds) }),
    () => ({
      field: 'status',
      op: pick(['in', 'nin'] as const),
      value: statusIds.filter(() => rand() < 0.4),
    }),
    () => ({
      field: 'statusCategory',
      op: pick(['eq', 'neq'] as const),
      value: pick(['started', 'backlog', 'completed']),
    }),
    () => ({
      field: 'statusCategory',
      op: pick(['in', 'nin'] as const),
      value: ['backlog', 'completed', 'started'].filter(() => rand() < 0.5),
    }),
    () => ({
      field: 'priority',
      op: pick(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const),
      value: Math.floor(rand() * 5),
    }),
    () => ({
      field: 'priority',
      op: pick(['in', 'nin'] as const),
      value: [0, 1, 2, 3, 4].filter(() => rand() < 0.4),
    }),
    () => ({ field: 'assignee', op: 'isNull', value: rand() < 0.5 }),
    () => ({
      field: 'assignee',
      op: pick(['in', 'nin'] as const),
      value: users.filter(() => rand() < 0.5),
    }),
    () => ({
      field: 'assignee',
      op: pick(['eq', 'neq'] as const),
      value: pick([t.admin.id, 'me']),
    }),
    () => ({ field: 'labels', op: pick(['eq', 'neq'] as const), value: pick(labelIds) }),
    () => ({
      field: 'labels',
      op: pick(['in', 'nin'] as const),
      value: labelIds.filter(() => rand() < 0.5),
    }),
    () => ({ field: 'labels', op: 'isNull', value: rand() < 0.5 }),
    () => ({
      field: 'estimate',
      op: pick(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const),
      value: Math.round(rand() * 80) / 8,
    }),
    () => ({ field: 'estimate', op: 'isNull', value: rand() < 0.5 }),
    () => ({
      field: 'dueDate',
      op: pick(['gt', 'lte'] as const),
      value: `2026-0${1 + Math.floor(rand() * 9)}-15`,
    }),
    () => ({ field: 'dueDate', op: 'isNull', value: rand() < 0.5 }),
    () => ({
      field: 'title',
      op: 'contains',
      value: pick(['crash', 'CRASH', 'api', '100%', 'under_', '_', 'x']),
    }),
    () => ({ field: 'text', op: 'contains', value: pick(['prop-1', 'details', 'fix', 'slow ']) }),
    () => ({ field: 'key', op: 'eq', value: pick(issues).key }),
    () => ({ field: 'createdAt', op: pick(['gt', 'lt'] as const), value: pick(issues).createdAt }),
  ];
  return pick(gens)();
}

describe(`filter & sort parity: SQL vs matchesFilter (${testDialect()})`, () => {
  it('agrees on 300 random filters', async () => {
    for (let round = 0; round < 300; round++) {
      const filter: IssueFilter = {
        conditions: Array.from({ length: 1 + Math.floor(rand() * 2) }, randomCondition),
      };
      const sql = await listIssues(t.ctx, { project: 'PROP', filter, limit: 200 });
      const expected = issues
        .filter((i) => matchesFilter(i, filter, { meId: t.admin.id, registry }))
        .map((i) => i.id)
        .sort();
      expect({ filter, ids: sql.data.map((i) => i.id).sort() }).toEqual({ filter, ids: expected });
    }
  });

  it('agrees on sort order for every sortable field', async () => {
    const fields = ['priority', 'dueDate', 'estimate', 'title', 'key', 'createdAt', 'rank'];
    for (let round = 0; round < 40; round++) {
      const sort: SortSpec[] = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
        field: pick(fields),
        dir: pick(['asc', 'desc'] as const),
      }));
      const sql = (await listIssues(t.ctx, { project: 'PROP', sort, limit: 200 })).data.map(
        (i) => i.id,
      );
      const expected = [...issues].sort(compareIssues(sort)).map((i) => i.id);
      expect({ sort, sql }).toEqual({ sort, sql: expected });
    }
  });
});
