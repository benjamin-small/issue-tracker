# 0007. Custom field values stored as typed EAV rows

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Projects define their own typed fields: text, number, date, boolean, select, multi_select, user and url. Values must be filterable and sortable with SQL that is portable across SQLite and Postgres. A JSON column would need dialect-specific JSON operators and would be hard to index.

## Decision

- **Definitions** live in `custom_fields`. Select options live in `custom_field_options` with stable ids, so relabeling an option doesn't rewrite values.
- **Values** live in `issue_field_values`, one row per (issue, field), in typed columns: `v_text`, `v_number`, `v_date`, `v_bool`, `v_user_id`, `v_option_id`. `multi_select` stores one row per chosen option. Two partial unique indexes enforce single-valued versus multi-valued rows.
- **The API** exposes values as `issue.customFields[key]`: option _values_ (not ids) for select fields, and user ids for user fields.
- **Filters** use `cf:<key>` field keys, compiled to correlated subqueries (see `custom-field-query.ts`) that mirror `matchesFilter`.

## Consequences

- Filtering on custom fields is plain, indexed SQL on both dialects.
- Reading values takes one extra query per page of issues.
- A new field type means a new value column, or reusing an existing one, plus a case in the resolver and the compiler.
