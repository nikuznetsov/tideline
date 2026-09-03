"""Backup storage: a local directory (BACKUP_DIR) or S3 (BACKUP_S3_*).

Keys always look like tideline/{environment}/{date}/dump.pgc.age — when moving
from a local directory to S3 only the environment variables change; the layout
and the scripts stay the same.
"""

import os
import shutil
import sys
from pathlib import Path


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        print(f"ERROR: environment variable {name} is not set", file=sys.stderr)
        sys.exit(2)
    return value


class LocalStorage:
    """A directory on disk (e.g. /backups — a mount of /var/backups/tideline from the host)."""

    def __init__(self, root: str) -> None:
        self.root = Path(root)

    def upload(self, key: str, path: Path) -> None:
        dst = self.root / key
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dst)
        print(f"saved {dst} ({path.stat().st_size} bytes)")

    def download(self, key: str, dst: Path) -> None:
        shutil.copy2(self.root / key, dst)

    def put_text(self, key: str, body: str) -> None:
        dst = self.root / key
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(body)

    def list_keys(self, prefix: str) -> list[str]:
        return [
            str(p.relative_to(self.root))
            for p in self.root.rglob("*")
            if p.is_file() and str(p.relative_to(self.root)).startswith(prefix)
        ]

    def delete(self, key: str) -> None:
        path = self.root / key
        path.unlink()
        # tidy up date directories that became empty
        parent = path.parent
        while parent != self.root and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent


class S3Storage:
    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        # region defaults to auto (as with R2/Railway Bucket) — otherwise boto3 fails
        # without a region; path-style addressing works with any S3 provider
        self.client = boto3.client(
            "s3",
            endpoint_url=env("BACKUP_S3_ENDPOINT"),
            aws_access_key_id=env("BACKUP_S3_ACCESS_KEY"),
            aws_secret_access_key=env("BACKUP_S3_SECRET_KEY"),
            region_name=os.environ.get("BACKUP_S3_REGION", "auto"),
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self.bucket = env("BACKUP_S3_BUCKET")

    def upload(self, key: str, path: Path) -> None:
        self.client.upload_file(str(path), self.bucket, key)
        print(f"uploaded s3://{self.bucket}/{key} ({path.stat().st_size} bytes)")

    def download(self, key: str, dst: Path) -> None:
        self.client.download_file(self.bucket, key, str(dst))

    def put_text(self, key: str, body: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body.encode())

    def list_keys(self, prefix: str) -> list[str]:
        resp = self.client.list_objects_v2(Bucket=self.bucket, Prefix=prefix)
        return [o["Key"] for o in resp.get("Contents", [])]

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def get_storage() -> LocalStorage | S3Storage:
    backup_dir = os.environ.get("BACKUP_DIR")
    if backup_dir:
        return LocalStorage(backup_dir)
    return S3Storage()
