# Using the tracker from an AI agent

This guide is for agent harnesses, such as Claude Code or custom loops, that manage work through the `tracker` CLI or the API. For working _on_ this repository, see [AGENTS.md](../AGENTS.md).

## Setup (once per environment)

```sh
# Remote server (shared tracker)
export TRACKER_SERVER=https://tracker.example.com
export TRACKER_TOKEN=trk_…            # token of the agent's own user (kind=agent)
export TRACKER_PROJECT=ENG
export TRACKER_FORMAT=json            # machine output everywhere

# …or local mode against a SQLite file, acting as a named agent user
export TRACKER_DATABASE_URL=sqlite:/path/to/tracker.db TRACKER_ACTOR=claude
```

Give every agent its own user (`tracker user create --kind agent …`), so history shows who did what. Committing a `.tracker.json` (`tracker init --project ENG --server …`) in a repository lets any agent working there find the right project.

## Learn the surface in two calls

```sh
tracker commands --json      # all commands/options/exit codes
tracker project schema       # valid statuses, labels, users, custom fields for the project
```

## Recipes

```sh
# Pick up work
tracker issue list --assignee me --category unstarted,started --sort priority --fields key,title,status.name,priority

# Claim and start an issue, guarding against concurrent edits
v=$(tracker issue view ENG-42 --fields version | jq .version)
tracker issue edit ENG-42 --assignee me --status "In Progress" --if-version "$v"

# Break work down
tracker issue create -t "Write migration" --parent ENG-42 -l chore -q      # prints ENG-43

# Report progress with markdown from a file or stdin
tracker comment add ENG-42 --body-file - <<'MD'
Implemented the migration. Tests: `pnpm test` ✅
MD

# Record links to external artifacts
tracker issue edit ENG-42 --meta github.pr=https://github.com/acme/app/pull/12 --meta agent.session=abc123

# Relate work
tracker link add ENG-43 blocks ENG-42

# Finish
tracker issue edit ENG-42 --status "In Review"
```

## Reacting to changes

- **Polling:** keep the last `seq` you processed and call `tracker event list --after <seq>`. The log is commit-ordered, so no event is ever skipped.
- **Streaming:** `tracker event tail --types issue.updated,comment.created` prints one JSON event per line.
- **Payload:** each event carries the full resource snapshot, plus `changes: { field: { from, to } }` for updates, so a refetch is never needed.

## Handling failures

Branch on the exit code, not the message text:

| Exit | Do                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 2    | Fix the input (stderr JSON has `errors[]` with field paths). Don't retry unchanged.                        |
| 3    | The reference is wrong; list or search to find the right one.                                              |
| 4    | Someone else changed it (`VERSION_MISMATCH`) or it already exists (`CONFLICT`). Refetch, re-decide, retry. |
| 5    | Credentials or permissions. Stop and report.                                                               |
| 6    | Transient (server down) or setup (`tracker db migrate`). Retrying later is safe: mutations are idempotent. |
