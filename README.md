# xOps Tideline

Планирование загрузки команды скользящим окном в две недели: кто чем занят,
кто и насколько свободен, закрытие недели со снимком в историю и экран
«план vs факт». Замена таблицы, в которой ввод быстрее, чем в Google Sheets,
а вопрос «хватит ли людей с 3 по 14 августа» решается одной формой.

- **Стек:** FastAPI + SQLAlchemy 2 (async) + PostgreSQL · React 18 + TypeScript + Vite + Tailwind
- **Деплой:** Railway, один сервис `web` + managed Postgres + два cron-сервиса бэкапов
- Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), решения: [docs/DECISIONS.md](docs/DECISIONS.md)

## Быстрый старт локально

```bash
make setup                 # uv venv + pip install, npm install
cp .env.example backend/.env   # локально можно оставить sqlite
make migrate               # alembic upgrade head
make seed                  # демо-данные: 7 человек, 8 проектов, 8 недель
make backend               # API на :8000
make frontend              # Vite на :5173 (проксирует /api)
```

Логин — `ADMIN_EMAIL` / `ADMIN_PASSWORD` из env (по умолчанию
`admin@example.com` / `admin`). Незалогиненных встречает лендинг: можно создать
аккаунт (имя, фамилия, email, пароль) — без доступов, но со своим пространством.
Доменное API живёт под `/api/v1/w/{slug}/…`; роли: owner / editor / viewer,
вступление по инвайт-ссылке `/join/{token}` с ролью по умолчанию.

Прод-режим одним процессом: `make build && make backend` — FastAPI отдаст
собранную статику сам.

## Горячие клавиши таймлайна

| Клавиша | Действие |
|---|---|
| `1` `5` `2` `7` | 1.0 · 0.5 · 0.25 · 0.75 |
| `0` / `Delete` | очистить |
| стрелки / `Tab` / `Enter` | навигация, как в таблице |
| `Shift` + стрелки / мышь | прямоугольное выделение |
| красный маркер ячейки | drag-fill по горизонтали |
| `Cmd/Ctrl+Z` / `+Shift+Z` | undo / redo (50 шагов) |
| `?` | справка |

## Деплой на Railway

1. Создайте проект, подключите репозиторий (билд по `Dockerfile`, конфигурация
   в `railway.toml`), добавьте Postgres.
2. Заполните переменные из [.env.example](.env.example). Бакет для бэкапов —
   **вне Railway** (Cloudflare R2 / Backblaze B2). `BACKUP_ENCRYPTION_KEY` —
   публичный age-ключ; приватный храните в менеджере секретов.
3. Первый деплой: поставьте `SKIP_PREDEPLOY_BACKUP=1` (БД ещё пуста), после
   успешного старта уберите. Дальше каждый деплой: pre-deploy бэкап →
   `alembic upgrade head` → рестарт; неудачный бэкап останавливает деплой.
4. Создайте сервисы `cron-backup` (`0 0 * * *`, `python /srv/ops/backup.py`) и
   `cron-verify` (`0 4 * * 0`, `python /srv/ops/verify_backup.py`) из того же
   репозитория.

## Что делать, если всё упало

Спокойно, по шагам. Данные есть в бакете, самому старому дампу меньше суток.

1. **Приложение не отвечает, БД жива.** Откройте Railway → сервис `web` →
   Redeploy. Проверьте `/readyz`. Данные не тронуты.
2. **БД повреждена или удалена.** Следуйте
   [docs/RESTORE.md](docs/RESTORE.md): скачать вчерашний `dump.pgc.age`,
   `make restore FILE=...` в новую БД, переключить `DATABASE_URL`, редеплой.
   Это RTO ≤ 1 час; потеряете максимум сутки правок.
3. **Деплой упал на pre-deploy бэкапе.** Это защита: миграции не применялись,
   прод работает на старой версии. Почините доступ к бакету (ключи, сеть) и
   повторите деплой. Не обходите проверку, если не понимаете, почему она упала.
4. **Прод работает, но данные испорчены руками.** Аудит (`/api/v1/audit`)
   покажет, кто и что менял. Точечное восстановление — из `export.json.age`
   вчерашнего дня, там все таблицы в читаемом JSON.

## Тесты

```bash
make test    # pytest: ёмкость, поиск ресурса, закрытие недели, изоляция workspace, API
```

## Структура

```
backend/   FastAPI: api/v1, core, db, domain (бизнес-логика), services, tests
frontend/  React: components/timeline (своя сетка), features/capacity-search, pages
ops/       backup.py, verify_backup.py, restore.sh
docs/      ARCHITECTURE.md, DECISIONS.md, RESTORE.md
```
