import { z } from 'zod';
import type { Issue } from './entities.ts';
import { FILTER_OPS, type FieldDescriptor, FieldRegistry, type FilterOp } from './fields.ts';

/**
 * `IssueFilter`: a small, serializable filter language shared by saved views, `POST /issues/search`,
 * list query parameters, the CLI (`--filter-json`) and client-side cache patching.
 *
 * v1 semantics: every condition must match (AND). Use `in` for OR within one field.
 * Field keys come from the field registry (`status`, `assignee`, `labels`, `cf:severity`, …).
 * The value `"me"` in user fields resolves to the current actor.
 */
export const FilterOpSchema = z.enum(FILTER_OPS);

export const FilterConditionSchema = z
  .object({
    field: z.string().meta({ description: 'Field registry key.', example: 'status' }),
    op: FilterOpSchema,
    value: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number(), z.null()])),
      ])
      .optional()
      .meta({ description: 'Scalar, array (for in/nin), or boolean (for isNull).' }),
  })
  .meta({ id: 'FilterCondition' });
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export const IssueFilterSchema = z
  .object({
    conditions: z.array(FilterConditionSchema).max(50).default([]),
  })
  .meta({
    id: 'IssueFilter',
    description: 'All conditions must match (AND).',
    example: {
      conditions: [
        { field: 'status', op: 'in', value: ['sts_…'] },
        { field: 'assignee', op: 'eq', value: 'me' },
      ],
    },
  });
export type IssueFilter = z.infer<typeof IssueFilterSchema>;

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const SortSpecSchema = z
  .object({
    field: z.string().meta({ example: 'updatedAt' }),
    dir: z.enum(SORT_DIRECTIONS).default('asc'),
  })
  .meta({ id: 'SortSpec' });
export type SortSpec = z.infer<typeof SortSpecSchema>;

export interface FilterContext {
  /** Current actor id, substituted for the value `"me"`. */
  meId?: string | null;
  registry?: FieldRegistry;
}

const NUMERIC_TYPES = new Set(['number', 'priority']);

function coerce(value: unknown, type: string): unknown {
  if (
    NUMERIC_TYPES.has(type) &&
    typeof value === 'string' &&
    value.trim() !== '' &&
    !Number.isNaN(Number(value))
  )
    return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

/**
 * Validates a filter against a registry (known fields, allowed operators, value shapes) and coerces
 * values to the field's type (e.g. `"2"` → `2` for priority, `"true"` → `true` for isNull).
 */
export function normalizeFilter(
  filter: IssueFilter,
  registry = new FieldRegistry(),
): { filter: IssueFilter; errors: string[] } {
  const errors: string[] = [];
  const conditions: FilterCondition[] = [];
  filter.conditions.forEach((c, i) => {
    const d = registry.get(c.field);
    if (!d) return errors.push(`conditions.${i}.field: unknown field "${c.field}"`);
    if (!d.filterOps.includes(c.op))
      return errors.push(
        `conditions.${i}.op: "${c.op}" is not supported for "${c.field}" (supported: ${d.filterOps.join(', ') || 'none'})`,
      );
    let value: FilterCondition['value'] = c.value;
    if (c.op === 'in' || c.op === 'nin') {
      if (!Array.isArray(value))
        return errors.push(`conditions.${i}.value: "${c.op}" needs an array`);
      value = value.map((v) => coerce(v, d.type) as string | number | null);
    } else if (c.op === 'isNull') {
      value = coerce(value, 'boolean') as boolean;
      if (typeof value !== 'boolean')
        return errors.push(`conditions.${i}.value: "isNull" needs true or false`);
    } else {
      if (Array.isArray(value) || value === undefined || value === null)
        return errors.push(
          `conditions.${i}.value: "${c.op}" needs a single non-null value (use isNull for nulls)`,
        );
      value = coerce(value, d.type) as string | number | boolean;
    }
    conditions.push({ field: c.field, op: c.op, value });
    return undefined;
  });
  return { filter: { conditions }, errors };
}

function resolveMe(value: unknown, d: FieldDescriptor, meId: string | null | undefined): unknown {
  if (d.type !== 'user') return value;
  const sub = (v: unknown) => (v === 'me' ? (meId ?? null) : v);
  return Array.isArray(value) ? value.map(sub) : sub(value);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Evaluates one operator against a field value. Mirrors the SQL compiler in @tracker/core exactly. */
export function evaluateCondition(actual: unknown, op: FilterOp, value: unknown): boolean {
  if (Array.isArray(actual)) {
    // Set-valued fields (labels, multi-select): "has".
    const set = actual as unknown[];
    switch (op) {
      case 'eq':
        return set.includes(value);
      case 'neq':
        return !set.includes(value);
      case 'in':
        return (value as unknown[]).some((v) => set.includes(v));
      case 'nin':
        return !(value as unknown[]).some((v) => set.includes(v));
      case 'isNull':
        return (set.length === 0) === value;
      default:
        return false;
    }
  }
  const v = actual === undefined ? null : actual;
  const isNull = v === null;
  switch (op) {
    case 'eq':
      return !isNull && v === value;
    case 'neq':
      return isNull || v !== value;
    case 'in':
      return (value as unknown[]).includes(v);
    case 'nin':
      return !(value as unknown[]).includes(v);
    case 'isNull':
      return isNull === value;
    case 'contains':
      return !isNull && asciiLower(String(v)).includes(asciiLower(String(value)));
    case 'gt':
      return !isNull && compare(v, value) > 0;
    case 'gte':
      return !isNull && compare(v, value) >= 0;
    case 'lt':
      return !isNull && compare(v, value) < 0;
    case 'lte':
      return !isNull && compare(v, value) <= 0;
  }
}

/** ASCII-only lowercase, matching SQLite's lower(). */
export function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Client-side evaluation of a filter against an issue snapshot (used for live cache patching). */
export function matchesFilter(issue: Issue, filter: IssueFilter, ctx: FilterContext = {}): boolean {
  const registry = ctx.registry ?? new FieldRegistry();
  return filter.conditions.every((c) => {
    const d = registry.get(c.field);
    if (!d) return false;
    return evaluateCondition(d.get(issue), c.op, resolveMe(c.value, d, ctx.meId));
  });
}

// ---- sorting ----

/** Sentinels that put nulls last and "no priority" after "low", identical to the SQL sort expressions. */
export const SORT_SENTINELS = {
  priorityNone: 5,
  dateMax: '9999-12-31',
  numberMax: 1e15,
} as const;

/** Comparable sort key for one field, matching the SQL expression used server-side. */
export function sortKey(issue: Issue, field: string): string | number {
  switch (field) {
    case 'priority':
      return issue.priority === 0 ? SORT_SENTINELS.priorityNone : issue.priority;
    case 'dueDate':
      return issue.dueDate ?? SORT_SENTINELS.dateMax;
    case 'estimate':
      return issue.estimate ?? SORT_SENTINELS.numberMax;
    case 'title':
      return asciiLower(issue.title);
    case 'key':
      return issue.number;
    case 'createdAt':
      return issue.createdAt;
    case 'updatedAt':
      return issue.updatedAt;
    case 'rank':
      return issue.rank;
    default:
      throw new Error(`Unsortable field "${field}"`);
  }
}

/** Comparator implementing a sort spec (ties broken by id ascending, like the server). */
export function compareIssues(sort: readonly SortSpec[]): (a: Issue, b: Issue) => number {
  return (a, b) => {
    for (const s of sort) {
      const c = compare(sortKey(a, s.field), sortKey(b, s.field));
      if (c !== 0) return s.dir === 'desc' ? -c : c;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export const SORTABLE_FIELDS = [
  'rank',
  'priority',
  'createdAt',
  'updatedAt',
  'dueDate',
  'estimate',
  'title',
  'key',
] as const;
