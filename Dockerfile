# ---- стадия 1: сборка фронтенда ----
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- стадия 2: python-приложение ----
FROM python:3.12-slim AS app
WORKDIR /srv

# pg_dump/psql для бэкапов и restore (клиент 18 — под Railway Postgres 18;
# pg_dump обязан быть не старше сервера), age для шифрования
RUN apt-get update \
    && apt-get install -y --no-install-recommends age curl ca-certificates gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY backend/pyproject.toml backend/
RUN cd backend && uv pip install --system . psycopg[binary]

COPY backend/ backend/
COPY ops/ ops/
COPY --from=frontend /build/dist backend/static

WORKDIR /srv/backend
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# release-фаза Railway: бэкап, затем миграции (см. railway.toml)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
