import { type Kysely, sql } from 'kysely';
import type { Dialect } from '../dialect.ts';
import { columnTypes, createTable } from './helpers.ts';

/**
 * Initial schema: every v1 table. See docs/data-model.md for the entity reference.
 *
 * Frozen once M3 ships — schema changes after that go in new migration files.
 */
export function migration0001(dialect: Dialect) {
  const t = columnTypes(dialect);

  return {
    async up(db: Kysely<unknown>): Promise<void> {
      const table = (name: string) => createTable(db, dialect, name);

      // ---- actors & auth ----
      await table('users')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('handle', t.text, (c) => c.notNull().unique())
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('email', t.text, (c) => c.unique())
        .addColumn('kind', t.text, (c) =>
          c.notNull().check(sql`kind in ('human', 'agent', 'system')`),
        )
        .addColumn('role', t.text, (c) => c.notNull().check(sql`role in ('admin', 'member')`))
        .addColumn('avatar_url', t.text)
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('deactivated_at', t.ts)
        .execute();

      await table('api_tokens')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('user_id', t.id, (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('token_hash', t.text, (c) => c.notNull().unique())
        .addColumn('prefix', t.text, (c) => c.notNull())
        .addColumn('scopes', t.json, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('last_used_at', t.ts)
        .addColumn('expires_at', t.ts)
        .addColumn('revoked_at', t.ts)
        .execute();
      await db.schema
        .createIndex('api_tokens_user_idx')
        .on('api_tokens')
        .column('user_id')
        .execute();

      await table('sessions')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('user_id', t.id, (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('expires_at', t.ts, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('sessions_user_idx').on('sessions').column('user_id').execute();

      // ---- projects & configuration ----
      await table('projects')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('key', t.text, (c) => c.notNull().unique())
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('next_issue_number', t.int, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('archived_at', t.ts)
        .execute();

      await table('statuses')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('category', t.text, (c) =>
          c
            .notNull()
            .check(sql`category in ('backlog', 'unstarted', 'started', 'completed', 'canceled')`),
        )
        .addColumn('color', t.text, (c) => c.notNull())
        .addColumn('position', t.int, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .execute();
      await db.schema
        .createIndex('statuses_project_name_uq')
        .on('statuses')
        .columns(['project_id', sql`lower(name)` as never])
        .unique()
        .execute();

      await table('labels')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('color', t.text, (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('archived_at', t.ts)
        .execute();
      await db.schema
        .createIndex('labels_project_name_uq')
        .on('labels')
        .columns(['project_id', sql`lower(name)` as never])
        .unique()
        .execute();

      // ---- issues ----
      await table('issues')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('number', t.int, (c) => c.notNull())
        .addColumn('title', t.text, (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('status_id', t.id, (c) => c.notNull().references('statuses.id'))
        .addColumn('priority', t.int, (c) => c.notNull().check(sql`priority between 0 and 4`))
        .addColumn('assignee_id', t.id, (c) => c.references('users.id').onDelete('set null'))
        .addColumn('creator_id', t.id, (c) => c.notNull().references('users.id'))
        .addColumn('parent_id', t.id, (c) => c.references('issues.id').onDelete('set null'))
        .addColumn('estimate', t.real)
        .addColumn('due_date', t.date)
        .addColumn('rank', t.bytewiseText, (c) => c.notNull())
        .addColumn('metadata', t.json, (c) => c.notNull())
        .addColumn('version', t.int, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('started_at', t.ts)
        .addColumn('completed_at', t.ts)
        .addColumn('canceled_at', t.ts)
        .addColumn('deleted_at', t.ts)
        .addUniqueConstraint('issues_project_number_uq', ['project_id', 'number'])
        .execute();
      await db.schema
        .createIndex('issues_board_idx')
        .on('issues')
        .columns(['project_id', 'status_id', 'rank'])
        .execute();
      await db.schema
        .createIndex('issues_assignee_idx')
        .on('issues')
        .column('assignee_id')
        .execute();
      await db.schema.createIndex('issues_parent_idx').on('issues').column('parent_id').execute();
      await db.schema
        .createIndex('issues_updated_idx')
        .on('issues')
        .columns(['project_id', 'updated_at', 'id'])
        .execute();

      await table('issue_labels')
        .addColumn('issue_id', t.id, (c) => c.notNull().references('issues.id').onDelete('cascade'))
        .addColumn('label_id', t.id, (c) => c.notNull().references('labels.id').onDelete('cascade'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('issue_labels_pk', ['issue_id', 'label_id'])
        .execute();
      await db.schema
        .createIndex('issue_labels_label_idx')
        .on('issue_labels')
        .column('label_id')
        .execute();

      await table('comments')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('issue_id', t.id, (c) => c.notNull().references('issues.id').onDelete('cascade'))
        .addColumn('author_id', t.id, (c) => c.notNull().references('users.id'))
        .addColumn('parent_comment_id', t.id, (c) =>
          c.references('comments.id').onDelete('set null'),
        )
        .addColumn('body', t.text, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('edited_at', t.ts)
        .addColumn('deleted_at', t.ts)
        .execute();
      await db.schema
        .createIndex('comments_issue_idx')
        .on('comments')
        .columns(['issue_id', 'created_at'])
        .execute();

      // ---- links ----
      await table('link_types')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('key', t.text, (c) => c.notNull().unique())
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('outward_label', t.text, (c) => c.notNull())
        .addColumn('inward_label', t.text, (c) => c.notNull())
        .addColumn('symmetric', t.bool, (c) => c.notNull())
        .addColumn('built_in', t.bool, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .execute();

      await table('issue_links')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('type_id', t.id, (c) => c.notNull().references('link_types.id'))
        .addColumn('source_id', t.id, (c) =>
          c.notNull().references('issues.id').onDelete('cascade'),
        )
        .addColumn('target_id', t.id, (c) =>
          c.notNull().references('issues.id').onDelete('cascade'),
        )
        .addColumn('created_by', t.id, (c) => c.notNull().references('users.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addUniqueConstraint('issue_links_uq', ['type_id', 'source_id', 'target_id'])
        .addCheckConstraint('issue_links_no_self', sql`source_id <> target_id`)
        .execute();
      await db.schema
        .createIndex('issue_links_target_idx')
        .on('issue_links')
        .column('target_id')
        .execute();

      // ---- custom fields ----
      await table('custom_fields')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('key', t.text, (c) => c.notNull())
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('type', t.text, (c) =>
          c
            .notNull()
            .check(
              sql`type in ('text', 'number', 'date', 'boolean', 'select', 'multi_select', 'user', 'url')`,
            ),
        )
        .addColumn('config', t.json, (c) => c.notNull())
        .addColumn('position', t.int, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('archived_at', t.ts)
        .addUniqueConstraint('custom_fields_project_key_uq', ['project_id', 'key'])
        .execute();

      await table('custom_field_options')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('field_id', t.id, (c) =>
          c.notNull().references('custom_fields.id').onDelete('cascade'),
        )
        .addColumn('value', t.text, (c) => c.notNull())
        .addColumn('label', t.text, (c) => c.notNull())
        .addColumn('color', t.text, (c) => c.notNull())
        .addColumn('position', t.int, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('archived_at', t.ts)
        .addUniqueConstraint('custom_field_options_value_uq', ['field_id', 'value'])
        .execute();

      await table('issue_field_values')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('issue_id', t.id, (c) => c.notNull().references('issues.id').onDelete('cascade'))
        .addColumn('field_id', t.id, (c) =>
          c.notNull().references('custom_fields.id').onDelete('cascade'),
        )
        .addColumn('v_text', t.text)
        .addColumn('v_number', t.real)
        .addColumn('v_date', t.date)
        .addColumn('v_bool', t.bool)
        .addColumn('v_user_id', t.id, (c) => c.references('users.id').onDelete('cascade'))
        .addColumn('v_option_id', t.id, (c) =>
          c.references('custom_field_options.id').onDelete('cascade'),
        )
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .execute();
      // Single-valued fields: at most one row per (issue, field). Multi-select: one row per option.
      await db.schema
        .createIndex('issue_field_values_single_uq')
        .on('issue_field_values')
        .columns(['issue_id', 'field_id'])
        .unique()
        .where(sql.ref('v_option_id'), 'is', null)
        .execute();
      await db.schema
        .createIndex('issue_field_values_option_uq')
        .on('issue_field_values')
        .columns(['issue_id', 'field_id', 'v_option_id'])
        .unique()
        .where(sql.ref('v_option_id'), 'is not', null)
        .execute();
      for (const column of ['v_text', 'v_number', 'v_date', 'v_option_id', 'v_user_id']) {
        await db.schema
          .createIndex(`issue_field_values_${column}_idx`)
          .on('issue_field_values')
          .columns(['field_id', column])
          .execute();
      }

      // ---- attachments & views ----
      await table('attachments')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('issue_id', t.id, (c) => c.notNull().references('issues.id').onDelete('cascade'))
        .addColumn('comment_id', t.id, (c) => c.references('comments.id').onDelete('set null'))
        .addColumn('uploader_id', t.id, (c) => c.notNull().references('users.id'))
        .addColumn('filename', t.text, (c) => c.notNull())
        .addColumn('content_type', t.text, (c) => c.notNull())
        .addColumn('size', t.int, (c) => c.notNull())
        .addColumn('sha256', t.text, (c) => c.notNull())
        .addColumn('storage_key', t.text, (c) => c.notNull().unique())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('deleted_at', t.ts)
        .execute();
      await db.schema
        .createIndex('attachments_issue_idx')
        .on('attachments')
        .column('issue_id')
        .execute();

      await table('views')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('project_id', t.id, (c) =>
          c.notNull().references('projects.id').onDelete('cascade'),
        )
        .addColumn('owner_id', t.id, (c) => c.references('users.id').onDelete('cascade'))
        .addColumn('name', t.text, (c) => c.notNull())
        .addColumn('layout', t.text, (c) => c.notNull().check(sql`layout in ('list', 'board')`))
        .addColumn('config', t.json, (c) => c.notNull())
        .addColumn('position', t.int, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .execute();
      await db.schema
        .createIndex('views_project_idx')
        .on('views')
        .columns(['project_id', 'owner_id'])
        .execute();

      // ---- event log (bus + outbox, ADR 0004) ----
      await table('events')
        .addColumn('seq', dialect === 'postgres' ? 'bigint' : 'integer', (c) =>
          dialect === 'postgres'
            ? c.primaryKey().generatedAlwaysAsIdentity()
            : c.primaryKey().autoIncrement(),
        )
        .addColumn('id', t.id, (c) => c.notNull().unique())
        .addColumn('type', t.text, (c) => c.notNull())
        .addColumn('actor_id', t.id)
        .addColumn('project_id', t.id)
        .addColumn('issue_id', t.id)
        .addColumn('data', t.json, (c) => c.notNull())
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .execute();
      await db.schema
        .createIndex('events_issue_idx')
        .on('events')
        .columns(['issue_id', 'seq'])
        .execute();
      await db.schema
        .createIndex('events_project_idx')
        .on('events')
        .columns(['project_id', 'seq'])
        .execute();

      // ---- webhooks ----
      await table('webhooks')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('url', t.text, (c) => c.notNull())
        .addColumn('secret', t.text, (c) => c.notNull())
        .addColumn('description', t.text, (c) => c.notNull())
        .addColumn('event_types', t.json, (c) => c.notNull())
        .addColumn('project_id', t.id, (c) => c.references('projects.id').onDelete('cascade'))
        .addColumn('active', t.bool, (c) => c.notNull())
        .addColumn('failure_count', t.int, (c) => c.notNull())
        .addColumn('created_by', t.id, (c) => c.notNull().references('users.id'))
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('disabled_at', t.ts)
        .execute();

      await table('webhook_deliveries')
        .addColumn('id', t.id, (c) => c.primaryKey())
        .addColumn('webhook_id', t.id, (c) =>
          c.notNull().references('webhooks.id').onDelete('cascade'),
        )
        .addColumn('event_seq', dialect === 'postgres' ? 'bigint' : 'integer', (c) => c.notNull())
        .addColumn('status', t.text, (c) =>
          c.notNull().check(sql`status in ('pending', 'succeeded', 'failed', 'dead')`),
        )
        .addColumn('attempts', t.int, (c) => c.notNull())
        .addColumn('next_attempt_at', t.ts, (c) => c.notNull())
        .addColumn('locked_until', t.ts)
        .addColumn('last_status_code', t.int)
        .addColumn('last_error', t.text)
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .addColumn('completed_at', t.ts)
        .addUniqueConstraint('webhook_deliveries_uq', ['webhook_id', 'event_seq'])
        .execute();
      await db.schema
        .createIndex('webhook_deliveries_due_idx')
        .on('webhook_deliveries')
        .columns(['status', 'next_attempt_at'])
        .execute();

      // ---- infrastructure ----
      await table('idempotency_keys')
        .addColumn('actor_id', t.id, (c) => c.notNull())
        .addColumn('key', t.text, (c) => c.notNull())
        .addColumn('method', t.text, (c) => c.notNull())
        .addColumn('path', t.text, (c) => c.notNull())
        .addColumn('request_hash', t.text, (c) => c.notNull())
        .addColumn('status_code', t.int)
        .addColumn('response', t.json)
        .addColumn('created_at', t.ts, (c) => c.notNull())
        .addColumn('expires_at', t.ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('idempotency_keys_pk', ['actor_id', 'key'])
        .execute();

      await table('system_state')
        .addColumn('key', t.text, (c) => c.primaryKey())
        .addColumn('value', t.json, (c) => c.notNull())
        .addColumn('updated_at', t.ts, (c) => c.notNull())
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const name of [
        'system_state',
        'idempotency_keys',
        'webhook_deliveries',
        'webhooks',
        'events',
        'views',
        'attachments',
        'issue_field_values',
        'custom_field_options',
        'custom_fields',
        'issue_links',
        'link_types',
        'comments',
        'issue_labels',
        'issues',
        'labels',
        'statuses',
        'projects',
        'sessions',
        'api_tokens',
        'users',
      ]) {
        await db.schema.dropTable(name).execute();
      }
    },
  };
}
