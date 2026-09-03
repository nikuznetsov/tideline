# ADR — decision log

## ADR-1. A custom grid instead of an off-the-shelf table

**Context.** The main screen is a grid driven by keyboard input (hotkeys for
load categories), drag-fill, rectangular selection and collapsible team member
blocks with nested project rows.

**Decision.** Build the grid ourselves on CSS Grid plus keyboard/mouse handlers.

**Why.** Generic grids (AG Grid, Handsontable, TanStack Table) assume a
"cell = record field" model. Our cell is (team member × project × day) with an
aggregate row on top, nested rows and a read-only mode for the public link.
Fighting someone else's abstractions (custom editors, key interception, nested
rows, state styling) would cost more than writing our own, and the bundle would
be heavier. Virtualization is unnecessary for 9 team members; the navigation
model (a flat list of editable rows) lets us add it later.

## ADR-2. One service: FastAPI serves the SPA

**Decision.** The frontend is built to static files and served by FastAPI with
an SPA fallback.

**Why.** One service instead of two: lower cost, no CORS, a single place for
TLS and security headers, a single deploy. The downside is that a frontend
release requires rebuilding the image; for a single-team tool that does not
matter.

## ADR-3. `workspace_id` everywhere from day one

**Decision.** All tables, queries, unique keys and indexes include
`workspace_id`, even though there is only one workspace.

**Why.** Retrofitting multi-tenancy into a live single-user schema is expensive
and risky (data migration, rewriting every query, rebuilding unique indexes).
The cost today is one column and discipline in the data access layer; the
isolation test was written before a second workspace existed.

## ADR-4. Days are `date`, not `timestamp`

**Decision.** Allocations, absences and holidays are stored as calendar dates.

**Why.** A planning day is a day in the team's timezone, not an instant in
time. `timestamp` plus conversions is the classic source of off-by-one-day
errors around midnight and DST transitions.

## ADR-5. Week snapshots are self-contained JSON

**Decision.** "Close week" writes a complete copy of the allocations, including
names and codes, into `week_snapshot.payload`; the plan/actual diff is computed
from snapshots.

**Why.** History must not change retroactively when a project is renamed or a
team member is deleted. The snapshot also serves as an application-level
logical backup and as the input for the planning accuracy screen.

## ADR-6. Link tokens are stored as hashes

**Decision.** A read-only token (32 bytes of entropy) is shown once; the
database holds its SHA-256 hash and an 8-character prefix for the UI.

**Why.** A leaked database dump must not expose working links. Revocation is
`revoked_at` and takes effect immediately; an invalid token gets a 404 without
revealing whether the link exists.

## ADR-7. Backups: off-host, encrypted, restore-tested

**Decision.** `pg_dump -Fc` plus a JSON export, age encryption, an
S3-compatible bucket (R2/B2), 7/4/6 rotation, a weekly test restore with
checks, a pre-deploy dump before migrations, and the deploy fails if the backup
fails.

**Why.** A backup on the same infrastructure as the database is not a backup.
An unverified backup counts as no backup. The JSON export is insurance against
PostgreSQL version incompatibility and a migration path to another stack.

## ADR-8. Team member = workspace participant

**Decision.** A timeline row (`member`) must reference an account
(`member.user_id → app_user`); people are added to the team by picking from the
participants, there is no free-text name entry. The reverse does not hold: a
participant may have access without being on the timeline (management,
adjacent teams).

**Why.** Two unrelated entities — "a person being planned" and "a person with
access" — duplicated each other and drifted apart. Invariants: one active row
per account (partial unique index); revoking access soft-deletes the timeline
row; allocation history is preserved. `user_id` allows NULL only for historical
soft-deleted rows.
