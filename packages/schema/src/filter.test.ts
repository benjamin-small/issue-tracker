import { describe, expect, it } from 'vitest';
import { FieldRegistry } from './fields.ts';
import { evaluateCondition, normalizeFilter } from './filter.ts';
import { defaultViewConfig, migrateViewConfig } from './view-config.ts';

describe('normalizeFilter', () => {
  it('coerces values to field types', () => {
    const { filter, errors } = normalizeFilter({
      conditions: [
        { field: 'priority', op: 'in', value: ['1', '2'] },
        { field: 'assignee', op: 'isNull', value: 'true' as unknown as boolean },
        { field: 'estimate', op: 'gte', value: '2.5' },
      ],
    });
    expect(errors).toEqual([]);
    expect(filter.conditions.map((c) => c.value)).toEqual([[1, 2], true, 2.5]);
  });

  it('reports unknown fields, unsupported operators and bad values', () => {
    const { errors } = normalizeFilter({
      conditions: [
        { field: 'nope', op: 'eq', value: 1 },
        { field: 'priority', op: 'contains', value: 'x' },
        { field: 'status', op: 'in', value: 'x' },
        { field: 'status', op: 'eq', value: null },
      ],
    });
    expect(errors).toHaveLength(4);
  });

  it('knows custom fields registered for a project', () => {
    const registry = new FieldRegistry([{ key: 'severity', name: 'Severity', type: 'select' }]);
    expect(
      normalizeFilter({ conditions: [{ field: 'cf:severity', op: 'eq', value: 'high' }] }, registry)
        .errors,
    ).toEqual([]);
  });
});

describe('evaluateCondition', () => {
  it('treats null like SQL three-valued logic resolved to "not equal"', () => {
    expect(evaluateCondition(null, 'neq', 'a')).toBe(true);
    expect(evaluateCondition(null, 'eq', 'a')).toBe(false);
    expect(evaluateCondition(null, 'in', ['a', null])).toBe(true);
    expect(evaluateCondition(null, 'nin', ['a'])).toBe(true);
    expect(evaluateCondition(null, 'gt', 1)).toBe(false);
  });

  it('uses "has" semantics for set fields', () => {
    expect(evaluateCondition(['x', 'y'], 'eq', 'x')).toBe(true);
    expect(evaluateCondition(['x'], 'nin', ['y', 'z'])).toBe(true);
    expect(evaluateCondition([], 'isNull', true)).toBe(true);
  });
});

describe('view config', () => {
  it('fills defaults and migrates partial stored configs', () => {
    expect(defaultViewConfig('board').board.cardFields).toEqual([
      'key',
      'priority',
      'assignee',
      'labels',
    ]);
    expect(defaultViewConfig('list').sort).toEqual([{ field: 'updatedAt', dir: 'desc' }]);
    const migrated = migrateViewConfig({ board: { cardFields: ['key'] } });
    expect(migrated.board.cardFields).toEqual(['key']);
    expect(migrated.list.columns.length).toBeGreaterThan(0);
  });
});
