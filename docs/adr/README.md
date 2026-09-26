# Architecture decision records

Short records of decisions that constrain future work. Copy `0000-template.md`, take the next number, and keep it brief. Superseded ADRs stay in place with their status updated.

| #                                                  | Decision                                                              | Status   |
| -------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-layout.md)                    | pnpm monorepo with source-exported internal packages                  | Accepted |
| [0002](0002-dual-dialect-kysely.md)                | One Kysely codebase for SQLite and Postgres; STRICT SQLite            | Accepted |
| [0003](0003-write-transactions.md)                 | All writes through `withWriteTx` (BEGIN IMMEDIATE / advisory lock)    | Accepted |
| [0004](0004-event-log-bus-and-outbox.md)           | The events table is the bus and the outbox                            | Accepted |
| [0006](0006-typeids-and-issue-keys.md)             | TypeID identifiers plus immutable issue keys                          | Accepted |
| [0007](0007-eav-custom-fields.md)                  | Custom field values as typed EAV rows                                 | Accepted |
| [0008](0008-fractional-ranks.md)                   | Fractional-index ranks with server-computed moves                     | Accepted |
| [0010](0010-filter-language-and-field-registry.md) | `IssueFilter` + field registry as the extension spine                 | Accepted |
| [0005](0005-api-as-contract.md)                    | The HTTP API is the contract; CLI local mode runs it in-process       | Accepted |
| [0009](0009-auth-v1.md)                            | Auth v1: actors, API tokens and cookie sessions                       | Accepted |
| [0011](0011-committed-openapi.md)                  | OpenAPI generated from code and committed                             | Accepted |
| [0012](0012-blob-storage.md)                       | Attachment bytes in a pluggable blob store (local disk or S3)         | Accepted |
| [0013](0013-webhook-delivery.md)                   | Webhooks delivered from the event log with durable, leased deliveries | Accepted |
