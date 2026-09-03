# Tideline — Product & Technical Specification

*Original specification, translated from Russian. Some details describe iteration 1 and were later superseded; see docs/DECISIONS.md and docs/ITERATION-2.md.*

> **Name.** `Tideline`. A tideline is the line the tide leaves behind: a boundary that moves on its own and leaves a new pattern every time. It is a metaphor for a rolling planning window.
> Slug for hosting / domain: `tideline`.

---

## 1. Context and goal

A team of 5–9 engineers runs several projects in parallel. Management needs visibility into two things:

1. **What each engineer is working on** on specific dates, and on which project.
2. **Who is free, and how free**, within a given interval — to answer the question "I want to start a project in two weeks; do we have enough people?"

Today this lives in a spreadsheet. The spreadsheet does the job, but it requires manual work whenever a project is added, rows are inserted or weeks are rolled over, and it offers no real way to search for free capacity.

The planning specifics: the horizon is short. It is a **rolling two-week window** — in week N, weeks N and N+1 are planned; in week N+1, week N+1 is adjusted and N+2 is added.

**Goal of the first iteration:** replace the spreadsheet with a web service where data entry takes less time than in Google Sheets, and the question "who is free from 3 to 14 August" is answered by a single form rather than by eyeballing.

---

## 2. Users and scenarios

| Role | Who | What they do |
|---|---|---|
| Editor (iteration 1: exactly one) | team lead | maintains allocations and projects, closes weeks |
| Viewer | management, adjacent teams | looks via a read-only link, changes nothing |

**Key scenarios against which success is measured:**

- **S1.** Fill in the load for the whole team for a week — under two minutes, keyboard and mouse only, no dialog windows.
- **S2.** Answer "do we have enough people for a 15 person-day project from 3 to 14 August" — on a single screen, with concrete names.
- **S3.** Close the week and shift the window — one button, with an automatic snapshot into history.
- **S4.** A manager opens a link and sees the current picture without logging in and without being able to break anything.
- **S5.** Understand where the plan diverged from the actual over the last month.

---

## 3. Scope of the first iteration

**In scope:** one workspace, one editor (password in env), read-only link by token, timeline, project registry and project cards, free-capacity search, week close with snapshot, plan vs. actual, export, backups, audit log.

**Out of scope (iterations 2–3):** OAuth/SSO, multiple workspaces in the UI, a role model, invitations, public sign-up, tracker integrations, mobile editing, notifications.

**Important:** the DB schema and the data-access layer are designed for multi-tenancy **from day one** (see §5). In the first iteration there is simply exactly one workspace and one user, but `workspace_id` is present in every table and every query. Retrofitting multi-tenancy into a working single-user schema is an expensive and painful operation that must be avoided up front.

---

## 4. Functional requirements

### 4.1 Timeline (main screen)

A grid: rows are team members, columns are calendar working days.

- Default horizon is **2 weeks**, with switches to 4 and 6 weeks. The window always starts on the Monday of the current week; it can be paged backwards and forwards.
- Weekends and public holidays (a per-workspace calendar of non-working days) are visually muted and **do not count towards capacity**.
- Each team member is a collapsible block:
  - **Collapsed view (default):** a single row with the total load per day, coloured by level.
  - **Expanded view:** one row per project with fractions of the day, plus a totals row.
- Colour encodes **only the load level**, never the project. The project is read as text.
  - `0` — free, `0 < x < 1` — partial, `x = 1` — fully loaded, `x > 1` — overload.
  - An absence (vacation, sick leave) has its own hatching; the day's capacity is then zero.
- Bottom totals rows, sticky when scrolling:
  - "Free, person-days" per day;
  - a total per week;
  - team utilisation percentage over the window.
- A right-hand column per person: busy / free person-days over the window.
- The week header marks **actual** (current and past weeks) and **plan** (future weeks) — plan is rendered more muted.

### 4.2 Input and editing

Input must be faster than in a spreadsheet. This is the main acceptance criterion.

- **Click on a cell** — an inline editor for the fraction of the day. Quick keys: `1` = 1.0, `5` = 0.5, `2` = 0.25, `7` = 0.75, `0` / `Delete` = clear. *[Editor's note: since this specification was written, numeric load input has been replaced by four load categories — Background ¼ · Half day ½ · Most of the day ¾ · Full day 1.]*
- **Arrow-key navigation** between cells, `Tab` — right, `Enter` — down, as in a spreadsheet.
- **Drag-fill** horizontally — fill a range of days with the same value.
- **Rectangular selection** and entry of a single value over the whole selection.
- **Copy week:** "duplicate week 1 into week 2" as a single command.
- **Adding a project to a team member** — from a search box directly inside the member's block, with no modals and no row insertion. The project list is filtered by status: finished projects are not offered, but they remain in historical data.
- All changes are **optimistic**, with autosave and a network-state indicator. No "Save" buttons.
- **Undo/Redo** (`Cmd+Z` / `Cmd+Shift+Z`) over the last 50 actions within a session.
- Validation: the fraction of a day is from the set `{0.25, 0.5, 0.75, 1.0}`, plus any value from 0 to 1 in steps of 0.05. A total load **above 1 is allowed** and is highlighted as overload — it must not be forbidden; overload has to be seen, not hidden.

### 4.3 Free-capacity search (scenario S2)

A dedicated "Enough people?" panel.

Input: a date range, the required volume in person-days, and optionally the required skills/tags and a minimum fraction of the day per person (e.g. "not less than 0.5; splitting any finer is pointless").

Output:
- the total free capacity in the range and a verdict: "Enough / Not enough, shortfall N person-days";
- a list of candidates sorted by free capacity, with a per-day breakdown;
- warnings per candidate:
  - **`bus factor`** — the team member is flagged as the sole expert on an active project;
  - **fragmentation** — free time is scattered in half-day pieces with no contiguous block;
  - **vacation** inside the range;
  - **plan, not actual** — if the range is further out than two weeks, the estimate is less reliable.

This panel is the reason the service exists. It must not be hidden in a menu.

> **A product constraint that must be reflected explicitly in the UI.** Free capacity answers the question "is there time", not "can this person be switched". A formally free person may be the sole holder of key expertise. Therefore the "team member × project" link carries an `is_sole_owner` flag, and candidates with it are always shown with a warning, never silently.

### 4.4 Project registry and project card

**Registry** — a table of all projects: code, name, owner, health status (green / amber / red), phase, next milestone with its date, "what changed this week", lifecycle status (active / paused / finished), current number of people engaged.

Sorting and filtering by status and owner. Finished projects are hidden by default.

**Project card** — two strictly separated zones:

*Top — live status (changes weekly):* health status, phase, owner, next milestone, blockers, the week's update, date of the last update. Plus an update log: newest entry on top, date set automatically.

*Bottom — substantive part (changes rarely):* goal, tasks and milestones with owners and status, out-of-scope tasks with the reason for rejection, architecture and artifacts, dependencies, risks with mitigations, decision log, links with a note on whom to ask for access.

Additionally on the card: a **project load widget** — who is engaged on the project and how much within the current window, with total person-days. This ties the registry to the timeline and is the main advantage over two separate spreadsheets.

Fields in the substantive part are markdown with preview.

### 4.5 Rolling window and week close

The **"Close week"** button performs, transactionally:

1. A snapshot of the week being closed into `week_snapshot` (actual).
2. A comparison against the plan previously recorded for this week, and recording of the discrepancy.
3. Shifting the window one week forward; week N+1 becomes the current one.
4. Recording the plan for the new week N+2 at the moment it is first filled in (a "plan" snapshot).
5. An audit log entry.

The operation is **reversible** within 24 hours ("Reopen week" button).

Reminder: if a week has not been closed by Tuesday, an unobtrusive banner appears in the header.

### 4.6 Plan vs. actual

The "Planning accuracy" screen: over the last N weeks, how closely the plan recorded a week earlier matched the actual. Metrics: mean absolute error per team member, the share of weeks where "free" capacity was never used, top projects that consistently consume more than planned.

This is not reporting for its own sake — it is the only objective way to calibrate the load-estimation scale.

### 4.7 Export and sharing

- Export of the current window to **XLSX** and **CSV** (a format that mirrors the current spreadsheet — for those who are used to it).
- Export of the project registry to XLSX.
- A **read-only link** with a token: `/s/{token}`. Opens the timeline and the registry in read mode, without login. The token can be revoked and re-issued. Optionally — an expiry.
- A link to a specific view preserves its state: date range, filters, collapsed/expanded mode.

### 4.8 Audit log and input reliability

- `audit_log` for all changes to allocations, projects and team members: who, what, old and new value, when.
- Change history is visible on the project card and in the team member's block.
- Soft delete (`deleted_at`) for team members and projects: nothing disappears physically.

---

## 5. Data model

PostgreSQL. Every table contains `workspace_id` with a foreign key and an index, even in the first iteration.

```
workspace
  id uuid pk, slug text unique, name text, timezone text default 'UTC',
  week_starts_on smallint default 1, default_horizon_weeks smallint default 2,
  created_at, updated_at

app_user                       -- exactly one row in iteration 1
  id uuid pk, email text unique, name text, password_hash text,
  is_superuser bool, created_at, last_login_at

membership                     -- groundwork for the iteration-2 role model
  id uuid pk, workspace_id fk, user_id fk,
  role text check (role in ('owner','editor','viewer')),
  created_at, unique(workspace_id, user_id)

member                         -- team member
  id uuid pk, workspace_id fk, name text, role_title text,
  capacity_per_day numeric(3,2) default 1.00,
  tags text[],                 -- skills: 'cuda','rag','infra'
  sort_order int, is_active bool default true,
  deleted_at timestamptz null, created_at, updated_at

project
  id uuid pk, workspace_id fk, code text, name text,
  lifecycle text check (lifecycle in ('active','paused','finished')) default 'active',
  rag_status text check (rag_status in ('green','amber','red')) default 'green',
  phase text, owner_member_id fk null,
  next_milestone text, next_milestone_date date,
  weekly_update text, goal text, scope_md text, out_of_scope_md text,
  architecture_md text, dependencies_md text, risks_md text,
  decisions_md text, links_md text,
  status_updated_at timestamptz,
  deleted_at timestamptz null, created_at, updated_at,
  unique(workspace_id, code) where deleted_at is null

project_update                 -- update log on the project card
  id uuid pk, workspace_id fk, project_id fk,
  body text, rag_status_after text null,
  created_by fk, created_at

milestone
  id uuid pk, workspace_id fk, project_id fk, title text,
  due_date date, status text check (status in ('planned','in_progress','done','dropped')),
  owner_member_id fk null, sort_order int

allocation                     -- the core of the system
  id uuid pk, workspace_id fk, member_id fk, project_id fk,
  day date, load numeric(3,2) check (load > 0 and load <= 1),
  is_sole_owner bool default false, note text,
  created_by fk, created_at, updated_at,
  unique(workspace_id, member_id, project_id, day)

absence
  id uuid pk, workspace_id fk, member_id fk,
  date_from date, date_to date,
  kind text check (kind in ('vacation','sick','holiday','other')),
  note text, created_at

non_working_day                -- public-holiday calendar
  id uuid pk, workspace_id fk, day date, title text,
  unique(workspace_id, day)

week_snapshot
  id uuid pk, workspace_id fk, week_start date,
  kind text check (kind in ('plan','fact')),
  payload jsonb,               -- full copy of the week's allocations
  created_at, unique(workspace_id, week_start, kind)

share_link
  id uuid pk, workspace_id fk, token text unique,
  scope text default 'read',
  expires_at timestamptz null, revoked_at timestamptz null,
  created_at, last_accessed_at

audit_log
  id bigserial pk, workspace_id fk, actor_user_id fk null,
  entity_type text, entity_id uuid, action text,
  before jsonb, after jsonb, created_at
```

**Indexes:** `allocation (workspace_id, day)`, `allocation (workspace_id, member_id, day)`, `allocation (workspace_id, project_id, day)`, `audit_log (workspace_id, created_at desc)`.

**Invariants enforced at the DB and application level:**

- An allocation cannot reference a finished project **on creation** (existing ones are left untouched).
- An allocation is not created on a non-working day or on a day that falls within the team member's absence; an attempt produces a clear error suggesting to remove the absence first.
- The sum of `load` per team member per day is **not capped** — overload is legal and is displayed.
- All data access goes through a layer that mandatorily takes `workspace_id`. No repository method may be able to operate without it.

---

## 6. API

REST, prefix `/api/v1`, JSON, authentication via an httpOnly session cookie; for read-only access — via a token in the path.

```
POST   /auth/login                       {email, password} -> set-cookie
POST   /auth/logout
GET    /auth/me

GET    /timeline?from=&to=               aggregated response for the grid:
                                         team members, their allocations, absences,
                                         non-working days, computed per-day totals
POST   /allocations                      {member_id, project_id, day, load}
POST   /allocations/bulk                 bulk fill over a range (drag-fill)
PATCH  /allocations/{id}                 {load, note, is_sole_owner}
DELETE /allocations/{id}
POST   /allocations/copy-week            {from_week_start, to_week_start, mode: replace|merge}

GET    /capacity/search                  ?from=&to=&needed_person_days=&min_daily=&tags=
                                         -> verdict, candidates, warnings

GET    /members                          POST /members  PATCH /members/{id}  DELETE /members/{id}
POST   /members/reorder
GET    /absences                         POST /absences  DELETE /absences/{id}

GET    /projects                         ?lifecycle=&owner=
POST   /projects                         PATCH /projects/{id}   DELETE /projects/{id}
GET    /projects/{id}                    the whole card, including milestones, updates and load
POST   /projects/{id}/updates            add an entry to the update log
GET    /projects/{id}/load?from=&to=     project load widget

POST   /weeks/close                      {week_start} -> snapshot + window shift
POST   /weeks/close/undo                 {week_start}
GET    /weeks/accuracy?weeks=8           plan vs. actual

GET    /export/timeline.xlsx?from=&to=
GET    /export/projects.xlsx

POST   /share-links                      create a read-only link
DELETE /share-links/{id}                 revoke
GET    /s/{token}/timeline               public read-only slice
GET    /s/{token}/projects

GET    /admin/backups                    list of backups
POST   /admin/backups/run                on-demand backup
GET    /healthz                          liveness
GET    /readyz                           readiness (checks the DB)
```

`GET /timeline` must return everything needed for rendering **in a single request** — N+1 in the grid is unacceptable. The response for two weeks and nine people must fit within 200 ms on a warm DB.

---

## 7. Architecture and stack

**Backend:** Python 3.12, FastAPI, SQLAlchemy 2.x (async), Alembic, Pydantic v2, `uv` for dependencies.

**Frontend:** React 18 + TypeScript + Vite, TanStack Query for server state, Tailwind. Row virtualisation is not needed for the grid with nine team members, but the grid component must be written so that it can be added.

**The grid is a custom component, not an off-the-shelf table library.** The keyboard, drag-fill and nested-row requirements map poorly onto generic grids, and fighting someone else's abstractions would cost more than a custom implementation on CSS Grid.

**Build:** the frontend is built into static assets, and FastAPI serves them with an SPA fallback. One hosted service instead of two — lower cost, no CORS, simpler deployment.

**Migrations:** Alembic only, auto-applied in the release phase after a backup (see §9).

**Time zone:** all allocation dates are `date` without time, interpreted in the workspace's time zone. No `timestamp` for planning days — that is the classic source of off-by-one-day shifts.

---

## 8. Deployment

One hosting project (a PaaS such as Railway), with `production` and `staging` environments.

**Services:**

1. `web` — the application. Multi-stage Dockerfile: frontend build on node, then a python image. Port from `$PORT`. Healthcheck on `/healthz`.
2. `postgres` — managed Postgres from the hosting provider.
3. `cron-backup` — a scheduled service, daily backup (see §9).
4. `cron-verify` — weekly backup restorability check.

**Environment variables:**

```
DATABASE_URL                 (from the hosting provider)
SECRET_KEY                   session signing
ADMIN_EMAIL, ADMIN_PASSWORD  seed for the first user
APP_BASE_URL
WORKSPACE_SLUG=main
TZ=UTC
BACKUP_S3_ENDPOINT           S3-compatible storage (Cloudflare R2 / Backblaze B2)
BACKUP_S3_BUCKET
BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY
BACKUP_ENCRYPTION_KEY        age/gpg key for encrypting dumps
BACKUP_RETENTION_DAILY=7 / WEEKLY=4 / MONTHLY=6
SENTRY_DSN                   optional
LOG_LEVEL=INFO
```

**Release phase:** `alembic upgrade head` runs **only after** a successful pre-deploy backup. If the backup fails, the deployment stops.

The hosting configuration (e.g. `railway.json` / `railway.toml`) must live in the repository, so that the configuration is code rather than clicks in a UI.

---

## 9. Backups and recovery

This is a mandatory part of the first iteration, not "later". The service holds the only copy of the team's plans; losing data means losing trust in the tool forever.

### 9.1 What and where

- **Daily logical dump** `pg_dump -Fc` at 03:00 in the workspace's time zone.
- **Daily human-readable JSON export** of the workspace (team members, projects, allocations, snapshots) — a recovery path independent of the PostgreSQL version, and at the same time a format for migrating to another stack.
- Both artifacts are **encrypted** (`age`) and stored in S3-compatible storage **outside the hosting provider**. A backup in the same infrastructure as the DB is not a backup.
- Names: `tideline/{env}/{YYYY-MM-DD}/dump.pgc.age` and `.../export.json.age`.

### 9.2 Rotation

7 daily, 4 weekly (Sundays), 6 monthly (the 1st of the month). Expired artifacts are deleted by the same cron service, with a log of what was deleted.

### 9.3 Additional backup points

- **Before every migration** — an automatic dump tagged `pre-migration-{revision}`.
- **Before closing a week** — a snapshot into `week_snapshot` (this is an application-level logical backup; it does not replace the physical one).

### 9.4 Restorability check

A weekly job: spin up a temporary DB, restore the latest dump, run a set of checks (number of team members, number of allocations over the last month, the sum of `load` for the past week matches the expected value), then drop the temporary DB. The result goes to the log and to `/admin/backups`.

**An unverified backup must be treated as non-existent.** This job is not optional.

### 9.5 Recovery

- A documented procedure in `docs/RESTORE.md` with exact commands.
- `make restore FILE=...` — a script that decrypts, restores into the specified DB and prints a summary.
- In `/admin/backups` — a list of artifacts with size, date, verification status and a download button.
- **Targets:** RPO ≤ 24 hours, RTO ≤ 1 hour.
- A README section: "What to do if everything is down" — step by step, for a person under stress.

---

## 10. Observability and operations

- Structured JSON logs with `request_id` and `workspace_id`.
- Metrics at `/metrics` (Prometheus format): latency per endpoint, number of allocations, status of the last backup.
- Sentry for exceptions, if a DSN is set.
- `/healthz` — the process is alive; `/readyz` — the DB responds and migrations are applied.
- A dedicated `backup_last_success_timestamp` metric — it allows an alert "no backup for more than 30 hours".

---

## 11. Security

- Passwords — `argon2`. Sessions — httpOnly + Secure + SameSite=Lax cookie.
- Rate limiting on `/auth/login` and on the public `/s/{token}/*`.
- Link tokens — at least 32 bytes of entropy, stored hashed, invalid immediately upon revocation.
- The public mode returns **only** the necessary fields: names, projects and load; no notes, audit logs or internal links. This must be guaranteed by separate serializers, not by a flag in a shared one.
- CSP, HSTS, `X-Powered-By` disabled.
- No secrets in the repository; `.env.example` describing the variables.

---

## 12. Interface requirements

- **Density before beauty.** Two weeks for nine people must fit on a laptop screen without horizontal scrolling.
- The load-level palette is muted and distinguishable under colour-blindness (not just red/green: overload is additionally marked with diagonal hatching or an icon).
- The first column with names is pinned **only** when there is horizontal scrolling, i.e. with a horizon longer than two weeks. On the two-week horizon no pinning is needed.
- Dark theme — following the system setting.
- Mobile mode — read-only, a vertical list by team member. Nobody will edit the grid from a phone, and there is no need to pretend otherwise.
- Empty states explain what to do next rather than just saying "no data".
- All actions are reachable from the keyboard; `?` opens the list of keyboard shortcuts.

---

## 13. Acceptance

The iteration is considered done when all of the following hold:

1. The load of a 7-person team for two weeks is entered from scratch in under 2 minutes, keyboard only.
2. The capacity-search panel answers the query "15 person-days from 3 to 14 August" with a verdict and a list of candidates with warnings.
3. Closing a week creates a snapshot, shifts the window, and is reverted with a button.
4. The planning-accuracy screen shows the plan/actual discrepancy for at least 4 weeks of demo data.
5. The read-only link opens in an incognito window, shows the timeline and does not allow any changes; after revocation it returns 404.
6. The XLSX export opens in Google Sheets without errors.
7. The backup runs on schedule, is encrypted, lands in the bucket and is rotated; the weekly verification restores the dump and passes the checks.
8. `make restore` restores yesterday's dump into a clean DB, the application starts on it and shows the same data.
9. Deployed to the hosting provider from the repository, migrations apply automatically, the deployment fails if the pre-deploy backup failed.
10. `pytest` is green, and coverage of the business logic (capacity calculation, capacity search, week close) is at least 80%.

---

## 14. Tests

- **Unit:** free-capacity calculation taking into account vacations, holidays and part-time capacity; candidate ranking; week close and reopen logic.
- **Integration:** the API over a real DB in a container, including isolation by `workspace_id` — a test verifying that a request with someone else's `workspace_id` returns no data. Write it now, while there is one workspace, not when there are many.
- **E2E (Playwright):** scenarios S1–S4.
- **Backup test:** dump → restore → checksum comparison over the key tables.

---

## 15. Demo data

The `make seed` script populates the workspace: 7 team members, 6 active and 2 finished projects, allocations for 6 weeks back and 2 forward, a couple of vacations, snapshots of closed weeks for the accuracy screen, one overloaded team member and one with the `is_sole_owner` flag — so that the warnings are visible right away.

---

## 16. Repository structure

```
tideline/
├── backend/
│   ├── app/
│   │   ├── api/v1/           routers
│   │   ├── core/             config, security, dependencies
│   │   ├── db/               models, session, repositories
│   │   ├── domain/           business logic: capacity, search, week close
│   │   ├── services/         export, backups, snapshots
│   │   └── main.py
│   ├── alembic/
│   └── tests/
├── frontend/
│   └── src/
│       ├── components/timeline/    grid, cell, team member block
│       ├── components/projects/
│       ├── features/capacity-search/
│       ├── api/                     client and types generated from OpenAPI
│       └── ...
├── ops/
│   ├── backup.py             dump, encryption, upload, rotation
│   ├── verify_backup.py      restore into a temporary DB and checks
│   └── restore.sh
├── docs/
│   ├── RESTORE.md
│   ├── ARCHITECTURE.md
│   └── DECISIONS.md          ADRs: why a custom grid, why one service, etc.
├── railway.toml
├── Dockerfile
├── Makefile
└── README.md
```

---

## 17. Roadmap for the next iterations

**Not now**, but do not close the door.

**Iteration 2 — workspaces and roles.** Sign-up and OAuth (Google/GitHub), several workspaces per user, a workspace switcher, `owner/editor/viewer` roles via the `membership` table, invitations by email and by link, a participants page. The `workspace_id` check is already everywhere — only the permission check remains to be added.

**Iteration 3 — public positioning.** Landing page, self-service sign-up, pricing or a fully open-source release, workspace templates, onboarding. A personal workspace stays private: access only by invite or by link, no indexing, no public catalogue of workspaces.

**Later, as needed.** Import from Jira/YouTrack, webhooks, a Slack/Telegram bot with a weekly reminder and summary, a skills matrix, planning by role rather than by name, "what if" scenario modelling.

---

## 18. Explicit non-goals

So that nobody — human or coding agent — tries to build these:

- This is **not a task tracker**. There are no tasks, only fractions of a day on projects. No task statuses, boards or dependencies.
- This is **not a Gantt chart with a critical path**. Dependencies between projects are not modelled.
- This is **not a timesheet**. Actual hours worked are not collected and never will be — that encourages performative busyness and kills trust in the tool.
- This is **not a leave-management system**. Absences exist only to subtract capacity correctly.
- The planning horizon is deliberately short. Quarterly resource planning is a separate class of problem and must not be mixed in.
