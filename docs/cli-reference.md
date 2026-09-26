# CLI reference

<!-- Generated from `tracker commands --json` by the CLI test suite. Do not edit; run `pnpm vitest run --project cli -u`. -->

See [cli.md](cli.md) for concepts, output formats and configuration.

## Global options

| Option | Description |
| --- | --- |
| `-V, --version` | output the version number |
| `--server <url>` | tracker server URL (remote mode) |
| `--token <token>` | API token (remote mode) |
| `--database <url>` | database URL (local mode), e.g. sqlite:./data/dev.db |
| `--actor <handle>` | local mode: act as this user |
| `-P, --project <key>` | project key (default from TRACKER_PROJECT or .tracker.json) |
| `--format <format>` | output format |
| `--json` | JSON output (same as --format json) |
| `-q, --quiet` | print only ids/keys (same as --format ids) |
| `--fields <fields>` | comma-separated fields to include, e.g. key,title,status |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Internal or unexpected error |
| 2 | Usage or validation error (bad flags, invalid input, invalid relation) |
| 3 | Not found |
| 4 | Conflict (duplicate, version mismatch, idempotency) |
| 5 | Authentication or permission error |
| 6 | Unavailable (server unreachable, database not migrated) |

## Commands

### `tracker issue list`

List issues in a project (filters are ANDed; comma lists mean "any of")

Aliases: `ls`

| Option | Description |
| --- | --- |
| `-s, --status <statuses>` | status names/ids |
| `--category <categories>` | status categories: backlog,unstarted,started,completed,canceled |
| `-a, --assignee <users>` | handles/ids, me, none |
| `--creator <users>` | creator handles/ids |
| `-l, --label <labels>` | has any of these labels |
| `-p, --priority <priorities>` | priorities (names or 0-4) |
| `--parent <issue>` | children of this issue, or none for top-level issues |
| `--search <text>` | text in key, title or description |
| `-w, --where <field.op=value>` | any filter, e.g. priority.gte=2, dueDate.isNull=true, cf.severity=high |
| `--filter-json <json|@file|->` | an IssueFilter JSON object |
| `--sort <fields>` | sort fields, - for descending (e.g. -priority,updatedAt) |
| `--limit <n>` | page size (1-200) |
| `--cursor <cursor>` | continue from a previous page |
| `--all` | fetch every page |
| `--include-deleted` | include issues in the trash |
| `--all-projects` | search across all projects |

### `tracker issue view <issue>`

Show one issue

Aliases: `show`

| Argument | Description |
| --- | --- |
| `issue` | issue key (ENG-42) or id |

### `tracker issue create`

Create an issue (prints the new issue; -q prints only its key)

Aliases: `new`

| Option | Description |
| --- | --- |
| `-t, --title <title>` | title |
| `-d, --description <markdown>` | description (markdown) |
| `--body-file <path>` | read the description from a file, or - for stdin |
| `-s, --status <status>` | status name or id |
| `-p, --priority <priority>` | none\|urgent\|high\|medium\|low or 0-4 |
| `-a, --assignee <user>` | handle, @handle, me, or none to unassign |
| `--parent <issue>` | parent issue key, or none |
| `-e, --estimate <points>` | estimate, or none |
| `--due <date>` | due date YYYY-MM-DD, or none |
| `--set <field=value>` | custom field (repeatable), e.g. --set severity=high --set points=3 |
| `--meta <key=value>` | metadata entry (repeatable; merged) |
| `--input <json|@file|->` | full JSON payload (CreateIssueInput / UpdateIssueInput); flags override it |
| `-l, --label <labels>` | labels (repeatable or comma-separated) |

### `tracker issue edit <issues...>`

Edit one or more issues (several issues are updated atomically)

Aliases: `update`

| Argument | Description |
| --- | --- |
| `issues` | issue keys or ids |

| Option | Description |
| --- | --- |
| `-t, --title <title>` | title |
| `-d, --description <markdown>` | description (markdown) |
| `--body-file <path>` | read the description from a file, or - for stdin |
| `-s, --status <status>` | status name or id |
| `-p, --priority <priority>` | none\|urgent\|high\|medium\|low or 0-4 |
| `-a, --assignee <user>` | handle, @handle, me, or none to unassign |
| `--parent <issue>` | parent issue key, or none |
| `-e, --estimate <points>` | estimate, or none |
| `--due <date>` | due date YYYY-MM-DD, or none |
| `--set <field=value>` | custom field (repeatable), e.g. --set severity=high --set points=3 |
| `--meta <key=value>` | metadata entry (repeatable; merged) |
| `--input <json|@file|->` | full JSON payload (CreateIssueInput / UpdateIssueInput); flags override it |
| `-l, --label <labels>` | replace all labels (repeatable or comma-separated) |
| `--add-label <labels>` | add labels |
| `--remove-label <labels>` | remove labels |
| `--if-version <n>` | fail with exit 4 unless the issue is at this version |

### `tracker issue move <issue>`

Move an issue on the board: change status and/or position within the column

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

| Option | Description |
| --- | --- |
| `-s, --status <status>` | target status (name or id) |
| `--after <issue>` | place directly after this issue |
| `--before <issue>` | place directly before this issue |
| `--top` | place at the top of the column (default) |
| `--bottom` | place at the bottom of the column |
| `--if-version <n>` | fail unless the issue is at this version |

### `tracker issue delete <issue>`

Move an issue to the trash (restorable); --permanent deletes for good (admin)

Aliases: `rm`

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

| Option | Description |
| --- | --- |
| `--permanent` | delete permanently, with comments and links |
| `--if-version <n>` | fail unless the issue is at this version |

### `tracker issue restore <issue>`

Restore an issue from the trash

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

### `tracker issue children <issue>`

List sub-issues

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

### `tracker issue activity <issue>`

Show the history of an issue (changes, comments, links)

Aliases: `history`

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

| Option | Description |
| --- | --- |
| `--after <seq>` | only events after this sequence number |
| `--limit <n>` | page size |

### `tracker comment list <issue>`

List comments on an issue (oldest first)

Aliases: `ls`

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

### `tracker comment add <issue> [text...]`

Comment on an issue (markdown)

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |
| `text` | comment text (optional) |

| Option | Description |
| --- | --- |
| `-b, --body <markdown>` | comment text |
| `--body-file <path>` | read the text from a file, or - for stdin |

### `tracker comment edit <id> [text...]`

Edit your comment

| Argument | Description |
| --- | --- |
| `id` | comment id |
| `text` | new text (optional) |

| Option | Description |
| --- | --- |
| `-b, --body <markdown>` | new text |
| `--body-file <path>` | read the text from a file, or - for stdin |

### `tracker comment delete <id>`

Delete your comment

Aliases: `rm`

| Argument | Description |
| --- | --- |
| `id` | comment id |

### `tracker link list <issue>`

List an issue's links from its perspective

Aliases: `ls`

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |

### `tracker link add <issue> <relation> <target>`

Link two issues, e.g. `link add ENG-1 blocks ENG-2` or `link add ENG-2 blocked-by ENG-1`

| Argument | Description |
| --- | --- |
| `issue` | issue key or id |
| `relation` | link type key or alias (blocks, blocked-by, is-blocked-by, relates, relates-to, duplicates, duplicated-by, is-duplicated-by) |
| `target` | the other issue |

### `tracker link remove <id>`

Remove a link by id (see `link list`)

Aliases: `rm`

| Argument | Description |
| --- | --- |
| `id` | link id |

### `tracker link types`

List link types

### `tracker project list`

List projects

Aliases: `ls`

| Option | Description |
| --- | --- |
| `--include-archived` | include archived projects |

### `tracker project view [project]`

Show a project

Aliases: `show`

| Argument | Description |
| --- | --- |
| `project` | project key or id (default: configured project) (optional) |

### `tracker project create`

Create a project with the default workflow (admin)

| Option | Description |
| --- | --- |
| `-k, --key <KEY>` | issue key prefix, e.g. ENG (immutable) **(required)** |
| `-n, --name <name>` | name **(required)** |
| `--description <text>` | description |

### `tracker project edit [project]`

Edit a project

| Argument | Description |
| --- | --- |
| `project` | project key or id (optional) |

| Option | Description |
| --- | --- |
| `-n, --name <name>` | name |
| `--description <text>` | description |
| `--archive` | archive the project (admin) |
| `--unarchive` | unarchive the project (admin) |

### `tracker project schema [project]`

JSON Schema for issue create/update in this project, with live enums (statuses, labels, users, custom fields)

| Argument | Description |
| --- | --- |
| `project` | project key or id (optional) |

### `tracker status list`

List statuses in board order

Aliases: `ls`

### `tracker status create`

Create a status

| Option | Description |
| --- | --- |
| `-n, --name <name>` | name **(required)** |
| `-c, --category <category>` | backlog\|unstarted\|started\|completed\|canceled **(required)** |
| `--color <hex>` | color like #5e6ad2 |
| `--position <n>` | column position (0 = first) |

### `tracker status edit <status>`

Edit a status

| Argument | Description |
| --- | --- |
| `status` | status name or id |

| Option | Description |
| --- | --- |
| `-n, --name <name>` | new name |
| `-c, --category <category>` | category |
| `--color <hex>` | color |

### `tracker status delete <status>`

Delete a status (use --move-to if issues use it)

Aliases: `rm`

| Argument | Description |
| --- | --- |
| `status` | status name or id |

| Option | Description |
| --- | --- |
| `--move-to <status>` | move its issues to this status first |

### `tracker status reorder <statuses...>`

Set the column order: list every status, in order

| Argument | Description |
| --- | --- |
| `statuses` | status names or ids |

### `tracker label list`

List labels

Aliases: `ls`

### `tracker label create <name>`

Create a label

| Argument | Description |
| --- | --- |
| `name` | label name |

| Option | Description |
| --- | --- |
| `--color <hex>` | color |
| `--description <text>` | description |

### `tracker label edit <label>`

Edit a label

| Argument | Description |
| --- | --- |
| `label` | label name or id |

| Option | Description |
| --- | --- |
| `-n, --name <name>` | new name |
| `--color <hex>` | color |
| `--description <text>` | description |

### `tracker label delete <label>`

Delete a label (removes it from issues)

Aliases: `rm`

| Argument | Description |
| --- | --- |
| `label` | label name or id |

### `tracker view list`

List views (shared + yours)

Aliases: `ls`

### `tracker view show <view>`

Show a view including its config

| Argument | Description |
| --- | --- |
| `view` | view name or id |

### `tracker view create`

Save a view

| Option | Description |
| --- | --- |
| `-n, --name <name>` | name **(required)** |
| `--layout <layout>` | list\|board **(required)** |
| `--shared` | share with the project (default: personal) |
| `--config <json|@file|->` | ViewConfig JSON |

### `tracker view edit <view>`

Rename a view or replace its config

| Argument | Description |
| --- | --- |
| `view` | view name or id |

| Option | Description |
| --- | --- |
| `-n, --name <name>` | new name |
| `--config <json|@file|->` | ViewConfig JSON |

### `tracker view delete <view>`

Delete a view

Aliases: `rm`

| Argument | Description |
| --- | --- |
| `view` | view name or id |

### `tracker event list`

List events after a sequence number (use the last seq you saw as --after)

Aliases: `ls`

| Option | Description |
| --- | --- |
| `--after <seq>` | exclusive cursor |
| `--limit <n>` | max events (1-1000) |
| `--issue <issue>` | only this issue (use the global --project to filter by project) |
| `--types <types>` | comma-separated event types, e.g. issue.created,issue.updated |

### `tracker event tail`

Follow new events as NDJSON (one event per line) until interrupted

| Option | Description |
| --- | --- |
| `--after <seq>` | start after this seq (default: now) |
| `--interval <ms>` | poll interval (default: `1000`) |
| `--max <n>` | exit after this many events |
| `--issue <issue>` | only this issue (use the global --project to filter by project) |
| `--types <types>` | comma-separated event types, e.g. issue.created,issue.updated |

### `tracker user list`

List users

Aliases: `ls`

| Option | Description |
| --- | --- |
| `--include-deactivated` | include deactivated users |

### `tracker user view <user>`

Show a user

Aliases: `show`

| Argument | Description |
| --- | --- |
| `user` | handle, @handle, me or id |

### `tracker user create`

Create a user (admin). Give every agent its own user so its work is attributed.

| Option | Description |
| --- | --- |
| `--handle <handle>` | unique handle **(required)** |
| `-n, --name <name>` | display name **(required)** |
| `--email <email>` | email |
| `--kind <kind>` | human\|agent (default: `human`) |
| `--role <role>` | admin\|member (default: `member`) |

### `tracker user edit <user>`

Edit a user

| Argument | Description |
| --- | --- |
| `user` | handle or id |

| Option | Description |
| --- | --- |
| `-n, --name <name>` | display name |
| `--email <email>` | email |
| `--role <role>` | admin\|member (admin only) |
| `--deactivate` | deactivate (admin only) |
| `--reactivate` | reactivate (admin only) |

### `tracker token list`

List API tokens (never shows secrets)

Aliases: `ls`

| Option | Description |
| --- | --- |
| `-u, --user <user>` | whose tokens (admin for others) (default: `me`) |

### `tracker token create`

Create an API token; prints the secret once (-q prints only the secret)

| Option | Description |
| --- | --- |
| `-n, --name <name>` | what the token is for **(required)** |
| `-u, --user <user>` | for which user (admin for others) (default: `me`) |
| `--expires <iso>` | expiry timestamp, e.g. 2027-01-01T00:00:00Z |

### `tracker token revoke <id>`

Revoke a token

| Argument | Description |
| --- | --- |
| `id` | token id |

### `tracker auth login`

Store an API token for a server (verifies it first): auth login --server <url> --token <t> | --with-token

| Option | Description |
| --- | --- |
| `--with-token` | read the token from stdin |

### `tracker auth logout`

Forget the stored token for the server (--server or the current default)

### `tracker auth status`

Show how the CLI connects and who it acts as

### `tracker whoami`

Show the user the CLI acts as

### `tracker init`

Write .tracker.json here from the global --server/--database, --project and --actor (never tokens)

| Option | Description |
| --- | --- |
| `--force` | overwrite an existing file |

### `tracker db migrate`

Apply pending migrations

### `tracker db status`

Show applied and pending migrations

### `tracker db seed`

Create demo users (ada, grace, claude), project ENG and sample issues; prints API tokens

### `tracker serve`

Run the tracker server (API + web app if built) on the local database

| Option | Description |
| --- | --- |
| `--port <port>` | port (default: `3000`) |
| `--host <host>` | host (default: `127.0.0.1`) |

### `tracker schema [name]`

Print a JSON Schema: resources and inputs (use `project schema` for live per-project enums)

| Argument | Description |
| --- | --- |
| `name` | one of: issue, issue-create, issue-update, issue-move, issue-filter, comment, comment-create, link, link-create, project, project-create, view-create, view-config, event, problem (optional) |

### `tracker api <method> <path>`

Call any API endpoint directly and print the JSON response (like `gh api`)

| Argument | Description |
| --- | --- |
| `method` | GET, POST, PATCH, DELETE |
| `path` | path under /api/v1, e.g. /issues/ENG-1 |

| Option | Description |
| --- | --- |
| `--input <json|@file|->` | request body (JSON) |
| `-f, --field <key=value>` | body field (repeatable; values parsed as JSON when possible) |
| `--query <key=value>` | query parameter (repeatable) |

### `tracker commands`

Describe every command, option, exit code and error code (use --json for agents)

