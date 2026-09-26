#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web: make the repo test-ready in fresh containers.
set -euo pipefail

# Only run in remote (cloud) sessions; local developers manage their own environment.
if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
pnpm install --frozen-lockfile >/dev/null

# Start the throwaway Postgres cluster when server binaries are available, so `pnpm test:pg` works.
if bash scripts/pg.sh start >/dev/null 2>&1; then
  echo "export TEST_DATABASE_URL=$(bash scripts/pg.sh url)" >>"${CLAUDE_ENV_FILE:-/dev/null}"
fi
