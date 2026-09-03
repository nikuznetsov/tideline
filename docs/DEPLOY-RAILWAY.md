# Deploying Tideline on Railway with a custom domain

Step by step: from nothing to a running service on your own domain with demo
data, where a manager logs in as **owner**.

You will need: a [railway.com](https://railway.com) account on the **Hobby**
plan (~$5/month — required for a custom domain and an always-on service),
access to the `tideline` repository on GitHub, and a domain (the examples below
use `tideline.example.com`) managed at any DNS provider.

---

## Step 1. Project and database

1. Railway → **New Project** → **Deploy from GitHub repo** → pick `tideline`.
   Railway detects `railway.toml` and the `Dockerfile` and starts building the
   image. The first build fails (no database, no variables) — that is expected,
   carry on.
2. In the project → **New** → **Database** → **Add PostgreSQL**. A `Postgres`
   service appears.
3. Open the application service (`web`) → **Variables** tab → configure as
   described below.

---

## Step 2. Environment variables

Generate two secrets locally (in a terminal):

```bash
openssl rand -hex 32   # this is SECRET_KEY
openssl rand -hex 24   # this is METRICS_TOKEN
```

In the `web` service → **Variables** add:

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | database URL (Railway fills it in) |
| `SECRET_KEY` | *(output of the first command)* | signs session cookies |
| `ADMIN_EMAIL` | `admin@example.com` | the owner login (this is what you hand to the manager) |
| `ADMIN_PASSWORD` | *(pick a strong one)* | the owner password |
| `APP_BASE_URL` | `https://tideline.example.com` | base for links, enables https mode |
| `WORKSPACE_SLUG` | `main` | slug of the default workspace |
| `WORKSPACE_NAME` | `Main` | name of the default workspace |
| `PORT` | `8000` | port the app listens on (must match the port field of the Custom Domain) |
| `TZ` | `UTC` | timezone |
| `LOG_LEVEL` | `INFO` | logging |
| `METRICS_TOKEN` | *(output of the second command)* | protects `/metrics` from outsiders |
| `SKIP_PREDEPLOY_BACKUP` | `1` | do not block the deploy until backups are configured |

> `${{Postgres.DATABASE_URL}}` is a reference to a variable of the neighbouring
> service; type it exactly like that and Railway resolves it. Strictly speaking
> `PORT` is optional — Railway injects it on its own.

Save — Railway redeploys. Wait for the green status and the `/healthz` check.
The app already lives at a temporary address `https://<something>.up.railway.app`
(visible under **Settings → Networking → Public Networking**).

Check: open that address — you should see the Tideline landing page. You can log
in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, but the workspace is empty for now —
we fill it with demo data in the next step.

---

## Step 3. Demo data (a mock for the manager)

1. In `web` → **Variables** add `SEED_DEMO` = `1`.
2. Click **Deploy** (or wait for the auto-deploy). The deploy logs show
   `seeding demo data` and `Demo data loaded.` — the `main` workspace receives
   7 team members, 8 projects (6 active + 2 finished), load for 6 weeks back and
   2 weeks ahead, vacations, closed weeks with plan/actual, an overloaded team
   member and a "sole expert".
3. **Immediately after a successful deploy, remove the `SEED_DEMO` variable**
   (or set it to `0`). Otherwise every subsequent deploy overwrites the data
   with the demo set again.

The `ADMIN_EMAIL` account is the **owner** of this workspace, i.e. it sees and
can do everything: timeline, projects, plan/actual accuracy, team,
participants, invites, share links, settings. This is the test user for the
manager.

---

## Step 4. The domain

### 4.1. Attach the domain in Railway

1. `web` → **Settings** → **Networking** → **Custom Domain** → enter
   `tideline.example.com`, then add `www.tideline.example.com` as well.
2. Railway shows the **exact CNAME target** (something like
   `abc123.up.railway.app`). **Use exactly the value Railway shows** — below it
   is referred to as `<railway-target>`.
3. If Railway asks for a **port** for the domain, enter `8000` (the same as the
   `PORT` variable; the app listens on it, while HTTPS/443 is terminated by
   Railway).

### 4.2. Configure DNS at your provider

**Delegation first.** If the zone is not yet delegated to your DNS provider's
name servers, set the provider's NS records at your registrar. Until the zone
is delegated, no records will work.

**Records.** One subtlety: a `CNAME` cannot be placed on the bare apex (it
conflicts with SOA/NS — most providers reject it with an error like
"conflicts with pre-existing RRset"). For the apex, use your provider's
**ALIAS** / **ANAME** / "CNAME flattening" record type — a "CNAME for the
apex" — which is exactly what is needed.

Create two records in the zone:

| Type | Name | Value | TTL |
|---|---|---|---|
| **ALIAS** | *(empty = apex)* | `<railway-target>.` *(with the trailing dot)* | 3600 |
| **TXT** | `_railway-verify` | `railway-verify=…` *(the full string from Railway)* | 3600 |

`<railway-target>` is the value Railway shows under "Configure DNS Records"
(something like `in7cjahj.up.railway.app`). The apex domain then works
directly; keep `APP_BASE_URL` at `https://tideline.example.com`.

> If you also want `www`, add a separate `CNAME` `www` → `<railway-target>`
> (CNAME is allowed on a subdomain) and add `www.tideline.example.com` to the
> Railway Custom Domain list.

### 4.3. Wait for TLS

Once DNS is visible, Railway issues a Let's Encrypt certificate on its own (a
few minutes to an hour while DNS propagates). A green check mark appears next
to the domain under **Custom Domain**. Open `https://tideline.example.com` —
the site should load over https.

If you changed `APP_BASE_URL`, Railway redeploys; make sure the value matches
the address you actually give to the manager.

---

## Step 5. What to hand to the manager

- **URL:** `https://tideline.example.com`
- **Login:** the value of `ADMIN_EMAIL` (`admin@example.com`)
- **Password:** the value of `ADMIN_PASSWORD`
- **Role:** owner — everything is available.

What to look at: the **Timeline** tab (the "people × days" grid, keyboard load
entry), **Projects** (cards, health, updates), **Accuracy** (plan vs. actual
for closed weeks), **Team** (team members + participants with roles, invite
links, a read-only share link for showing the timeline without a login).

---

## Step 6. Later: backups and metrics (for real operation)

While `SKIP_PREDEPLOY_BACKUP=1` is set, no backups are taken. Before real use
(not a demo), configure them following `docs/RESTORE.md`:

1. Create an S3-compatible bucket **outside Railway** (Railway has no S3 of its
   own; MinIO on Railway does not count — same environment as the database).
   Options: your cloud provider's object storage, Cloudflare R2 or Backblaze B2.
2. Generate age keys: `age-keygen -o age.key` (the public key goes to the
   Railway variable `BACKUP_ENCRYPTION_KEY`; keep the private `AGE_SECRET_KEY`
   in a separate secrets manager, **not** next to the app).
3. Set `BACKUP_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY` and remove
   `SKIP_PREDEPLOY_BACKUP`.
4. Create two cron services from the same repository (see the comments in
   `railway.toml`): `cron-backup` (`0 0 * * *`) and `cron-verify`
   (`0 4 * * 0`).

`/metrics` is already protected by `METRICS_TOKEN` — Prometheus scrapes it
with `Authorization: Bearer <token>`.

---

## Pre-demo checklist

- [ ] The deploy is green and `/healthz` responds.
- [ ] `SECRET_KEY` and `ADMIN_PASSWORD` are set (otherwise the production start
      fails — this guards against default secrets).
- [ ] Demo data is loaded and **`SEED_DEMO` is removed**.
- [ ] `https://tideline.example.com` opens over https and the owner login works.
- [ ] `APP_BASE_URL` matches the real address.
- [ ] (before going live) backups are configured and `SKIP_PREDEPLOY_BACKUP`
      is removed.
