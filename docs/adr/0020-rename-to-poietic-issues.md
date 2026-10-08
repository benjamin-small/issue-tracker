# 0020. Rename to poietic-issues

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

The project grew up under the working name "tracker". It now runs as part of poietic.tech at `issues.poietic.tech`, and its CLI may later be published to npm, where a bare `tracker` name would clash with other tools. The GitHub repository was renamed from `benjamin-small/issue-tracker` to `poietic-issues` on the same day and then moved into the poietic-tech organization, as `poietic-tech/poietic-issues`.

## Decision

Rename everything that carries the product name:

| What                             | From                                     | To                                                                    |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Root package                     | `tracker`                                | `poietic-issues`                                                      |
| CLI package                      | `@tracker/cli`                           | `@poietic-tech/issues` (still private; publishing is a separate step) |
| Other workspace packages         | `@tracker/<name>`                        | `@poietic-tech/issues-<name>`                                         |
| CLI command and bundle           | `tracker`, `dist/tracker.mjs`            | `poietic-issues`, `dist/poietic-issues.mjs`                           |
| Environment variables            | `TRACKER_*`                              | `POIETIC_ISSUES_*`                                                    |
| CLI config files                 | `.tracker.json`, `~/.config/tracker/`    | `.poietic-issues.json`, `~/.config/poietic-issues/`                   |
| Session cookie                   | `tracker_session`                        | `poietic_issues_session`                                              |
| Webhook headers                  | `x-tracker-event`, `x-tracker-event-seq` | `x-poietic-issues-event`, `x-poietic-issues-event-seq`                |
| Webhook user agent               | `tracker-webhooks/1`                     | `poietic-issues-webhooks/1`                                           |
| Postgres notify channel          | `tracker_events`                         | `poietic_issues_events`                                               |
| Browser storage                  | `tracker.theme`, `tracker-demo-*`        | `poietic-issues.theme`, `poietic-issues-demo-*`                       |
| Docker image and compose service | `tracker:local`, `tracker`               | `poietic-issues:local`, `poietic-issues`                              |
| Display name                     | "Tracker"                                | "Issues" in the UI, "poietic-issues" in the docs                      |

Not renamed, because they name stored data rather than the product: the SQLite file (`/data/tracker.db` and the Docker default), the Litestream replica path `tracker` in R2, and the database, user and bucket names of the local Postgres and SeaweedFS stacks. Renaming the replica path would make the next cold start see an empty replica, take it for a first boot and serve an empty database. API paths, id prefixes, event types and error codes never carried the name.

For one release, the old names keep working:

- `TRACKER_*` variables are copied to their `POIETIC_ISSUES_*` names when those are unset, with one warning per start (`applyLegacyEnv` in `packages/core`).
- The server accepts a `tracker_session` cookie, and logout clears it.
- Webhooks also send `x-tracker-event` and `x-tracker-event-seq` (marked deprecated in the OpenAPI document).
- The CLI reads `.tracker.json` and `~/.config/tracker/config.json` when the new files are absent; it always writes the new location.
- The web app moves the saved theme to the new key on first load.

Dated ADRs, specs and plans keep the old names as historical records.

## Consequences

- Shell profiles, CI and compose files that set `TRACKER_*` keep working, but warn until they are updated.
- The next release removes the fallbacks. Anyone still on `tracker_session` is then signed out once (on issues.poietic.tech the automatic SSO attempt signs them straight back in), and webhook receivers must read the new header names.
- Publishing `@poietic-tech/issues` to npm still needs a release workflow, a versioning decision and the `@poietic-tech` npm scope; see [releases.md](../releases.md).
