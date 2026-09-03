#!/usr/bin/env python3
"""Weekly restore check: downloads the latest dump, creates a temporary database,
restores into it, runs the checks, drops the database.

An unverified backup counts as no backup (spec §9.4).

Requires: VERIFY_DATABASE_URL — a Postgres where temporary databases may be created
(usually the same instance; tideline_verify_<date> is created).
AGE_SECRET_KEY — the private age key for decryption.
On success writes the marker dump.pgc.age.verified next to the dump.
"""

import datetime as dt
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from storage import env, get_storage


def main() -> None:
    environment = os.environ.get("RAILWAY_ENVIRONMENT", "production")
    prefix = f"tideline/{environment}/"
    storage = get_storage()

    dumps = sorted(
        (k for k in storage.list_keys(prefix) if k.endswith("dump.pgc.age")),
        reverse=True,
    )
    if not dumps:
        print("ERROR: no dumps found in storage", file=sys.stderr)
        sys.exit(1)
    latest = dumps[0]
    print(f"verifying {latest}")

    admin_url = env("VERIFY_DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    verify_db = f"tideline_verify_{dt.date.today().strftime('%Y%m%d')}"

    with tempfile.TemporaryDirectory() as tmp:
        enc = Path(tmp) / "dump.pgc.age"
        dump = Path(tmp) / "dump.pgc"
        storage.download(latest, enc)

        key_file = Path(tmp) / "age.key"
        key_file.write_text(env("AGE_SECRET_KEY") + "\n")
        subprocess.run(
            ["age", "-d", "-i", str(key_file), "-o", str(dump), str(enc)], check=True
        )

        run_psql(admin_url, f'DROP DATABASE IF EXISTS "{verify_db}"')
        run_psql(admin_url, f'CREATE DATABASE "{verify_db}"')
        verify_url = rebase_db(admin_url, verify_db)
        try:
            subprocess.run(
                ["pg_restore", "--no-owner", f"--dbname={verify_url}", str(dump)],
                check=True,
            )
            checks(verify_url)
        finally:
            run_psql(admin_url, f'DROP DATABASE IF EXISTS "{verify_db}" WITH (FORCE)')

    storage.put_text(latest + ".verified", "ok")
    print("verify ok")


def rebase_db(url: str, dbname: str) -> str:
    base, _, _ = url.rpartition("/")
    return f"{base}/{dbname}"


def run_psql(url: str, sql: str) -> None:
    subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def checks(url: str) -> None:
    """Checks: the data is present and consistent."""
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM member WHERE deleted_at IS NULL")
        members = cur.fetchone()[0]
        assert members > 0, "the dump contains no team members"

        cur.execute(
            "SELECT count(*) FROM allocation WHERE day >= current_date - interval '30 days'"
        )
        recent = cur.fetchone()[0]
        print(f"members={members}, allocations_30d={recent}")

        cur.execute(
            """
            SELECT coalesce(sum(CASE category
                WHEN 'background' THEN 0.25
                WHEN 'half'       THEN 0.5
                WHEN 'most'       THEN 0.75
                ELSE 1.0 END), 0) FROM allocation
            WHERE day >= date_trunc('week', current_date) - interval '7 days'
              AND day < date_trunc('week', current_date)
            """
        )
        last_week_load = cur.fetchone()[0]
        cur.execute(
            """
            SELECT payload FROM week_snapshot
            WHERE kind = 'fact'
              AND week_start = (date_trunc('week', current_date) - interval '7 days')::date
            """
        )
        row = cur.fetchone()
        if row:
            snap_load = sum(float(a["load"]) for a in row[0]["allocations"])
            assert abs(float(last_week_load) - snap_load) < 0.01, (
                f"last week's load sum ({last_week_load}) "
                f"does not match the snapshot ({snap_load})"
            )
            print(f"last_week_load={last_week_load} matches the snapshot")
        else:
            print("no snapshot for last week — sum check skipped")


if __name__ == "__main__":
    main()
