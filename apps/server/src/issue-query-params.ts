import { DomainError } from '@tracker/core';
import {
  FILTER_OPS,
  type FilterCondition,
  type FilterOp,
  type IssueFilter,
  IssueFilterSchema,
  SORTABLE_FIELDS,
  type SortSpec,
} from '@tracker/schema';

/** Query parameters with a fixed meaning (everything else is a filter condition). */
const RESERVED = new Set(['limit', 'cursor', 'sort', 'includeDeleted', 'filter', 'q']);

/** Friendly aliases for filter field names in query strings. */
const ALIASES: Record<string, string> = { label: 'labels', cf: 'cf' };

/**
 * Parses list query parameters into an IssueFilter:
 *
 * - `field=a,b`       → `in` (or `eq` for a single value), e.g. `status=Todo,In Progress`, `assignee=me,none`
 * - `field.op=value`  → any operator, e.g. `priority.gte=2`, `dueDate.isNull=true`, `title.contains=crash`
 * - `cf.<key>=…`      → custom field `cf:<key>` (also with `.op`)
 * - `q=text`          → text search over key, title and description
 * - `filter=<json>`   → a full IssueFilter (conditions are ANDed with the ones above)
 */
export function parseIssueQuery(url: URL): {
  filter: IssueFilter;
  sort: SortSpec[] | undefined;
  limit: number | undefined;
  cursor: string | undefined;
  includeDeleted: boolean;
} {
  const params = url.searchParams;
  const conditions: FilterCondition[] = [];

  const raw = params.get('filter');
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'filter must be JSON (an IssueFilter)');
    }
    const result = IssueFilterSchema.safeParse(parsed);
    if (!result.success)
      throw new DomainError('VALIDATION_FAILED', `Invalid filter: ${result.error.message}`);
    conditions.push(...result.data.conditions);
  }
  const q = params.get('q');
  if (q) conditions.push({ field: 'text', op: 'contains', value: q });

  for (const [name, value] of params) {
    if (RESERVED.has(name)) continue;
    let parts = name.split('.');
    let field: string;
    if (parts[0] === 'cf') {
      if (parts.length < 2)
        throw new DomainError('VALIDATION_FAILED', `Use cf.<key> for custom fields, not "${name}"`);
      field = `cf:${parts[1]}`;
      parts = parts.slice(1);
    } else {
      field = ALIASES[parts[0]!] ?? parts[0]!;
    }
    const op = parts[1] as FilterOp | undefined;
    if (op !== undefined && !FILTER_OPS.includes(op))
      throw new DomainError(
        'VALIDATION_FAILED',
        `Unknown operator "${op}" in "${name}" (use ${FILTER_OPS.join(', ')})`,
      );
    const list = () =>
      value.split(',').map((v) => (v.trim() === 'none' || v.trim() === 'null' ? null : v.trim()));
    if (op === undefined) {
      const values = list();
      conditions.push(
        values.length === 1 && values[0] !== null
          ? { field, op: 'eq', value: values[0]! }
          : values.length === 1
            ? { field, op: 'isNull', value: true }
            : { field, op: 'in', value: values },
      );
    } else if (op === 'in' || op === 'nin') {
      conditions.push({ field, op, value: list() });
    } else if (op === 'isNull') {
      conditions.push({ field, op, value: value !== 'false' });
    } else {
      conditions.push({ field, op, value });
    }
  }

  const sortParam = params.get('sort');
  const sort = sortParam ? parseSort(sortParam) : undefined;
  const limitParam = params.get('limit');
  const limit = limitParam === null ? undefined : Number(limitParam);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200))
    throw new DomainError('VALIDATION_FAILED', 'limit must be an integer between 1 and 200');

  return {
    filter: { conditions },
    sort,
    limit,
    cursor: params.get('cursor') ?? undefined,
    includeDeleted: params.get('includeDeleted') === 'true',
  };
}

/** `-updatedAt,priority` → [{updatedAt desc}, {priority asc}] */
export function parseSort(value: string): SortSpec[] {
  return value.split(',').map((part) => {
    const desc = part.startsWith('-');
    const field = part.replace(/^[-+]/, '').trim();
    if (!(SORTABLE_FIELDS as readonly string[]).includes(field))
      throw new DomainError(
        'VALIDATION_FAILED',
        `Cannot sort by "${field}" (sortable: ${SORTABLE_FIELDS.join(', ')})`,
      );
    return { field, dir: desc ? 'desc' : 'asc' };
  });
}
