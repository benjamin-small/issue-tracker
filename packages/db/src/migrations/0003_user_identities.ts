import type { Kysely } from 'kysely';
import type { Dialect } from '../dialect.ts';
import { columnTypes, createTable } from './helpers.ts';

/** Links a user to an external identity (SSO issuer + subject) so a returning sign-in finds the same user. */
export function migration0003(dialect: Dialect) {
  const t = columnTypes(dialect);
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await createTable(db, dialect, 'user_identities')
        .addColumn('issuer', t.text, (c) => c.notNull())
        .addColumn('subject', t.text, (c) => c.notNull())
        .addColumn('user_id', t.id, (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('user_identities_pk', ['issuer', 'subject'])
        .execute();
      await db.schema
        .createIndex('user_identities_user_idx')
        .on('user_identities')
        .column('user_id')
        .execute();
    },
    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.dropTable('user_identities').execute();
    },
  };
}
