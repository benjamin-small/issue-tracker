# Contributing

Start with the [README](README.md) for setup and
[development guide](docs/development.md) for the supported workflows.
Use Node 22 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs typechecking, linting, formatting checks, and the SQLite
test suite. It must pass before every commit. Follow [AGENTS.md](AGENTS.md)
for architecture rules and repository conventions.

Keep changes focused and describe their purpose and validation in the pull
request. Add tests for changed behavior. Database changes must be tested with
both SQLite and Postgres (`pnpm pg start`, then `pnpm test:pg`). API changes
require `pnpm openapi:gen`; CLI changes may require refreshing golden files
and the CLI reference as described in AGENTS.md. Record architectural decisions
in `docs/adr/`.

Run the relevant browser, demo, and deployment checks described in the
development guide when changing those paths. Do not commit credentials, local
databases, or generated build artifacts.
