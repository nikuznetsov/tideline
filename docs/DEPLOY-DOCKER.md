# Deploying Tideline on a VM with Docker Compose (Caddy + Postgres)

The same application as on Railway (see `docs/DEPLOY-RAILWAY.md`), but on a
Linux VM at any cloud provider: docker compose brings up **app** (the same root
`Dockerfile`), **Postgres 18**, **Caddy** (issues the HTTPS certificate on its
own) and a one-shot **migrate** step that mirrors Railway's pre-deploy command
(backup → alembic → seed).

Files: `ops/compose/docker-compose.yml`, `ops/compose/Caddyfile`,
`ops/compose/.env.example`, `ops/compose/deploy.sh`, `ops/compose/crontab`.

You will need: a VM (Ubuntu 22.04/24.04; 1–2 vCPU / 2 GB RAM is enough) with a
public IP, ports **22, 80, 443** open in the firewall / security group, and a
domain (the examples use `tideline.example.com`).

---

## Step 1. Prepare the VM

```bash
ssh <user>@<vm-ip>

# Docker + the compose plugin (official script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in over ssh so the group change applies

git clone https://github.com/<your-org>/tideline.git
cd tideline/ops/compose
```

If the VM has no ssh access to GitHub, clone over https (the repository does not
have to be public: `git clone` with a personal access token works, or copy the
code from your workstation with `rsync`).

## Step 2. Environment variables

```bash
cp .env.example .env
```

Fill in `.env` (the same set as the Railway Variables). Generate the secrets
locally:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 24   # METRICS_TOKEN
```

For the first start: `SKIP_PREDEPLOY_BACKUP=1` (backups are not configured
yet). `DATABASE_URL` does not need to be set — compose assembles it from
`POSTGRES_PASSWORD` (the database lives in the neighbouring `db` container).

## Step 3. First start

```bash
docker compose build          # build the image (frontend + backend), a few minutes
docker compose run --rm migrate   # migrations (backup skipped by the flag)
docker compose up -d          # app + caddy + db
docker compose ps             # everything healthy/running
curl -s http://localhost:8000/healthz || docker compose logs app
```

Check from outside before DNS is set up: `curl -s http://<vm-ip>` — Caddy
answers with a redirect to https (there is no certificate yet, that is fine).

## Step 4. Data: migrate from another instance or seed a fresh demo

**Option A — bring the data from an existing instance** (e.g. Railway). While
the old database is still alive, take a dump (locally, wherever the old
`DATABASE_URL` is reachable):

```bash
pg_dump --format=custom --no-owner "postgresql://…old-instance…" -f tideline.dump
scp tideline.dump <user>@<vm-ip>:~/tideline/ops/compose/
# on the VM:
docker compose cp tideline.dump db:/tmp/
docker compose exec db pg_restore -U tideline -d tideline --no-owner --clean --if-exists /tmp/tideline.dump
```

`pg_dump` must be at least as new as the server (Postgres 18) — you can also
run it from the app container: `docker compose run --rm app sh -c 'pg_dump … '`.

**Option B — fresh demo data.** Set `SEED_DEMO=1` in `.env`, run
`docker compose run --rm migrate`, wait for "Demo data loaded", then
**immediately set `SEED_DEMO=0` back** — otherwise every redeploy overwrites
the data.

## Step 5. DNS

Point the domain at the VM with **A records** (if you are moving from Railway,
delete the old ALIAS/CNAME and the `_railway-verify` TXT record first).

| Type | Name | Value | TTL |
|---|---|---|---|
| **A** | *(empty = apex)* | `<vm-ip>` | 3600 |
| **A** | `www` | `<vm-ip>` | 3600 |

Once DNS propagates (minutes to an hour), Caddy obtains a Let's Encrypt
certificate on the first request to `https://<domain>`. Check:
`https://tideline.example.com` opens and logging in with `ADMIN_EMAIL` /
`ADMIN_PASSWORD` works.

## Step 6. Redeploying after changes

```bash
cd ~/tideline/ops/compose && ./deploy.sh
```

The script runs `git pull` → build → migrate (with a pre-deploy backup, if
configured) → restart.

## Step 7. Backups

The scheme is the one described in `docs/RESTORE.md`: `ops/backup.py` →
pg_dump + JSON export → age encryption → storage → rotation (7 daily /
4 weekly / 6 monthly). The storage is selected by environment variables:
`BACKUP_DIR` for a local directory, `BACKUP_S3_*` for S3.

### 7.1. Locally on the VM (to start with)

Backups land in `/var/backups/tideline` on the host (mounted into the
container as `/backups`, see the compose file).

1. age keys (age is already in the image):

   ```bash
   docker compose run --rm app age-keygen
   ```

   The public key (`age1…`) → `BACKUP_ENCRYPTION_KEY` in `.env`. The private
   key (`AGE-SECRET-KEY-…`) → `AGE_SECRET_KEY` in `.env` (needed by verify and
   restore) **and a mandatory copy in a password manager off the VM** —
   without it the dumps cannot be decrypted.
2. In `.env`: `BACKUP_DIR=/backups`,
   `VERIFY_DATABASE_URL=postgresql://tideline:<password>@db:5432/tideline`,
   `SKIP_PREDEPLOY_BACKUP=0`.
3. Manual check:

   ```bash
   docker compose run --rm app python /srv/ops/backup.py          # backup ok
   docker compose run --rm app python /srv/ops/verify_backup.py   # verify ok
   ls -R /var/backups/tideline
   ```

4. Cron jobs — a regular crontab on the VM (the equivalent of the cron services
   in `railway.toml`; a ready-made file is in `ops/compose/crontab`):

   ```cron
   # crontab -e
   0 0 * * * cd /home/tideline/ops/compose && docker compose run --rm app python /srv/ops/backup.py >> /var/log/tideline-backup.log 2>&1
   0 4 * * 0 cd /home/tideline/ops/compose && docker compose run --rm app python /srv/ops/verify_backup.py >> /var/log/tideline-backup.log 2>&1
   ```

**Important:** a local backup protects against "we broke the data / a
migration", but not against losing the VM itself — it is the same disk. Ship
the directory elsewhere (rsync to another machine or, better, move to option
7.2), for example:

```cron
30 0 * * * rsync -a /var/backups/tideline/ user@other-host:tideline-backups/ >> /var/log/tideline-backup.log 2>&1
```

Restore (see `docs/RESTORE.md`):

```bash
docker compose run --rm app sh -c 'AGE_SECRET_KEY=… FILE=/backups/tideline/production/<date>/dump.pgc.age /srv/ops/restore.sh'
```

### 7.2. S3 (when you are ready)

The same, but instead of `BACKUP_DIR` fill in
`BACKUP_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY` (the bucket — e.g. your cloud
provider's object storage, Cloudflare R2 or Backblaze B2 — ideally in a
different region/account from the VM). The scripts and key layout do not
change — the old local backups can simply be uploaded to the bucket as they
are.

## Checklist

- [ ] `docker compose ps` — app healthy, db healthy, caddy running.
- [ ] A records point at the VM's IP; any old ALIAS/`_railway-verify` records
      are removed.
- [ ] `https://<domain>` opens and the owner login works.
- [ ] `APP_BASE_URL` matches the real address.
- [ ] Data: migrated from the old instance **or** `SEED_DEMO` ran once and is
      back to 0.
- [ ] Ports 80/443 are open in the firewall; 8000 and 5432 are **not** exposed
      externally.
- [ ] (before going live) backups are configured, `SKIP_PREDEPLOY_BACKUP` is
      removed, the cron jobs are in crontab.
- [ ] If you migrated from Railway, stop/delete the Railway project so you do
      not pay twice.
