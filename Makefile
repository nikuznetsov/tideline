.PHONY: dev backend frontend seed test build restore backup migrate

# --- local development ---

backend:            ## run the API (http://localhost:8000)
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

frontend:           ## run the Vite dev server (http://localhost:5173, proxies /api)
	cd frontend && npm run dev

dev:                ## hint
	@echo "In two terminals: make backend and make frontend"

migrate:            ## apply migrations
	cd backend && .venv/bin/python -m alembic upgrade head

seed:               ## demo data: 7 team members, 8 projects, 8 weeks of allocations
	cd backend && .venv/bin/python -m app.seed

test:               ## backend tests with business-logic coverage
	cd backend && .venv/bin/python -m pytest --cov=app/domain --cov-report=term

build:              ## production frontend build into backend/static
	cd frontend && npm run build
	rm -rf backend/static && cp -r frontend/dist backend/static

# --- operations ---

backup:             ## manual backup (needs DATABASE_URL and BACKUP_*)
	python ops/backup.py

restore:            ## make restore FILE=dump.pgc.age — decrypt and restore
	FILE=$(FILE) bash ops/restore.sh

setup:              ## initial dependency install
	cd backend && uv venv .venv && uv pip install -p .venv/bin/python -e ".[dev]"
	cd frontend && npm install
