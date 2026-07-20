"""Список и запуск бэкапов. Сами бэкапы делает ops/backup.py (cron-сервис);
здесь — чтение состояния из S3 для /admin/backups и запуск по требованию."""

import asyncio
import subprocess
import sys
from pathlib import Path

from app.core.config import get_settings


def _s3_client():
    settings = get_settings()
    if not (settings.backup_s3_endpoint and settings.backup_s3_bucket):
        raise RuntimeError("Хранилище бэкапов не сконфигурировано (BACKUP_S3_*)")
    import boto3

    return (
        boto3.client(
            "s3",
            endpoint_url=settings.backup_s3_endpoint,
            aws_access_key_id=settings.backup_s3_access_key,
            aws_secret_access_key=settings.backup_s3_secret_key,
        ),
        settings.backup_s3_bucket,
    )


async def list_backups() -> list[dict]:
    def _list():
        client, bucket = _s3_client()
        resp = client.list_objects_v2(Bucket=bucket, Prefix="tideline/")
        items = []
        for obj in resp.get("Contents", []):
            items.append(
                {
                    "key": obj["Key"],
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"].isoformat(),
                    "verified": obj["Key"].endswith(".verified"),
                }
            )
        # статус верификации: рядом с dump.pgc.age лежит маркер .verified
        verified_keys = {i["key"] for i in items if i["verified"]}
        for i in items:
            i["verified"] = f"{i['key']}.verified" in verified_keys
        return [i for i in items if not i["key"].endswith(".verified")]

    return await asyncio.to_thread(_list)


async def run_backup_now() -> dict:
    """Запускает ops/backup.py как подпроцесс."""
    script = Path(__file__).resolve().parents[3].parent / "ops" / "backup.py"
    if not script.exists():
        raise RuntimeError("ops/backup.py не найден")

    def _run():
        proc = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True, timeout=600
        )
        return {
            "ok": proc.returncode == 0,
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-4000:],
        }

    return await asyncio.to_thread(_run)
