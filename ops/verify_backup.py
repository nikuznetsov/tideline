#!/usr/bin/env python3
"""Еженедельная проверка восстановимости: скачивает последний дамп, поднимает
временную БД, восстанавливает, прогоняет проверки, удаляет БД.

Непроверенный бэкап считается отсутствующим (ТЗ §9.4).

Требует: VERIFY_DATABASE_URL — Postgres, где можно создавать временные БД
(обычно тот же инстанс Railway; создаётся tideline_verify_<дата>).
AGE_SECRET_KEY — приватный age-ключ для расшифровки.
После успеха кладёт рядом с дампом маркер dump.pgc.age.verified.
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
        print("ERROR: в хранилище нет дампов", file=sys.stderr)
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
    """Набор проверок: данные на месте и согласованы."""
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM member WHERE deleted_at IS NULL")
        members = cur.fetchone()[0]
        assert members > 0, "в дампе нет сотрудников"

        cur.execute(
            "SELECT count(*) FROM allocation WHERE day >= current_date - interval '30 days'"
        )
        recent = cur.fetchone()[0]
        print(f"members={members}, allocations_30d={recent}")

        cur.execute(
            """
            SELECT coalesce(sum(load), 0) FROM allocation
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
                f"сумма load за прошлую неделю ({last_week_load}) "
                f"не совпадает со снимком ({snap_load})"
            )
            print(f"last_week_load={last_week_load} совпадает со снимком")
        else:
            print("снимка прошлой недели нет — проверка суммы пропущена")


if __name__ == "__main__":
    main()
