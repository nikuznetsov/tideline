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

# pg_dump/psql для бэкапов и restore, age для шифрования
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client age curl \
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
