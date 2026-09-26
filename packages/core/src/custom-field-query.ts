import { type Database, type Kysely, type RawBuilder, sql, toBool } from '@tracker/db';
import {
  CUSTOM_FIELD_PREFIX,
  type CustomFieldLike,
  type CustomFieldValue,
  FieldRegistry,
  type FilterCondition,
} from '@tracker/schema';
import { scalarCondition, setCondition } from './issue-query.ts';

type Exec = Kysely<Database>;

/** Field registry for a project (core fields + its active custom fields); core-only without a project. */
export async function projectFieldRegistry(
  db: Exec,
  projectId: string | undefined,
): Promise<FieldRegistry> {
  if (!projectId) return new FieldRegistry();
  const rows = await db
    .selectFrom('custom_fields')
    .select(['key', 'name', 'type'])
    .where('project_id', '=', projectId)
    .where('archived_at', 'is', null)
    .orderBy('position')
    .execute();
  return new FieldRegistry(rows satisfies CustomFieldLike[]);
}

/** Custom field values for issues, keyed by issue id then field key (API representation). */
export async function loadCustomFieldValues(
  db: Exec,
  issueIds: string[],
): Promise<Map<string, Record<string, CustomFieldValue>>> {
  const out = new Map<string, Record<string, CustomFieldValue>>();
  if (issueIds.length === 0) return out;
  const rows = await db
    .selectFrom('issue_field_values as v')
    .innerJoin('custom_fields as f', 'f.id', 'v.field_id')
    .leftJoin('custom_field_options as o', 'o.id', 'v.v_option_id')
    .select([
      'v.issue_id',
      'f.key',
      'f.type',
      'v.v_text',
      'v.v_number',
      'v.v_date',
      'v.v_bool',
      'v.v_user_id',
      'o.value as option_value',
      'o.position as option_position',
    ])
    .where('v.issue_id', 'in', issueIds)
    .where('f.archived_at', 'is', null)
    .orderBy('o.position')
    .execute();
  for (const r of rows) {
    const values = out.get(r.issue_id) ?? {};
    switch (r.type) {
      case 'text':
      case 'url':
        values[r.key] = r.v_text;
        break;
      case 'number':
        values[r.key] = r.v_number;
        break;
      case 'date':
        values[r.key] = r.v_date;
        break;
      case 'boolean':
        values[r.key] = r.v_bool === null ? null : toBool(r.v_bool);
        break;
      case 'user':
        values[r.key] = r.v_user_id;
        break;
      case 'select':
        values[r.key] = r.option_value;
        break;
      case 'multi_select': {
        const current = (values[r.key] as string[] | undefined) ?? [];
        if (r.option_value !== null) current.push(r.option_value);
        values[r.key] = current;
        break;
      }
    }
    out.set(r.issue_id, values);
  }
  return out;
}

const VALUE_COLUMN: Record<string, string> = {
  text: 'v.v_text',
  url: 'v.v_text',
  number: 'v.v_number',
  date: 'v.v_date',
  boolean: 'v.v_bool',
  user: 'v.v_user_id',
};

/** Compiles a `cf:<key>` condition, or returns null for non-custom fields. Mirrors `customFieldDescriptor.get`. */
export function customFieldSql(
  c: FilterCondition,
  registry: FieldRegistry,
): RawBuilder<boolean> | null {
  if (!c.field.startsWith(CUSTOM_FIELD_PREFIX)) return null;
  const d = registry.get(c.field);
  if (!d) return null;
  const key = c.field.slice(CUSTOM_FIELD_PREFIX.length);
  const from = sql`issue_field_values v join custom_fields f on f.id = v.field_id and f.project_id = i.project_id and f.key = ${key}`;

  if (d.type === 'multiSelect') {
    return setCondition(
      (vals) =>
        vals === null
          ? sql<boolean>`exists (select 1 from ${from} where v.issue_id = i.id)`
          : vals.length === 0
            ? sql<boolean>`1 = 0`
            : sql<boolean>`exists (select 1 from ${from} join custom_field_options o on o.id = v.v_option_id where v.issue_id = i.id and o.value in (${sql.join(vals.map((v) => sql`${v}`))}))`,
      c.op,
      c.value,
    );
  }
  const column =
    d.type === 'select'
      ? sql`(select o.value from ${from} join custom_field_options o on o.id = v.v_option_id where v.issue_id = i.id)`
      : sql`(select ${sql.ref(VALUE_COLUMN[d.type === 'url' ? 'url' : d.type]!)} from ${from} where v.issue_id = i.id)`;
  return scalarCondition(column, c.op, c.value);
}
