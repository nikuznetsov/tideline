#!/usr/bin/env bash
# Restore from an encrypted dump: make restore FILE=path/to/dump.pgc.age
# Requires: age (private key in AGE_SECRET_KEY or in the file AGE_KEY_FILE), pg_restore.
# Target database: RESTORE_DATABASE_URL (or DATABASE_URL).
set -euo pipefail

FILE="${FILE:-${1:-}}"
if [[ -z "$FILE" ]]; then
  echo "Usage: FILE=dump.pgc.age ops/restore.sh" >&2
  exit 2
fi

TARGET_URL="${RESTORE_DATABASE_URL:-${DATABASE_URL:-}}"
TARGET_URL="${TARGET_URL/postgresql+asyncpg:\/\//postgresql://}"
if [[ -z "$TARGET_URL" ]]; then
  echo "ERROR: set RESTORE_DATABASE_URL or DATABASE_URL" >&2
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> Decrypting $FILE"
if [[ -n "${AGE_KEY_FILE:-}" ]]; then
  age -d -i "$AGE_KEY_FILE" -o "$TMP/dump.pgc" "$FILE"
elif [[ -n "${AGE_SECRET_KEY:-}" ]]; then
  KEYFILE="$TMP/age.key"
  printf '%s\n' "$AGE_SECRET_KEY" > "$KEYFILE"
  age -d -i "$KEYFILE" -o "$TMP/dump.pgc" "$FILE"
else
  echo "ERROR: set AGE_SECRET_KEY or AGE_KEY_FILE" >&2
  exit 2
fi

echo "==> Restoring into $TARGET_URL"
pg_restore --clean --if-exists --no-owner --dbname="$TARGET_URL" "$TMP/dump.pgc"

echo "==> Summary"
psql "$TARGET_URL" -c "
  SELECT 'members' AS entity, count(*) FROM member WHERE deleted_at IS NULL
  UNION ALL SELECT 'projects', count(*) FROM project WHERE deleted_at IS NULL
  UNION ALL SELECT 'allocations', count(*) FROM allocation
  UNION ALL SELECT 'snapshots', count(*) FROM week_snapshot;
"
echo "==> Done. Check the application's /readyz."
