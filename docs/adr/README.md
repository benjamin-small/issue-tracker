# Architecture decision records

Short records of decisions that constrain future work. Copy `0000-template.md`, take the next number, and keep it brief. Superseded ADRs stay in place with their status updated.

| #                                   | Decision                                                           | Status   |
| ----------------------------------- | ------------------------------------------------------------------ | -------- |
| [0001](0001-monorepo-layout.md)     | pnpm monorepo with source-exported internal packages               | Accepted |
| [0002](0002-dual-dialect-kysely.md) | One Kysely codebase for SQLite and Postgres; STRICT SQLite         | Accepted |
| [0003](0003-write-transactions.md)  | All writes through `withWriteTx` (BEGIN IMMEDIATE / advisory lock) | Accepted |
