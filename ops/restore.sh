#!/usr/bin/env bash
# Восстановление из зашифрованного дампа: make restore FILE=path/to/dump.pgc.age
# Требует: age (приватный ключ в AGE_SECRET_KEY или файле AGE_KEY_FILE), pg_restore.
# Целевая БД: RESTORE_DATABASE_URL (или DATABASE_URL).
set -euo pipefail

FILE="${FILE:-${1:-}}"
if [[ -z "$FILE" ]]; then
  echo "Использование: FILE=dump.pgc.age ops/restore.sh" >&2
  exit 2
fi

TARGET_URL="${RESTORE_DATABASE_URL:-${DATABASE_URL:-}}"
TARGET_URL="${TARGET_URL/postgresql+asyncpg:\/\//postgresql://}"
if [[ -z "$TARGET_URL" ]]; then
  echo "ERROR: задайте RESTORE_DATABASE_URL или DATABASE_URL" >&2
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> Расшифровка $FILE"
if [[ -n "${AGE_KEY_FILE:-}" ]]; then
  age -d -i "$AGE_KEY_FILE" -o "$TMP/dump.pgc" "$FILE"
elif [[ -n "${AGE_SECRET_KEY:-}" ]]; then
  KEYFILE="$TMP/age.key"
  printf '%s\n' "$AGE_SECRET_KEY" > "$KEYFILE"
  age -d -i "$KEYFILE" -o "$TMP/dump.pgc" "$FILE"
else
  echo "ERROR: задайте AGE_SECRET_KEY или AGE_KEY_FILE" >&2
  exit 2
fi

echo "==> Восстановление в $TARGET_URL"
pg_restore --clean --if-exists --no-owner --dbname="$TARGET_URL" "$TMP/dump.pgc"

echo "==> Сводка"
psql "$TARGET_URL" -c "
  SELECT 'members' AS entity, count(*) FROM member WHERE deleted_at IS NULL
  UNION ALL SELECT 'projects', count(*) FROM project WHERE deleted_at IS NULL
  UNION ALL SELECT 'allocations', count(*) FROM allocation
  UNION ALL SELECT 'snapshots', count(*) FROM week_snapshot;
"
echo "==> Готово. Проверьте /readyz приложения."
