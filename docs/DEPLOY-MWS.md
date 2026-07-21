# Запуск xOps Tideline на VM в MWS Cloud

То же приложение, что на Railway (см. `docs/DEPLOY-RAILWAY.md`), но на своей
виртуалке: docker compose поднимает **app** (тот же корневой `Dockerfile`),
**Postgres 18**, **Caddy** (сам выпускает HTTPS-сертификат) и одноразовый шаг
**migrate**, повторяющий pre-deploy Railway (бэкап → alembic → seed).

Файлы: `ops/mws/docker-compose.yml`, `ops/mws/Caddyfile`,
`ops/mws/.env.example`, `ops/mws/deploy.sh`.

Понадобится: VM (Ubuntu 22.04/24.04, 1–2 vCPU / 2 ГБ ОЗУ достаточно) с
публичным IP, открытые в security-группе порты **22, 80, 443**, домен в
Selectel.

---

## Шаг 1. Подготовка VM

```bash
ssh <user>@<IP-виртуалки>

# Docker + compose-плагин (официальный скрипт)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# перезайти по ssh, чтобы группа применилась

git clone https://github.com/nikuznetsov/tideline.git
cd tideline/ops/mws
```

Если VM без доступа к GitHub по ssh — клонируйте по https (репозиторий
публичный не нужен: можно `git clone` с personal access token или залить код
через `rsync` с рабочей машины).

## Шаг 2. Переменные окружения

```bash
cp .env.example .env
```

Заполните `.env` (набор тот же, что в Variables на Railway). Секреты
сгенерируйте локально:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 24   # METRICS_TOKEN
```

Для первого запуска: `SKIP_PREDEPLOY_BACKUP=1` (бэкапы ещё не настроены).
`DATABASE_URL` задавать не нужно — compose собирает его сам из
`POSTGRES_PASSWORD` (база в соседнем контейнере `db`).

## Шаг 3. Первый запуск

```bash
docker compose build          # сборка образа (фронт + бэкенд), несколько минут
docker compose run --rm migrate   # миграции (бэкап пропущен флагом)
docker compose up -d          # app + caddy + db
docker compose ps             # все healthy/running
curl -s http://localhost:8000/healthz || docker compose logs app
```

Проверка снаружи до DNS: `curl -s http://<IP-виртуалки>` — Caddy ответит
редиректом на https (сертификата ещё нет, это нормально).

## Шаг 4. Данные: перенос с Railway или свежее демо

**Вариант А — перенести данные с Railway.** Пока старая база жива, снимите
дамп (локально, где доступен Railway CLI / публичный `DATABASE_URL`
Postgres-сервиса):

```bash
pg_dump --format=custom --no-owner "postgresql://…railway…" -f tideline.dump
scp tideline.dump <user>@<IP>:~/tideline/ops/mws/
# на VM:
docker compose cp tideline.dump db:/tmp/
docker compose exec db pg_restore -U tideline -d tideline --no-owner --clean --if-exists /tmp/tideline.dump
```

`pg_dump` нужен версии ≥ серверной (Railway Postgres 18) — можно снять его и
из контейнера app: `docker compose run --rm app sh -c 'pg_dump … '`.

**Вариант Б — свежие демо-данные.** В `.env` поставьте `SEED_DEMO=1`,
выполните `docker compose run --rm migrate`, дождитесь «Демо-данные
загружены», затем **сразу верните `SEED_DEMO=0`** — иначе каждый передеплой
перезатирает данные.

## Шаг 5. DNS в Selectel

На Railway апекс смотрел через **ALIAS** на `<railway-target>`. Для VM проще:
удалите ALIAS и создайте **A-запись** на публичный IP виртуалки.

| Тип | Имя | Значение | TTL |
|---|---|---|---|
| **A** | *(пусто = корень)* | `<IP виртуалки>` | 3600 |
| **A** | `www` | `<IP виртуалки>` | 3600 |

Записи `_railway-verify` (TXT) больше не нужны — можно удалить. Зона уже
делегирована на NS Selectel — трогать не надо.

Когда DNS раскатается (минуты — час), Caddy при первом заходе на
`https://<домен>` сам получит сертификат Let's Encrypt. Проверка:
`https://xops-tideline.online` открывается, вход под `ADMIN_EMAIL` /
`ADMIN_PASSWORD` работает.

## Шаг 6. Передеплой после изменений

```bash
cd ~/tideline/ops/mws && ./deploy.sh
```

Скрипт делает `git pull` → сборку → migrate (с pre-deploy бэкапом, если
настроен) → перезапуск.

## Шаг 7. Бэкапы (перед реальной эксплуатацией)

Схема та же, что описана в `docs/RESTORE.md`: `ops/backup.py` →
pg_dump → age-шифрование → S3. На MWS Cloud есть свой S3-совместимый Object
Storage — бакет логично завести там (но лучше в другом регионе/аккаунте, чем
VM, чтобы бэкап не жил рядом с базой).

1. Создайте бакет, получите endpoint/ключи, заполните `BACKUP_S3_*` в `.env`.
2. `age-keygen -o age.key`: публичный ключ → `BACKUP_ENCRYPTION_KEY` в `.env`,
   приватный — в отдельный менеджер секретов, **не на эту VM**.
3. Уберите `SKIP_PREDEPLOY_BACKUP` (или `=0`), проверьте:
   `docker compose run --rm app python /srv/ops/backup.py` → «backup ok».
4. Кроны — обычным crontab на VM (аналог cron-сервисов из `railway.toml`):

```cron
# crontab -e
0 0 * * * cd ~/tideline/ops/mws && docker compose run --rm app python /srv/ops/backup.py >> ~/backup.log 2>&1
0 4 * * 0 cd ~/tideline/ops/mws && docker compose run --rm app python /srv/ops/verify_backup.py >> ~/backup.log 2>&1
```

## Чек-лист

- [ ] `docker compose ps` — app healthy, db healthy, caddy running.
- [ ] A-записи в Selectel указывают на IP VM, ALIAS/`_railway-verify` удалены.
- [ ] `https://<домен>` открывается, вход под owner работает.
- [ ] `APP_BASE_URL` совпадает с реальным адресом.
- [ ] Данные: перенесены с Railway **или** `SEED_DEMO` разово отработал и возвращён в 0.
- [ ] Порты 80/443 открыты в security-группе, 8000 и 5432 наружу **не** торчат.
- [ ] (перед боем) бэкапы настроены, `SKIP_PREDEPLOY_BACKUP` убран, кроны в crontab.
- [ ] Railway-проект после переезда остановить/удалить, чтобы не платить дважды.
