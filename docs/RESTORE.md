# Restoring from a backup

Targets: **RPO ≤ 24 hours** (daily dump at 00:00 UTC, 03:00 in the default
workspace timezone), **RTO ≤ 1 hour** (the steps below take 10–20 minutes).

## What is in the bucket

```
tideline/{production|staging}/{YYYY-MM-DD}/dump.pgc.age     — pg_dump -Fc, age-encrypted
tideline/{...}/{YYYY-MM-DD}/export.json.age                 — JSON export, independent of the PG version
tideline/{...}/{YYYY-MM-DD}/dump.pgc.age.verified           — marker: the dump passed the restore check
tideline/{...}/{YYYY-MM-DD}/pre-migration-{rev}-dump.pgc.age — dump taken before a migration
```

Treat any dump without a `.verified` marker as unverified.

## Quick restore (make restore)

1. Download the dump you need from the bucket (the R2/B2 console or
   `aws s3 cp` with `--endpoint-url`):

   ```bash
   aws s3 cp s3://tideline-backups/tideline/production/2026-07-19/dump.pgc.age . \
     --endpoint-url $BACKUP_S3_ENDPOINT
   ```

2. Take the private age key from your secrets manager (it is **not** stored
   alongside the application) and run:

   ```bash
   export AGE_SECRET_KEY='AGE-SECRET-KEY-...'
   export RESTORE_DATABASE_URL='postgresql://user:pass@host:5432/tideline'
   make restore FILE=dump.pgc.age
   ```

   The script decrypts the dump, runs `pg_restore --clean --if-exists` and
   prints a summary: the number of team members, projects, allocations and
   snapshots.

3. Check the application: `curl https://<host>/readyz` → `{"status":"ok"}`,
   then open the timeline and eyeball last week.

## Restoring into a fresh database (total loss)

1. Create a new PostgreSQL instance (in Railway, or a new `db` container) and
   get its `DATABASE_URL`.
2. Follow the "Quick restore" steps with `RESTORE_DATABASE_URL` pointing at the
   new database.
3. Update `DATABASE_URL` on the `web`/`app` service and redeploy.
4. Run `alembic upgrade head` (the release phase does this on its own) — if the
   dump is older than the current code, the migrations are applied on top.

## If pg_restore is unavailable (incompatible PG version)

Use `export.json.age`, decrypted the same way:

```bash
age -d -i age.key -o export.json export.json.age
```

The file contains every table of the workspace as JSON. It is insurance against
a stack change or a major PostgreSQL incompatibility; loading it is done with an
ad-hoc script following the file structure
(`{"tables": {"member": [...], ...}}`).

## Restore check (automated)

The `cron-verify` service runs weekly (Sunday, 04:00 UTC): it downloads the
latest dump, restores it into a temporary database `tideline_verify_YYYYMMDD`,
checks the team member count, the past month's allocations and last week's
`load` sum against the snapshot, drops the temporary database and writes the
`.verified` marker. The status is visible in `/admin/backups` and in the
service logs.
