#!/usr/bin/env python3
"""Daily backup: pg_dump + JSON export, age encryption, upload, rotation.

Run by a cron service/crontab or manually: python ops/backup.py.
Environment variables: DATABASE_URL, BACKUP_ENCRYPTION_KEY (the recipient's public
age key, age1...), storage — BACKUP_DIR (local directory) or BACKUP_S3_*
(see storage.py), BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY, RAILWAY_ENVIRONMENT.

A non-zero exit code tells the release phase to stop the deploy.
"""

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from storage import env, get_storage


def encrypt_age(src: Path, dst: Path, recipient: str) -> None:
    subprocess.run(
        ["age", "-r", recipient, "-o", str(dst), str(src)],
        check=True,
    )


def pg_dump(database_url: str, out: Path) -> None:
    subprocess.run(
        ["pg_dump", "--format=custom", "--no-owner", f"--file={out}", database_url],
        check=True,
    )


def json_export(database_url: str, out: Path) -> None:
    """Human-readable export of the workspace, independent of the PostgreSQL version."""
    import psycopg

    tables = [
        "workspace", "app_user", "membership", "member", "project",
        "project_update", "milestone", "allocation", "absence",
        "non_working_day", "week_snapshot", "share_link",
    ]
    data: dict[str, list[dict]] = {}
    with psycopg.connect(database_url) as conn:
        for table in tables:
            with conn.cursor() as cur:
                cur.execute(f"SELECT * FROM {table}")  # noqa: S608 — table names come from the allowlist above
                cols = [d.name for d in cur.description]
                data[table] = [
                    {c: _jsonable(v) for c, v in zip(cols, row)} for row in cur.fetchall()
                ]
    out.write_text(json.dumps(
        {"exported_at": dt.datetime.now(dt.timezone.utc).isoformat(), "tables": data},
        ensure_ascii=False, indent=1,
    ))


def _jsonable(v):
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, (dict, list, str, int, float, bool)) or v is None:
        return v
    return str(v)


def rotate(storage, prefix: str) -> None:
    """Keep 7 daily, 4 weekly (Sundays), 6 monthly (the 1st of the month)."""
    daily = int(os.environ.get("BACKUP_RETENTION_DAILY", "7"))
    weekly = int(os.environ.get("BACKUP_RETENTION_WEEKLY", "4"))
    monthly = int(os.environ.get("BACKUP_RETENTION_MONTHLY", "6"))

    by_date: dict[dt.date, list[str]] = {}
    for key in storage.list_keys(prefix):
        parts = key[len(prefix):].split("/")
        try:
            day = dt.date.fromisoformat(parts[0])
        except (ValueError, IndexError):
            continue
        by_date.setdefault(day, []).append(key)

    today = dt.date.today()
    keep: set[dt.date] = set()
    dates = sorted(by_date, reverse=True)
    keep.update(dates[:daily])
    sundays = [d for d in dates if d.weekday() == 6]
    keep.update(sundays[:weekly])
    firsts = [d for d in dates if d.day == 1]
    keep.update(firsts[:monthly])

    for day, keys in by_date.items():
        if day in keep or day == today:
            continue
        for key in keys:
            storage.delete(key)
            print(f"rotated out: {key}")


def main() -> None:
    database_url = env("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    recipient = env("BACKUP_ENCRYPTION_KEY")
    environment = os.environ.get("RAILWAY_ENVIRONMENT", "production")
    label = os.environ.get("BACKUP_LABEL")  # e.g. pre-migration-{revision}
    today = dt.date.today().isoformat()
    prefix = f"tideline/{environment}/"
    day_prefix = f"{prefix}{today}/" if not label else f"{prefix}{today}/{label}-"

    storage = get_storage()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        dump = tmp_path / "dump.pgc"
        pg_dump(database_url, dump)
        dump_age = tmp_path / "dump.pgc.age"
        encrypt_age(dump, dump_age, recipient)
        storage.upload(f"{day_prefix}dump.pgc.age", dump_age)

        export = tmp_path / "export.json"
        json_export(database_url, export)
        export_age = tmp_path / "export.json.age"
        encrypt_age(export, export_age, recipient)
        storage.upload(f"{day_prefix}export.json.age", export_age)

    if not label:
        rotate(storage, prefix)
    record_status(database_url, environment)
    print("backup ok")


def record_status(database_url: str, environment: str) -> None:
    """Record success in audit_log — the app derives the backup_last_success_timestamp
    metric from it (alert: no backup for more than 30 hours)."""
    import psycopg

    slug = os.environ.get("WORKSPACE_SLUG", "main")
    try:
        with psycopg.connect(database_url) as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM workspace WHERE slug = %s", (slug,))
            row = cur.fetchone()
            if not row:
                return
            cur.execute(
                """
                INSERT INTO audit_log (workspace_id, entity_type, action, after, created_at)
                VALUES (%s, 'backup', 'backup_ok', %s, now())
                """,
                (row[0], json.dumps({"environment": environment})),
            )
    except Exception as e:  # recording the status must never fail the backup itself
        print(f"WARN: could not record backup status: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
