# Восстановление из бэкапа

Целевые показатели: **RPO ≤ 24 часа** (ежедневный дамп в 03:00 МСК),
**RTO ≤ 1 час** (шаги ниже занимают 10–20 минут).

## Что лежит в бакете

```
tideline/{production|staging}/{YYYY-MM-DD}/dump.pgc.age     — pg_dump -Fc, зашифрован age
tideline/{...}/{YYYY-MM-DD}/export.json.age                 — JSON-экспорт, независимый от версии PG
tideline/{...}/{YYYY-MM-DD}/dump.pgc.age.verified           — маркер: дамп прошёл проверку восстановимости
tideline/{...}/{YYYY-MM-DD}/pre-migration-{rev}-dump.pgc.age — дамп перед миграцией
```

Дамп без маркера `.verified` считайте непроверенным.

## Быстрое восстановление (make restore)

1. Скачайте нужный дамп из бакета (консоль R2/B2 или `aws s3 cp` с `--endpoint-url`):

   ```bash
   aws s3 cp s3://tideline-backups/tideline/production/2026-07-19/dump.pgc.age . \
     --endpoint-url $BACKUP_S3_ENDPOINT
   ```

2. Возьмите приватный age-ключ из менеджера секретов (он **не** хранится в Railway
   вместе с приложением) и выполните:

   ```bash
   export AGE_SECRET_KEY='AGE-SECRET-KEY-...'
   export RESTORE_DATABASE_URL='postgresql://user:pass@host:5432/tideline'
   make restore FILE=dump.pgc.age
   ```

   Скрипт расшифрует дамп, выполнит `pg_restore --clean --if-exists` и выведет
   сводку: число сотрудников, проектов, аллокаций, снимков.

3. Проверьте приложение: `curl https://<host>/readyz` → `{"status":"ok"}`,
   затем откройте таймлайн и сверьте прошлую неделю глазами.

## Восстановление в чистую БД (полная потеря)

1. Создайте новую Postgres в Railway, получите `DATABASE_URL`.
2. Выполните шаги из «Быстрого восстановления» с `RESTORE_DATABASE_URL` новой БД.
3. Обновите `DATABASE_URL` у сервиса `web` и редеплойте.
4. Прогоните `alembic upgrade head` (release-фаза сделает это сама) — если дамп
   старее текущего кода, миграции докатятся поверх.

## Если недоступен pg_restore (несовместимая версия PG)

Используйте `export.json.age` — расшифруйте тем же способом:

```bash
age -d -i age.key -o export.json export.json.age
```

Файл содержит все таблицы пространства в JSON. Это страховка на случай смены
стека или мажорной несовместимости PostgreSQL; загрузка выполняется ад-хок
скриптом по структуре файла (`{"tables": {"member": [...], ...}}`).

## Проверка восстановимости (автоматическая)

Сервис `cron-verify` еженедельно (вс, 07:00 МСК): скачивает последний дамп,
разворачивает во временную БД `tideline_verify_YYYYMMDD`, проверяет число
сотрудников, аллокации за месяц и сумму `load` прошлой недели против снимка,
удаляет временную БД и ставит маркер `.verified`. Статус виден в `/admin/backups`
и в логах сервиса.
