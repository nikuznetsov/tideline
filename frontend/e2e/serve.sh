#!/usr/bin/env bash
# Starts the backend for E2E: fresh sqlite, migrations, seed, built static assets.
set -euo pipefail
cd "$(dirname "$0")/../../backend"

PY=python
[ -x .venv/bin/python ] && PY=.venv/bin/python

export DATABASE_URL=sqlite+aiosqlite:///./e2e.db
rm -f e2e.db
$PY -m alembic upgrade head
$PY -m app.seed
exec $PY -m uvicorn app.main:app --port 8177
