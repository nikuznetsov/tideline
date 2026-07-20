.PHONY: dev backend frontend seed test build restore backup migrate

# --- локальная разработка ---

backend:            ## запустить API (http://localhost:8000)
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

frontend:           ## запустить Vite dev-сервер (http://localhost:5173, проксирует /api)
	cd frontend && npm run dev

dev:                ## подсказка
	@echo "В двух терминалах: make backend и make frontend"

migrate:            ## применить миграции
	cd backend && .venv/bin/python -m alembic upgrade head

seed:               ## демо-данные: 7 сотрудников, 8 проектов, 8 недель аллокаций
	cd backend && .venv/bin/python -m app.seed

test:               ## тесты бэкенда с покрытием бизнес-логики
	cd backend && .venv/bin/python -m pytest --cov=app/domain --cov-report=term

build:              ## прод-сборка фронтенда в backend/static
	cd frontend && npm run build
	rm -rf backend/static && cp -r frontend/dist backend/static

# --- эксплуатация ---

backup:             ## бэкап вручную (нужны DATABASE_URL и BACKUP_*)
	python ops/backup.py

restore:            ## make restore FILE=dump.pgc.age — расшифровать и восстановить
	FILE=$(FILE) bash ops/restore.sh

setup:              ## первичная установка зависимостей
	cd backend && uv venv .venv && uv pip install -p .venv/bin/python -e ".[dev]"
	cd frontend && npm install
