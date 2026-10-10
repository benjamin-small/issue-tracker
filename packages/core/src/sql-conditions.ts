import { likeContains, type RawBuilder, sql } from '@poietic-tech/issues-db';
import { validationError } from './errors.ts';

/**
 * SQL for filter operators, shared by the built-in issue fields (`issue-query.ts`) and custom fields
 * (`custom-field-query.ts`). Must mirror `evaluateCondition` in @poietic-tech/issues-schema exactly.
 */

type Bool = RawBuilder<boolean>;
export type Value = string | number | boolean | null;

export function list(values: Value[]) {
  return sql.join(values.map((v) => sql`${v}`));
}

/** SQL for one operator on a scalar expression, with the same null semantics as `evaluateCondition`. */
export function scalarCondition(col: RawBuilder<unknown>, op: string, value: unknown): Bool {
  switch (op) {
    case 'eq':
      return sql<boolean>`${col} = ${value}`;
    case 'neq':
      return sql<boolean>`(${col} is null or ${col} <> ${value})`;
    case 'in':
    case 'nin': {
      const all = value as Value[];
      const vals = all.filter((v) => v !== null);
      const hasNull = vals.length !== all.length;
      if (op === 'in') {
        const parts: Bool[] = [];
        if (vals.length) parts.push(sql<boolean>`${col} in (${list(vals)})`);
        if (hasNull) parts.push(sql<boolean>`${col} is null`);
        return parts.length ? sql<boolean>`(${sql.join(parts, sql` or `)})` : sql<boolean>`1 = 0`;
      }
      const notIn = vals.length ? sql<boolean>`${col} not in (${list(vals)})` : sql<boolean>`1 = 1`;
      return hasNull
        ? sql<boolean>`(${col} is not null and ${notIn})`
        : sql<boolean>`(${col} is null or ${notIn})`;
    }
    case 'isNull':
      return value ? sql<boolean>`${col} is null` : sql<boolean>`${col} is not null`;
    case 'contains':
      return sql<boolean>`lower(${col}) like lower(${likeContains(String(value))}) escape '\\'`;
    case 'gt':
      return sql<boolean>`${col} > ${value}`;
    case 'gte':
      return sql<boolean>`${col} >= ${value}`;
    case 'lt':
      return sql<boolean>`${col} < ${value}`;
    case 'lte':
      return sql<boolean>`${col} <= ${value}`;
    default:
      throw validationError(`Unsupported operator "${op}"`);
  }
}

/** SQL for set-valued fields ("has"), given an EXISTS builder over a list of candidate values. */
export function setCondition(
  exists: (values: Value[] | null) => Bool,
  op: string,
  value: unknown,
): Bool {
  const vals = (Array.isArray(value) ? value : [value]).filter(
    (v): v is string => v !== null && v !== undefined,
  );
  switch (op) {
    case 'eq':
      return exists(vals);
    case 'neq':
      return sql<boolean>`not ${exists(vals)}`;
    case 'in':
      return vals.length ? exists(vals) : sql<boolean>`1 = 0`;
    case 'nin':
      return vals.length ? sql<boolean>`not ${exists(vals)}` : sql<boolean>`1 = 1`;
    case 'isNull':
      return value ? sql<boolean>`not ${exists(null)}` : exists(null);
    default:
      throw validationError(`Unsupported operator "${op}" for a set field`);
  }
}
