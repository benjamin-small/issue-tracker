# Events: history, live updates and integrations

Every change is appended to the `events` table in the same transaction as the change ([ADR 0004](adr/0004-event-log-bus-and-outbox.md)). That one log feeds:

| Consumer                   | How                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Issue activity             | `GET /issues/{issue}/activity`                                                        |
| Agents and scripts polling | `GET /events?after=<seq>` · `tracker event list --after <seq>` · `tracker event tail` |
| The web app (live)         | `GET /events/stream` (Server-Sent Events)                                             |
| Webhooks                   | outbound HTTP POSTs to subscribed URLs (see below)                                    |

## Event shape

```json
{
  "seq": 1042,
  "id": "evt_01j…",
  "type": "issue.updated",
  "actorId": "usr_01j…",
  "actor": {
    "id": "usr_01j…",
    "handle": "claude",
    "name": "Claude",
    "kind": "agent",
    "avatarUrl": null
  },
  "projectId": "prj_01j…",
  "issueId": "iss_01j…",
  "data": {
    "issue": { "…full Issue snapshot after the change…": true },
    "changes": { "status": { "from": { "name": "Todo" }, "to": { "name": "In Progress" } } },
    "requestId": "req_…"
  },
  "createdAt": "2026-09-26T13:49:00.123Z"
}
```

- `seq` increases in commit order. Rolled-back transactions may leave gaps, but an event never appears _behind_ one you have already seen. Resume with `after=<last seq>`.
- `data` always holds the resource snapshot after the change, so consumers never need to refetch.
- `data.changes` holds `{ field: { from, to } }` for updates.
- `data.requestId` identifies the API request that caused the change. The web app uses it to ignore echoes of its own writes.

| Type                                                                | `data`                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `issue.created`, `issue.updated`, `issue.deleted`, `issue.restored` | `{ issue, changes? }` (`issue.deleted` with `permanent: true` for hard deletes) |
| `comment.created`, `comment.updated`, `comment.deleted`             | `{ comment, issue: { id, key, title } }`                                        |
| `link.created`, `link.deleted`                                      | `{ link: { id, type, source, target } }`                                        |
| `attachment.created`, `attachment.deleted`                          | `{ attachment, issue: { id, key } }`                                            |
| `project.created`, `project.updated`                                | `{ project, changes? }`                                                         |
| `status.created`, `status.updated`, `status.deleted`                | `{ status, changes? }`                                                          |
| `label.created`, `label.updated`, `label.deleted`                   | `{ label, changes? }`                                                           |
| `user.created`, `user.updated`                                      | `{ user, changes? }`                                                            |

## Live stream (SSE)

`GET /api/v1/events/stream?project=ENG` returns `text/event-stream`:

```
id: 1042
event: issue.updated
data: {"seq":1042,"type":"issue.updated",…}
```

- The first message is `event: ready` (with the current `seq`). Comment lines (`: heartbeat`) keep proxies from timing out.
- **Resuming:** reconnect with `Last-Event-ID: <seq>` (browsers do this automatically) or `?after=<seq>`, and missed events are replayed. When more than 1000 events were missed, the server sends `event: reset` and the client should refetch.
- **Authentication:** the session cookie (browsers) or `Authorization: Bearer` (scripts).
- **Proxies:** they must not buffer the response. The server sends `X-Accel-Buffering: no`. For nginx, also set `proxy_buffering off` on this location.

### How delivery works across processes

Each server process runs an `EventTailer` that follows the event log. It wakes:

1. immediately after local commits;
2. on Postgres `NOTIFY tracker_events`, which is sent inside every event-writing transaction and so reaches replicas;
3. on a 300 ms poll, which also picks up writes from other processes on SQLite, such as the CLI in local mode.

So an agent that runs `tracker issue create` against the same database shows up on everyone's board within a fraction of a second, even without talking to the server.

### How the web app applies events

`apps/web/src/lib/live.svelte.ts`:

- It writes the snapshot into the issue cache.
- For every cached issue list, it applies the list's `IssueFilter` with `matchesFilter`, which has the same semantics as the server (proven by a property test), to insert, update or remove the issue, then re-sorts with the list's sort.
- Comments, links and reference data (statuses, labels, users) trigger targeted refetches.
