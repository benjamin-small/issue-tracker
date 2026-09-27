import { testDialect } from '@tracker/db/testing';
import type { FilterCondition } from '@tracker/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addFieldOption,
  createCustomField,
  createIssue,
  createProject,
  getIssue,
  issueInputJsonSchema,
  listCustomFields,
  listIssues,
  updateCustomField,
  updateFieldOption,
  updateIssue,
} from './index.ts';
import { createTestContext, type TestContext } from './testing.ts';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await createProject(t.ctx, { key: 'CF', name: 'Custom fields' });
  await createCustomField(t.ctx, 'CF', {
    key: 'severity',
    name: 'Severity',
    type: 'select',
    options: [
      { value: 'low' },
      { value: 'high', label: 'High', color: '#eb5757' },
      { value: 'critical' },
    ],
  });
  await createCustomField(t.ctx, 'CF', { key: 'points', name: 'Points', type: 'number' });
  await createCustomField(t.ctx, 'CF', { key: 'shipped', name: 'Shipped', type: 'boolean' });
  await createCustomField(t.ctx, 'CF', { key: 'launch', name: 'Launch', type: 'date' });
  await createCustomField(t.ctx, 'CF', { key: 'notes', name: 'Notes', type: 'text' });
  await createCustomField(t.ctx, 'CF', { key: 'spec', name: 'Spec', type: 'url' });
  await createCustomField(t.ctx, 'CF', { key: 'reviewer', name: 'Reviewer', type: 'user' });
  await createCustomField(t.ctx, 'CF', {
    key: 'platforms',
    name: 'Platforms',
    type: 'multi_select',
    options: [{ value: 'web' }, { value: 'ios' }, { value: 'android' }],
  });
});
afterAll(() => t.destroy());

describe(`custom fields (${testDialect()})`, () => {
  it('defines fields with options in order', async () => {
    const fields = await listCustomFields(t.ctx, 'CF');
    expect(fields.map((f) => f.key)).toEqual([
      'severity',
      'points',
      'shipped',
      'launch',
      'notes',
      'spec',
      'reviewer',
      'platforms',
    ]);
    expect(fields[0]!.options.map((o) => [o.value, o.label])).toEqual([
      ['low', 'low'],
      ['high', 'High'],
      ['critical', 'critical'],
    ]);
    await expect(
      createCustomField(t.ctx, 'CF', { key: 'points', name: 'Dup', type: 'text' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createCustomField(t.ctx, 'CF', { key: 'Bad Key', name: 'x', type: 'text' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      createCustomField(t.ctx, 'CF', {
        key: 'nope',
        name: 'x',
        type: 'text',
        options: [{ value: 'a' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('stores and returns values of every type', async () => {
    const issue = await createIssue(t.ctx, 'CF', {
      title: 'All the fields',
      customFields: {
        severity: 'high',
        points: 3.5,
        shipped: false,
        launch: '2026-11-02',
        notes: 'free text',
        spec: 'https://example.com/spec',
        reviewer: '@member',
        platforms: ['ios', 'web'],
      },
    });
    expect(issue.customFields).toEqual({
      severity: 'high',
      points: 3.5,
      shipped: false,
      launch: '2026-11-02',
      notes: 'free text',
      spec: 'https://example.com/spec',
      reviewer: t.member.actor.id,
      platforms: ['web', 'ios'], // option order, not input order
    });
    // Merge semantics: only given fields change; null clears.
    const updated = await updateIssue(t.ctx, issue.key, {
      customFields: { points: 5, notes: null, platforms: [] },
    });
    expect(updated.customFields).toMatchObject({ points: 5, severity: 'high' });
    // Unset fields (including an emptied multi_select) are omitted.
    expect(updated.customFields.notes).toBeUndefined();
    expect(updated.customFields.platforms).toBeUndefined();
    const activity = (await import('./index.ts')).listIssueActivity;
    const last = (await activity(t.ctx, issue.key)).data.at(-1)!;
    expect(Object.keys(last.data.changes as object)).toEqual(['customFields']);
    // No-op updates don't bump the version.
    const same = await updateIssue(t.ctx, issue.key, {
      customFields: { points: 5, platforms: [] },
    });
    expect(same.version).toBe(updated.version);
  });

  it('validates values with actionable errors', async () => {
    const bad = (customFields: Record<string, unknown>) =>
      createIssue(t.ctx, 'CF', { title: 'bad', customFields: customFields as never });
    await expect(bad({ severity: 'medium' })).rejects.toThrow(
      /unknown option "medium" \(options: low, high, critical\)/,
    );
    await expect(bad({ points: 'three' })).rejects.toThrow(/expected a number/);
    await expect(bad({ launch: '02/11/2026' })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(bad({ spec: 'javascript:alert(1)' })).rejects.toThrow(/http\(s\) URL/);
    await expect(bad({ reviewer: 'nobody' })).rejects.toThrow(/unknown user/);
    await expect(bad({ nope: 1 })).rejects.toThrow(/unknown custom field/);
  });

  it('filters by custom fields in SQL', async () => {
    await createIssue(t.ctx, 'CF', {
      title: 'F1',
      customFields: { severity: 'low', points: 1, shipped: true, platforms: ['web'] },
    });
    await createIssue(t.ctx, 'CF', {
      title: 'F2',
      customFields: {
        severity: 'critical',
        points: 8,
        launch: '2027-01-01',
        platforms: ['android'],
      },
    });
    await createIssue(t.ctx, 'CF', { title: 'F3' });
    const titles = async (...conditions: FilterCondition[]) =>
      (
        await listIssues(t.ctx, {
          project: 'CF',
          filter: { conditions },
          sort: [{ field: 'title', dir: 'asc' }],
        })
      ).data
        .map((i) => i.title)
        .filter((x) => x.startsWith('F'));
    expect(await titles({ field: 'cf:severity', op: 'eq', value: 'low' })).toEqual(['F1']);
    expect(await titles({ field: 'cf:severity', op: 'in', value: ['low', 'critical'] })).toEqual([
      'F1',
      'F2',
    ]);
    expect(await titles({ field: 'cf:severity', op: 'isNull', value: true })).toEqual(['F3']);
    expect(await titles({ field: 'cf:points', op: 'gte', value: 2 })).toEqual(['F2']);
    expect(await titles({ field: 'cf:shipped', op: 'eq', value: true })).toEqual(['F1']);
    expect(await titles({ field: 'cf:launch', op: 'gt', value: '2026-12-31' })).toEqual(['F2']);
    expect(await titles({ field: 'cf:platforms', op: 'in', value: ['android', 'web'] })).toEqual([
      'F1',
      'F2',
    ]);
    expect(await titles({ field: 'cf:platforms', op: 'isNull', value: true })).toEqual(['F3']);
    await expect(titles({ field: 'cf:points', op: 'contains', value: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('archives options and fields without losing data', async () => {
    const [severity] = await listCustomFields(t.ctx, 'CF');
    const low = severity!.options.find((o) => o.value === 'low')!;
    await updateFieldOption(t.ctx, low.id, { archived: true, label: 'Low (old)' });
    await expect(
      createIssue(t.ctx, 'CF', { title: 'x', customFields: { severity: 'low' } }),
    ).rejects.toThrow(/unknown option/);
    const withOld = await getIssue(t.ctx, 'CF-2');
    expect(withOld.customFields.severity).toBe('low'); // existing values stay readable

    const added = await addFieldOption(t.ctx, severity!.id, { value: 'medium', color: '#f2c94c' });
    expect(added.options.map((o) => o.value)).toContain('medium');

    await updateCustomField(t.ctx, severity!.id, { archived: true });
    expect((await listCustomFields(t.ctx, 'CF')).map((f) => f.key)).not.toContain('severity');
    expect((await getIssue(t.ctx, 'CF-2')).customFields.severity).toBeUndefined();
    await updateCustomField(t.ctx, severity!.id, { archived: false });
    expect((await getIssue(t.ctx, 'CF-2')).customFields.severity).toBe('low');
  });

  it('exposes fields in the agent-facing input schema', async () => {
    const schema = (await issueInputJsonSchema(t.ctx, 'CF')) as {
      create: {
        properties: {
          customFields: { properties: Record<string, { enum?: unknown[]; type?: unknown }> };
        };
      };
    };
    const props = schema.create.properties.customFields.properties;
    expect(props.severity!.enum).toEqual(['high', 'critical', 'medium', null]);
    expect(props.points!.type).toEqual(['number', 'null']);
  });
});
