"""Listing and triggering backups. The backups themselves are made by ops/backup.py (cron);
here we read the storage state (BACKUP_DIR or S3) for /admin/backups
and run one on demand."""

import asyncio
import datetime as dt
import subprocess
import sys
from pathlib import Path

from app.core.config import get_settings


def _s3_client():
    settings = get_settings()
    if not (settings.backup_s3_endpoint and settings.backup_s3_bucket):
        raise RuntimeError("Backup storage is not configured (BACKUP_S3_*)")
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


def _s3_items() -> list[dict]:
    client, bucket = _s3_client()
    resp = client.list_objects_v2(Bucket=bucket, Prefix="tideline/")
    return [
        {
            "key": obj["Key"],
            "size": obj["Size"],
            "last_modified": obj["LastModified"].isoformat(),
        }
        for obj in resp.get("Contents", [])
    ]


def _local_items(root: Path) -> list[dict]:
    return [
        {
            "key": str(p.relative_to(root)),
            "size": p.stat().st_size,
            "last_modified": dt.datetime.fromtimestamp(
                p.stat().st_mtime, tz=dt.timezone.utc
            ).isoformat(),
        }
        for p in sorted(root.rglob("*"))
        if p.is_file()
    ]


async def list_backups() -> list[dict]:
    settings = get_settings()

    def _list():
        if settings.backup_dir:
            items = _local_items(Path(settings.backup_dir))
        else:
            items = _s3_items()
        # verification status: a .verified marker sits next to dump.pgc.age
        verified_keys = {i["key"] for i in items if i["key"].endswith(".verified")}
        for i in items:
            i["verified"] = f"{i['key']}.verified" in verified_keys
        return [i for i in items if not i["key"].endswith(".verified")]

    return await asyncio.to_thread(_list)


async def run_backup_now() -> dict:
    """Runs ops/backup.py as a subprocess."""
    script = Path(__file__).resolve().parents[3].parent / "ops" / "backup.py"
    if not script.exists():
        raise RuntimeError("ops/backup.py not found")

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
