import { type Kysely, sql } from 'kysely';
import type { Dialect } from '../dialect.ts';
import { columnTypes, createTable } from './helpers.ts';

/**
 * Project visibility and roles (ADR 0021) plus GitHub repo links. Existing projects stay private,
 * and every active non-admin user becomes an editor of every existing project, so nobody loses access.
 */
export function migration0004(dialect: Dialect) {
  const t = columnTypes(dialect);
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      // A constant default is needed to add a NOT NULL column to existing rows; services always set it.
      await db.schema
        .alterTable('projects')
        .addColumn('visibility', t.text, (c) => c.notNull().defaultTo('private'))
        .execute();

      await createTable(db, dialect, 'project_members')
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('user_id', t.id, (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', t.text, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('project_members_pk', ['project_id', 'user_id'])
        .execute();
      await db.schema
        .createIndex('project_members_user_idx')
        .on('project_members')
        .column('user_id')
        .execute();

      await createTable(db, dialect, 'project_repos')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('owner', t.text, (c) => c.notNull())
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .execute();
      await db.schema
        .createIndex('project_repos_unique')
        .on('project_repos')
        .unique()
        .columns(['project_id', sql`lower(owner)` as never, sql`lower(name)` as never])
        .execute();

      await db.schema
        .alterTable('issues')
        .addColumn('repo_id', t.id, (c) => c.references('project_repos.id').onDelete('set null'))
        .execute();

      // Migrations have no injected clock; one timestamp for every backfilled row.
      const now = new Date().toISOString();
      await sql`
        insert into project_members (project_id, user_id, role, created_at, updated_at)
        select p.id, u.id, 'editor', ${now}, ${now}
        from projects p cross join users u
        where u.role = 'member' and u.kind <> 'system' and u.deactivated_at is null`.execute(db);
    },
    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.alterTable('issues').dropColumn('repo_id').execute();
      await db.schema.dropTable('project_repos').execute();
      await db.schema.dropTable('project_members').execute();
      await db.schema.alterTable('projects').dropColumn('visibility').execute();
    },
  };
}
