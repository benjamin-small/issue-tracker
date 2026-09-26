# API guide

The REST API lives under `/api/v1`. The OpenAPI 3.1 document is the contract:

- **Committed:** [`docs/openapi.json`](openapi.json), regenerated with `pnpm openapi:gen`. CI fails if it is stale.
- **Served:** at `/api/v1/openapi.json`, with an interactive reference at **`/api/docs`**.
- **Consumed:** `@tracker/client`, and through it the web app and the CLI, is generated from the same document.

## Authentication

| Client               | How                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI, agents, scripts | `Authorization: Bearer trk_…`, an API token from `POST /users/{user}/tokens` (or `tracker token create`)                                              |
| Web app              | An HttpOnly session cookie from `POST /auth/token-login` (paste a token), or `POST /auth/dev-login` when the server runs with `TRACKER_AUTH_MODE=dev` |

Every actor is a user. Create one `agent` user per automated worker (`POST /users` with `kind: "agent"`) so its changes are attributed in history, events and webhooks.

Roles: `admin` can manage users, other users' tokens, webhooks, project creation and archiving, and permanent deletes. `member` can do everything else.

Cookie-authenticated `POST`/`PATCH`/`DELETE` requests must be same-origin (CSRF protection). Bearer requests are exempt.

## References

Path parameters and body fields accept ids or human references:

| Kind                             | Accepted                               |
| -------------------------------- | -------------------------------------- |
| Issue                            | `ENG-42` (case-insensitive) or `iss_…` |
| Project                          | `ENG` or `prj_…`                       |
| User                             | `ada`, `@ada`, `me` or `usr_…`         |
| Status, label (within a project) | name (case-insensitive) or id          |

## Lists and pagination

Lists return `{ "data": [...], "nextCursor": "…" | null }`. Pass `cursor=<nextCursor>` for the next page, and `limit` sets the page size (1–200, default 50). Cursors are opaque and tied to the sort order.

## Filtering issues

`GET /projects/{project}/issues` takes filters as query parameters:

| Form                  | Meaning                                    | Example                                                         |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `field=a,b`           | any of (`eq` for one value)                | `status=Todo,In Progress`, `assignee=me,none`                   |
| `field.op=value`      | explicit operator                          | `priority.gte=2`, `dueDate.isNull=true`, `title.contains=crash` |
| `label=…`             | has any of these labels                    | `label=bug`                                                     |
| `cf.<key>=…`          | custom field                               | `cf.severity=high`, `cf.points.gte=3`                           |
| `q=…`                 | text in key, title, description            | `q=login`                                                       |
| `filter=<json>`       | a full `IssueFilter`, ANDed with the rest  |                                                                 |
| `sort=`               | comma-separated fields, `-` for descending | `sort=-priority,updatedAt`                                      |
| `includeDeleted=true` | include trashed issues                     |                                                                 |

- **Operators:** `eq neq in nin gt gte lt lte isNull contains`. `none` / `null` in a list means "empty".
- **Structured search:** `POST /issues/search` takes `{ project?, filter, sort, limit, cursor }`. Omit `project` to search every project.
- **Filter semantics:** conditions are ANDed. `in` gives OR within a field. Labels and multi-selects use "has" semantics.
- **Sortable fields:** `rank` (board order), `priority` (urgent first, none last), `createdAt`, `updatedAt`, `dueDate` and `estimate` (nulls last), `title`, `key`.

## Custom fields

Projects define typed fields with `POST /projects/{project}/fields`. The types are `text`, `number`, `date`, `boolean`, `select`, `multi_select`, `user` and `url`. `select` and `multi_select` fields also take `options`.

- **Setting values.** Issues carry values in `customFields`, keyed by field key:

  ```json
  {
    "customFields": {
      "severity": "high",
      "points": 3,
      "platforms": ["web", "ios"],
      "reviewer": "@ada"
    }
  }
  ```

  - Updates merge: only the fields you send change, and `null` clears one.
  - Select fields take option _values_.
  - User fields accept handles, `me` or ids. They are returned as ids.
  - Unset fields are omitted from responses.

- **Filtering.** Use `cf.<key>` in query strings (`cf.severity=high,critical`, `cf.points.gte=3`) and `cf:<key>` in `IssueFilter`.
- **Discovery.** `GET /projects/{project}/schema/issue` lists every field, with its options as enums.
- **Archiving.** Archiving a field or an option hides it without deleting stored values. Option values are immutable, while labels and colors can change.

## Errors

Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` body:

```json
{
  "type": "urn:tracker:error:VALIDATION_FAILED",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "title: Too small: expected string to have >=1 characters",
  "errors": [{ "path": "title", "message": "Too small: expected string to have >=1 characters" }],
  "requestId": "req_01…"
}
```

`code` is stable and comes from a closed set (`packages/schema/src/errors.ts`):

| Code                      | HTTP | Meaning                                                                     |
| ------------------------- | ---- | --------------------------------------------------------------------------- |
| `VALIDATION_FAILED`       | 400  | Bad input; see `errors[]`                                                   |
| `UNAUTHENTICATED`         | 401  | Missing or invalid credentials                                              |
| `FORBIDDEN`               | 403  | Not allowed for this actor                                                  |
| `NOT_FOUND`               | 404  | Unknown issue, project, user, …                                             |
| `CONFLICT`                | 409  | Duplicate (key, name, link) or invalid state (e.g. editing a trashed issue) |
| `IDEMPOTENCY_IN_PROGRESS` | 409  | Same `Idempotency-Key` is still being processed                             |
| `VERSION_MISMATCH`        | 412  | `If-Match` / `expectedVersion` is stale                                     |
| `PAYLOAD_TOO_LARGE`       | 413  |                                                                             |
| `UNSUPPORTED_MEDIA_TYPE`  | 415  |                                                                             |
| `INVALID_RELATION`        | 422  | Self link, parent cycle, cross-project parent                               |
| `IDEMPOTENCY_KEY_REUSED`  | 422  | Same key, different request                                                 |
| `INTERNAL`                | 500  | Bug; report it with `requestId`                                             |

## Concurrency

Issues carry `version`, and responses include `ETag: "v<version>"`. Send `If-Match: "v<version>"`, or `expectedVersion` in the body, on `PATCH`, `DELETE` and `move` to fail with `412 VERSION_MISMATCH` instead of silently overwriting someone else's change. Omitting it means last-write-wins per field.

## Idempotency

`POST` requests accept `Idempotency-Key: <unique string>` (at most 255 characters, scoped to the actor, remembered for 24 hours):

- **Retry with the same body:** the original response is returned, with `Idempotent-Replayed: true`.
- **Reuse with a different body:** `422 IDEMPOTENCY_KEY_REUSED`.
- **Retry while the first request is still running:** `409 IDEMPOTENCY_IN_PROGRESS`.

The CLI sends a key on every mutation automatically.

## Board ordering

`POST /issues/{issue}/move` with `{ status?, afterId? | beforeId? | position: "top"|"bottom" }`. The server computes the ordering key. New issues go to the top of their column.

## Events

Every change is appended to the event log. Each event carries a full resource snapshot plus `changes` for updates.

- `GET /events?after=<seq>` pages through all events in commit order.
- `GET /issues/{issue}/activity` gives one issue's history, including comments and links.

`GET /events/stream` streams them live (Server-Sent Events). See [events.md](events.md) for the catalogue, live streaming and webhooks.

## Discovery for agents

`GET /projects/{project}/schema/issue` returns JSON Schemas for create and update with live enums: status names, label names, user handles and custom fields. One call tells an agent every valid value.
