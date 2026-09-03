# Iteration 2 — workspaces and roles (design)

Status: **implemented in a modified form** (2026-07-20). By decision of the
product owner, OAuth was postponed: login and registration use email and
password; there is a landing page with a login form; users join a workspace via
an invite link with a default role (viewer, configurable by the owner); multiple
workspaces with a switcher. The sections below are preserved as the original
design; where they differ from the code, the code wins.

## Goal

Turn a tool for one team with one editor into a tool for several teams: OAuth
login, several workspaces per user, `owner / editor / viewer` roles,
invitations. There is no public sign-up (that is iteration 3): only invited
people get into the system.

## Already in place since iteration 1

- `workspace_id` in every table, query and unique key;
- the `membership (workspace_id, user_id, role)` table with a check constraint
  on roles;
- the workspace isolation test (`tests/test_workspace_isolation.py`);
- httpOnly-cookie sessions, audit log, rate limiting.

What remains is permission checks and dropping the hard dependency on the single
`WORKSPACE_SLUG` from the environment.

## 1. Authentication

**OAuth (Google, GitHub)** via the authorization code flow, without heavy
third-party dependencies (`httpx` plus a hand-written flow, or `authlib`).

New table:

```
oauth_account
  id uuid pk, user_id fk app_user, provider text check (in ('google','github')),
  subject text,                 -- stable user id at the provider
  email text, created_at,
  unique(provider, subject)
```

Login flow: `GET /auth/oauth/{provider}` → redirect → callback → find the
`oauth_account` or create `app_user` + `oauth_account` (auto-creation only when
an invitation exists for that email, otherwise 403 "invitation required").
Password login remains as a fallback for the installation owner
(`ADMIN_EMAIL`).

The session stays the same signed cookie; nothing is added to its payload — the
workspace is selected by the URL path, not by the session.

## 2. Workspaces in the API and UI

The URL scheme moves from an implicit workspace to an explicit one:

```
/api/v1/w/{workspace_slug}/timeline
/api/v1/w/{workspace_slug}/allocations
... (all domain routes)

GET  /api/v1/workspaces               — my workspaces (via membership)
POST /api/v1/workspaces               — create one (the creator becomes owner)
PATCH /api/v1/w/{slug}                — rename, timezone, settings
```

The `get_workspace(slug, user)` dependency returns the workspace **and the
user's role** in it; a missing membership yields 404 (not 403: we do not reveal
that other people's workspaces exist). Frontend: the slug in the URL
(`/w/{slug}/...`), a workspace switcher in the header, the last selected
workspace kept in localStorage.

Compatibility: the old paths such as `/api/v1/timeline` live for one release as
a redirect to the default workspace, then are removed.

## 3. Roles

| Action | owner | editor | viewer |
|---|---|---|---|
| View everything | ✔ | ✔ | ✔ |
| Allocations, absences, calendar, projects, closing weeks | ✔ | ✔ | — |
| Team (team members) | ✔ | ✔ | — |
| Participants and invitations | ✔ | — | — |
| Share links, workspace settings, backups | ✔ | — | — |
| Deleting the workspace | ✔ | — | — |

Implementation: `require_role("editor")` — a FastAPI dependency layered on
`get_workspace`, applied to mutating routers. Invariants: you cannot grant a
role higher than your own; the last `owner` cannot be demoted or removed; role
changes go to the audit log.

Viewer in the UI: the same screens, but the grid is in `readOnly` (the
component already supports this thanks to the public mode) and mutation
buttons are hidden.

## 4. Invitations

```
invitation
  id uuid pk, workspace_id fk, email text null, role text check (editor|viewer|owner),
  token_hash text unique, invited_by fk app_user,
  expires_at timestamptz, accepted_by fk null, accepted_at null,
  created_at
```

Two modes (both required by the spec):
- **by email**: the invitation is bound to an address; only a logged-in user
  with that email can accept it;
- **by link**: `email = null`, any logged-in user can accept — for quick team
  onboarding.

The token works like share-link tokens: 32 bytes, only the hash in the
database. Sending email is optional (`SMTP_*` in the environment); without
SMTP the owner copies the link by hand — that is the primary scenario for the
first release. The "Participants" page: the list with roles, role changes,
access revocation, active invitations.

## 5. Migrations and data

1. `oauth_account` and `invitation` are new tables (one migration).
2. The existing default workspace and the admin are already linked through
   `membership (owner)` — no data migration needed.
3. `WORKSPACE_SLUG` from the environment stops being the source of truth and
   remains only as the default workspace slug for the seed.

## 6. Tests

- permissions: a viewer cannot mutate (every mutating endpoint), an editor
  cannot see participants, 404 for someone else's workspace (extending the
  existing isolation test);
- invitations: acceptance by email/link, expiry, revocation, "last owner";
- OAuth: a mocked provider (swapped token/userinfo endpoint), auto-creation
  only via invitation.

## 7. Work order (each stage ships a working application)

| # | Stage | Size |
|---|---|---|
| 1 | Explicit workspace in the API and UI URLs, `get_workspace(slug)+role`, redirects from old paths | medium |
| 2 | `require_role`, viewer mode in the UI, permission tests | medium |
| 3 | Invitations + the "Participants" page (no SMTP) | medium |
| 4 | OAuth with Google, then GitHub; invitation-only login | medium |
| 5 | Multiple workspaces: creation, switcher, settings | small |

## Open questions (decision needed)

1. Which OAuth provider first — Google or GitHub? (affects order only)
2. Does the first iteration 2 release need email delivery of invitations, or
   are copyable links enough?
3. Keep password login after OAuth arrives, or leave it only for the owner's
   emergency access?
