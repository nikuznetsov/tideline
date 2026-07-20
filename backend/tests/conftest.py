import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.db.models import (
    AppUser,
    Base,
    Member,
    Membership,
    Project,
    Workspace,
)
from app.db.session import get_db
from app.domain.calendar import week_start_of
from app.main import api, app

TEST_EMAIL = "admin@example.com"
TEST_PASSWORD = "admin"


@pytest_asyncio.fixture
async def engine():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(engine):
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def workspace(db):
    ws = Workspace(slug="xops", name="xOps")
    db.add(ws)
    user = AppUser(
        email=TEST_EMAIL,
        name="Тимлид",
        password_hash=hash_password(TEST_PASSWORD),
        is_superuser=True,
    )
    db.add(user)
    await db.flush()
    db.add(Membership(workspace_id=ws.id, user_id=user.id, role="owner"))
    await db.commit()
    return ws


@pytest_asyncio.fixture
async def other_workspace(db):
    """Чужое пространство — для теста изоляции."""
    ws = Workspace(slug="other", name="Other")
    db.add(ws)
    await db.commit()
    return ws


@pytest_asyncio.fixture
async def transport(engine, workspace):
    from app.core.rate_limit import login_limiter, share_limiter

    login_limiter._hits.clear()
    share_limiter._hits.clear()
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

    async def override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    api.dependency_overrides[get_db] = override_get_db
    yield ASGITransport(app=app)
    app.dependency_overrides.clear()
    api.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(transport):
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def client2(transport):
    """Второй клиент с независимыми cookie — для сценариев с двумя пользователями."""
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def auth_client(client):
    resp = await client.post(
        "/api/v1/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return client


# ---------- данные для доменных тестов ----------

@pytest_asyncio.fixture
async def team(db, workspace):
    members = []
    for i, name in enumerate(["Аня", "Борис", "Вера"]):
        member = Member(workspace_id=workspace.id, name=name, sort_order=i, tags=["ml"] if i == 0 else [])
        db.add(member)
        members.append(member)
    project = Project(workspace_id=workspace.id, code="TEST", name="Тестовый проект")
    finished = Project(
        workspace_id=workspace.id, code="OLD", name="Старый", lifecycle="finished"
    )
    db.add(project)
    db.add(finished)
    await db.commit()
    return {"members": members, "project": project, "finished": finished}


@pytest.fixture
def monday():
    return week_start_of(date.today())
