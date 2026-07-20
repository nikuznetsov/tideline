#!/usr/bin/env python3
"""Ежедневный бэкап: pg_dump + JSON-экспорт, шифрование age, загрузка в S3, ротация.

Запускается cron-сервисом Railway (cron-backup) и вручную: python ops/backup.py.
Переменные окружения: DATABASE_URL, BACKUP_S3_*, BACKUP_ENCRYPTION_KEY (публичный
age-ключ получателя, age1...), BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY, RAILWAY_ENVIRONMENT.

Выход с ненулевым кодом — сигнал для release-фазы остановить деплой.
"""

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import boto3
from botocore.config import Config


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        print(f"ERROR: переменная {name} не задана", file=sys.stderr)
        sys.exit(2)
    return value


def s3_client():
    # region по умолчанию auto (как у R2/Railway Bucket) — иначе boto3 падает
    # без региона; path-style адресация совместима с любым S3-провайдером
    return boto3.client(
        "s3",
        endpoint_url=env("BACKUP_S3_ENDPOINT"),
        aws_access_key_id=env("BACKUP_S3_ACCESS_KEY"),
        aws_secret_access_key=env("BACKUP_S3_SECRET_KEY"),
        region_name=os.environ.get("BACKUP_S3_REGION", "auto"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


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
    """Человекочитаемый экспорт пространства: независим от версии PostgreSQL."""
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
                cur.execute(f"SELECT * FROM {table}")  # noqa: S608 — имена из белого списка
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


def upload(client, bucket: str, key: str, path: Path) -> None:
    client.upload_file(str(path), bucket, key)
    print(f"uploaded s3://{bucket}/{key} ({path.stat().st_size} bytes)")


def rotate(client, bucket: str, prefix: str) -> None:
    """7 ежедневных, 4 еженедельных (вс), 6 ежемесячных (1-е число)."""
    daily = int(os.environ.get("BACKUP_RETENTION_DAILY", "7"))
    weekly = int(os.environ.get("BACKUP_RETENTION_WEEKLY", "4"))
    monthly = int(os.environ.get("BACKUP_RETENTION_MONTHLY", "6"))

    resp = client.list_objects_v2(Bucket=bucket, Prefix=prefix)
    by_date: dict[dt.date, list[str]] = {}
    for obj in resp.get("Contents", []):
        parts = obj["Key"][len(prefix):].split("/")
        try:
            day = dt.date.fromisoformat(parts[0])
        except (ValueError, IndexError):
            continue
        by_date.setdefault(day, []).append(obj["Key"])

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
            client.delete_object(Bucket=bucket, Key=key)
            print(f"rotated out: {key}")


def main() -> None:
    database_url = env("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    recipient = env("BACKUP_ENCRYPTION_KEY")
    bucket = env("BACKUP_S3_BUCKET")
    environment = os.environ.get("RAILWAY_ENVIRONMENT", "production")
    label = os.environ.get("BACKUP_LABEL")  # напр. pre-migration-{revision}
    today = dt.date.today().isoformat()
    prefix = f"tideline/{environment}/"
    day_prefix = f"{prefix}{today}/" if not label else f"{prefix}{today}/{label}-"

    client = s3_client()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        dump = tmp_path / "dump.pgc"
        pg_dump(database_url, dump)
        dump_age = tmp_path / "dump.pgc.age"
        encrypt_age(dump, dump_age, recipient)
        upload(client, bucket, f"{day_prefix}dump.pgc.age", dump_age)

        export = tmp_path / "export.json"
        json_export(database_url, export)
        export_age = tmp_path / "export.json.age"
        encrypt_age(export, export_age, recipient)
        upload(client, bucket, f"{day_prefix}export.json.age", export_age)

    if not label:
        rotate(client, bucket, prefix)
    record_status(database_url, environment)
    print("backup ok")


def record_status(database_url: str, environment: str) -> None:
    """Отметка успеха в audit_log — по ней приложение отдаёт метрику
    backup_last_success_timestamp (алерт: бэкапа не было больше 30 часов)."""
    import psycopg

    slug = os.environ.get("WORKSPACE_SLUG", "xops")
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
    except Exception as e:  # статус не должен ронять сам бэкап
        print(f"WARN: не удалось записать статус бэкапа: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
