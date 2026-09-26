import type { Kysely } from 'kysely';
import type { Dialect } from '../dialect.ts';
import { columnTypes } from './helpers.ts';

/** Records what happened on a delivery's latest attempt (for the deliveries log and debugging receivers). */
export function migration0002(dialect: Dialect) {
  const t = columnTypes(dialect);
  const columns = [
    ['last_attempt_at', t.ts],
    ['last_duration_ms', t.int],
    ['last_response', t.text],
  ] as const;
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      for (const [name, type] of columns)
        await db.schema.alterTable('webhook_deliveries').addColumn(name, type).execute();
    },
    async down(db: Kysely<unknown>): Promise<void> {
      for (const [name] of [...columns].reverse())
        await db.schema.alterTable('webhook_deliveries').dropColumn(name).execute();
    },
  };
}
