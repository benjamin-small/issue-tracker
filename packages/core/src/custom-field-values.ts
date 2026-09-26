import { type Tx } from '@tracker/db';
import type { CustomFieldValue } from '@tracker/schema';
import { type ServiceContext, nowIso } from './context.ts';
import { validationError } from './errors.ts';
import { findUser } from './refs.ts';

/** One resolved custom field assignment: API value plus the EAV rows that represent it. */
export interface ResolvedFieldValue {
  fieldId: string;
  key: string;
  value: CustomFieldValue;
  rows: Array<{
    v_text?: string;
    v_number?: number;
    v_date?: string;
    v_bool?: boolean;
    v_user_id?: string;
    v_option_id?: string;
  }>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Validates and resolves `customFields` input for an issue in `projectId`.
 * Accepts option values or ids for select fields, and user ids / handles / `me` for user fields.
 */
export async function resolveCustomFieldValues(
  tx: Tx,
  ctx: ServiceContext,
  projectId: string,
  input: Record<string, CustomFieldValue>,
): Promise<ResolvedFieldValue[]> {
  const keys = Object.keys(input);
  if (keys.length === 0) return [];
  const fields = await tx
    .selectFrom('custom_fields')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('archived_at', 'is', null)
    .execute();
  const options = fields.length
    ? await tx
        .selectFrom('custom_field_options')
        .selectAll()
        .where(
          'field_id',
          'in',
          fields.map((f) => f.id),
        )
        .where('archived_at', 'is', null)
        .orderBy('position')
        .execute()
    : [];

  const resolved: ResolvedFieldValue[] = [];
  for (const key of keys) {
    const raw = input[key]!;
    const field = fields.find((f) => f.key === key);
    const fail = (message: string) =>
      validationError(`customFields.${key}: ${message}`, [
        { path: `customFields.${key}`, message },
      ]);
    if (!field)
      throw fail(`unknown custom field (known: ${fields.map((f) => f.key).join(', ') || 'none'})`);
    const base = { fieldId: field.id, key };
    if (raw === null || (Array.isArray(raw) && raw.length === 0 && field.type === 'multi_select')) {
      resolved.push({ ...base, value: field.type === 'multi_select' ? [] : null, rows: [] });
      continue;
    }
    const fieldOptions = options.filter((o) => o.field_id === field.id);
    const findOption = (v: unknown) =>
      typeof v === 'string' ? fieldOptions.find((o) => o.value === v || o.id === v) : undefined;
    switch (field.type) {
      case 'text':
        if (typeof raw !== 'string' || raw.length > 10_000)
          throw fail('expected a string (max 10000 chars)');
        resolved.push({ ...base, value: raw, rows: [{ v_text: raw }] });
        break;
      case 'url': {
        if (!isHttpUrl(raw)) throw fail('expected an http(s) URL');
        resolved.push({ ...base, value: raw, rows: [{ v_text: raw as string }] });
        break;
      }
      case 'number':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) throw fail('expected a number');
        resolved.push({ ...base, value: raw, rows: [{ v_number: raw }] });
        break;
      case 'date':
        if (typeof raw !== 'string' || !DATE.test(raw) || Number.isNaN(Date.parse(raw)))
          throw fail('expected a date YYYY-MM-DD');
        resolved.push({ ...base, value: raw, rows: [{ v_date: raw }] });
        break;
      case 'boolean':
        if (typeof raw !== 'boolean') throw fail('expected true or false');
        resolved.push({ ...base, value: raw, rows: [{ v_bool: raw }] });
        break;
      case 'user': {
        const user = typeof raw === 'string' ? await findUser(ctx, tx, raw) : undefined;
        if (!user) throw fail(`unknown user "${String(raw)}"`);
        resolved.push({ ...base, value: user.id, rows: [{ v_user_id: user.id }] });
        break;
      }
      case 'select': {
        const option = findOption(raw);
        if (!option)
          throw fail(
            `unknown option "${String(raw)}" (options: ${fieldOptions.map((o) => o.value).join(', ')})`,
          );
        resolved.push({ ...base, value: option.value, rows: [{ v_option_id: option.id }] });
        break;
      }
      case 'multi_select': {
        const values = Array.isArray(raw) ? raw : [raw];
        const chosen: typeof fieldOptions = [];
        for (const v of values) {
          const option = findOption(v);
          if (!option)
            throw fail(
              `unknown option "${String(v)}" (options: ${fieldOptions.map((o) => o.value).join(', ')})`,
            );
          if (!chosen.includes(option)) chosen.push(option);
        }
        chosen.sort((a, b) => a.position - b.position);
        resolved.push({
          ...base,
          value: chosen.map((o) => o.value),
          rows: chosen.map((o) => ({ v_option_id: o.id })),
        });
        break;
      }
    }
  }
  return resolved;
}

/** Replaces the stored values of the given fields for an issue. */
export async function writeCustomFieldValues(
  tx: Tx,
  ctx: ServiceContext,
  issueId: string,
  values: ResolvedFieldValue[],
): Promise<void> {
  for (const v of values) {
    await tx
      .deleteFrom('issue_field_values')
      .where('issue_id', '=', issueId)
      .where('field_id', '=', v.fieldId)
      .execute();
    for (const row of v.rows) {
      await tx
        .insertInto('issue_field_values')
        .values({
          id: ctx.ids('fieldValue'),
          issue_id: issueId,
          field_id: v.fieldId,
          v_text: row.v_text ?? null,
          v_number: row.v_number ?? null,
          v_date: row.v_date ?? null,
          v_bool: row.v_bool ?? null,
          v_user_id: row.v_user_id ?? null,
          v_option_id: row.v_option_id ?? null,
          created_at: nowIso(ctx),
        })
        .execute();
    }
  }
}

/** True when a resolved value differs from the issue's current API value. */
export function customValueChanged(
  current: CustomFieldValue | undefined,
  next: CustomFieldValue,
): boolean {
  const norm = (v: CustomFieldValue | undefined) =>
    v === undefined ? null : Array.isArray(v) ? [...v].sort() : v;
  const a = norm(current);
  const b = norm(next);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length !== b.length || a.some((x, i) => x !== b[i]);
  if (Array.isArray(a) && a.length === 0 && b === null) return false;
  if (Array.isArray(b) && b.length === 0 && a === null) return false;
  return JSON.stringify(a) !== JSON.stringify(b);
}
