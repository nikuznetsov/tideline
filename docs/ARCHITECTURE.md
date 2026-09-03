# Tideline architecture

## Overview

A single deployment: FastAPI serves the REST API under `/api/v1` and the
frontend static bundle with an SPA fallback. PostgreSQL is the only data store.
Backups run from the same Docker image, either as Railway cron services or as
plain crontab entries on a VM.

```
browser ── /            → static files (React SPA)
        ── /api/v1/*    → FastAPI (cookie session)
        ── /api/v1/s/*  → public read-only views (token in the path)
        ── /healthz /readyz /metrics

FastAPI ── SQLAlchemy 2 async ── PostgreSQL
cron-backup ── pg_dump + JSON → age → S3 (R2/B2, outside the app's hosting)
cron-verify ── S3 → temporary DB → checks → .verified marker
```

## Backend (`backend/app`)

- `api/v1/` — routers. Kept thin: validation, a domain call, an audit entry.
- `core/` — config (pydantic-settings), sessions (itsdangerous, httpOnly
  cookie), argon2, rate limiting, observability and security-header middleware.
- `db/` — SQLAlchemy models and the session factory. **Every table carries a
  `workspace_id`**; unique keys and indexes include it.
- `domain/` — business logic with no FastAPI dependency: `capacity` (capacity
  and resource search), `timeline` (the aggregate behind the grid),
  `week_close` (plan/actual snapshots, reopen), `accuracy` (plan vs. actual),
  `calendar`. Every function takes `workspace_id` as its first meaningful
  argument — there is no "across all workspaces" query anywhere in the codebase.
- `services/` — XLSX/CSV export (openpyxl), audit log, backup access.

### Multi-tenant from day one

Iteration 1 shipped with exactly one workspace (`WORKSPACE_SLUG`) and one user
(`ADMIN_EMAIL`/`ADMIN_PASSWORD`, seeded at startup). Even so:

- `workspace_id` is present in every table, query and index;
- `membership` already exists for the iteration 2 roles;
- an isolation integration test (`tests/test_workspace_isolation.py`) verifies
  that another workspace can be neither read nor mutated.

### Key data decisions

- Allocation days are a plain `date` with no time component, interpreted in the
  workspace timezone.
- `allocation.category` is a fixed load category
  (`background` ¼ · `half` ½ · `most` ¾ · `full` 1); the weights live in
  `app/domain/categories.py` and all aggregates are computed from them. **The
  sum of weights per day is not capped** — overload is legal and is highlighted.
- A week snapshot is a complete JSON copy of the allocations
  (`week_snapshot.payload`) and is self-contained: the plan/actual diff is
  computed from snapshots, not from the live tables.
- Soft delete via `deleted_at` on team members and projects; `audit_log`
  records the old and new value for every mutation.
- Read-only link tokens are stored as SHA-256 hashes; only a short prefix for
  display ends up in the database.

## Frontend (`frontend/src`)

- TanStack Query holds server state; every grid edit is optimistic: aggregates
  are recomputed locally (`applyCells`) and sent with `POST /allocations/bulk`;
  on error the query is invalidated and the grid falls back to the server truth.
- Undo/redo is a 50-operation stack per session; an operation is a set of
  cells before/after.
- The grid is a custom CSS Grid component (see DECISIONS.md): keyboard input,
  drag-fill via a handle, rectangular selection, collapsible team member blocks.
  There is no virtualization, but rows form a flat list, so it can be added
  without changing the navigation model.
- The public mode at `/s/{token}` reuses the same grid in `readOnly` and talks
  to separate public endpoints with trimmed serializers.

## Observability

- Structured JSON logs (structlog) with a `request_id`.
- `/metrics` — Prometheus: per-endpoint latency, allocation count,
  `backup_last_success_timestamp` (alert when > 30 hours — no backup ran).
- `/healthz` — the process is alive; `/readyz` — the database responds.
- Sentry is enabled when `SENTRY_DSN` is set.

## Performance

`GET /timeline` builds the window with a fixed number of queries (team members,
allocations, absences, holidays, snapshots) regardless of team size — no N+1.
A two-week window for 9 people costs single-digit milliseconds of database time.
