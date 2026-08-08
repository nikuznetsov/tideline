"""Демо-данные: make seed. 7 сотрудников, 6 активных + 2 завершённых проекта,
аллокации на 6 недель назад и 2 вперёд, отпуска, снимки закрытых недель,
один перегруженный сотрудник и один sole owner."""

import asyncio
import random
from datetime import date, timedelta

from sqlalchemy import delete, select

from app.bootstrap import ensure_bootstrap
from app.core.security import hash_password
from app.db import models as m
from app.db.session import get_session_factory
from app.domain.calendar import is_weekend, week_start_of
from app.domain.week_close import build_week_payload, diff_payloads

MEMBERS = [
    ("Алексей Громов", "ML-инженер", ["cuda", "ml", "rag"], "alexey@demo.local"),
    ("Мария Ветрова", "Backend-инженер", ["python", "infra"], "maria@demo.local"),
    ("Иван Соколов", "MLOps", ["infra", "k8s", "cuda"], "ivan@demo.local"),
    ("Дарья Лунина", "Data Engineer", ["etl", "python"], "darya@demo.local"),
    ("Пётр Волков", "Backend-инженер", ["python", "go"], "petr@demo.local"),
    ("Анна Морозова", "ML-инженер", ["ml", "rag", "nlp"], "anna@demo.local"),
    ("Сергей Каменев", "Fullstack", ["ts", "python"], "sergey@demo.local"),
]
DEMO_PASSWORD = "demo-password-123"

PROJECTS = [
    ("RAGX", "RAG-платформа для поддержки", "active", "green"),
    ("VOICE", "Голосовой ассистент B2B", "active", "amber"),
    ("INFRA", "Миграция на новый кластер", "active", "red"),
    ("SCOUT", "Мониторинг моделей", "active", "green"),
    ("DOCS", "Извлечение данных из документов", "active", "green"),
    ("EDGE", "Инференс на edge-устройствах", "active", "amber"),
    ("LEGA", "Легаси-скоринг (закрыт)", "finished", "green"),
    ("HACK", "Внутренний хакатон (закрыт)", "finished", "green"),
]


async def seed() -> None:
    factory = get_session_factory()
    async with factory() as db:
        ws = await ensure_bootstrap(db)

        # чистим пространство (идемпотентный сид)
        for table in (
            m.AuditLog, m.WeekSnapshot, m.Allocation, m.Absence,
            m.NonWorkingDay, m.Milestone, m.ProjectUpdate,
        ):
            await db.execute(delete(table).where(table.workspace_id == ws.id))
        await db.execute(delete(m.Project).where(m.Project.workspace_id == ws.id))
        await db.execute(delete(m.Member).where(m.Member.workspace_id == ws.id))
        await db.commit()

        rng = random.Random(42)
        members = []
        for i, (name, role, tags, email) in enumerate(MEMBERS):
            # команда = участники: каждому сотруднику — аккаунт и доступ viewer
            account = (
                await db.execute(select(m.AppUser).where(m.AppUser.email == email))
            ).scalar_one_or_none()
            if not account:
                account = m.AppUser(
                    email=email, name=name, password_hash=hash_password(DEMO_PASSWORD)
                )
                db.add(account)
                await db.flush()
            membership = (
                await db.execute(
                    select(m.Membership).where(
                        m.Membership.workspace_id == ws.id,
                        m.Membership.user_id == account.id,
                    )
                )
            ).scalar_one_or_none()
            if not membership:
                db.add(m.Membership(workspace_id=ws.id, user_id=account.id, role="viewer"))
            member = m.Member(
                workspace_id=ws.id, user_id=account.id, name=name,
                role_title=role, tags=tags, sort_order=i,
            )
            db.add(member)
            members.append(member)
        await db.flush()

        projects = []
        for code, name, lifecycle, health in PROJECTS:
            p = m.Project(
                workspace_id=ws.id,
                code=code,
                name=name,
                lifecycle=lifecycle,
                health=health,
                weekly_update="Идём по плану, блокеров нет." if lifecycle == "active" else None,
                goal=f"Цель проекта {code}: довести до продуктивного использования.",
                scope_md="- Итерация 1: MVP\n- Итерация 2: пилот",
                links_md=(
                    "- [Страница проекта в Confluence](https://confluence.example.com) — детали, риски, архитектура\n"
                    "- [Репозиторий](https://example.com) — доступ у тимлида"
                ),
            )
            db.add(p)
            projects.append(p)
        await db.flush()

        active = [p for p in projects if p.lifecycle == "active"]

        user = (
            await db.execute(select(m.AppUser).limit(1))
        ).scalar_one()

        today = date.today()
        current_week = week_start_of(today)
        start = current_week - timedelta(weeks=6)
        end = current_week + timedelta(weeks=2) - timedelta(days=1)

        # отпуска: у Дарьи на этой неделе, у Петра — через неделю
        db.add(m.Absence(
            workspace_id=ws.id, member_id=members[3].id,
            date_from=current_week + timedelta(days=2),
            date_to=current_week + timedelta(days=4), kind="vacation",
        ))
        db.add(m.Absence(
            workspace_id=ws.id, member_id=members[4].id,
            date_from=current_week + timedelta(days=7),
            date_to=current_week + timedelta(days=9), kind="vacation",
        ))

        absences = {
            members[3].id: {current_week + timedelta(days=d) for d in (2, 3, 4)},
            members[4].id: {current_week + timedelta(days=d) for d in (7, 8, 9)},
        }

        # основной проект каждого + второстепенный
        assignments = []
        for i, member in enumerate(members):
            primary = active[i % len(active)]
            secondary = active[(i + 2) % len(active)]
            assignments.append((member, primary, secondary))

        d = start
        while d <= end:
            if not is_weekend(d):
                for member, primary, secondary in assignments:
                    if d in absences.get(member.id, set()):
                        continue
                    r = rng.random()
                    if r < 0.15:
                        continue  # свободный день
                    if r < 0.75:
                        db.add(m.Allocation(
                            workspace_id=ws.id, member_id=member.id,
                            project_id=primary.id, day=d, category="full",
                            created_by=user.id,
                        ))
                    else:
                        db.add(m.Allocation(
                            workspace_id=ws.id, member_id=member.id,
                            project_id=primary.id, day=d, category="half",
                            created_by=user.id,
                        ))
                        db.add(m.Allocation(
                            workspace_id=ws.id, member_id=member.id,
                            project_id=secondary.id, day=d, category="half",
                            created_by=user.id,
                        ))
                # перегруженный Иван: «наполовину» сверху на INFRA в текущем окне
                if d >= current_week:
                    db.add(m.Allocation(
                        workspace_id=ws.id, member_id=members[2].id,
                        project_id=next(p for p in active if p.code == "INFRA").id
                        if assignments[2][1].code != "INFRA"
                        else next(p for p in active if p.code == "SCOUT").id,
                        day=d, category="half", created_by=user.id,
                    ))
            d += timedelta(days=1)
        await db.commit()

        # снимки прошлых недель: план (слегка искажённый) + факт
        for w in range(6, 0, -1):
            ws_date = current_week - timedelta(weeks=w)
            fact_payload = await build_week_payload(db, ws.id, ws_date)
            plan_payload = {
                "week_start": ws_date.isoformat(),
                "allocations": [
                    a for a in fact_payload["allocations"] if rng.random() > 0.18
                ],
            }
            # план иногда обещал больше
            for a in plan_payload["allocations"]:
                if rng.random() < 0.12:
                    a = dict(a)
            db.add(m.WeekSnapshot(
                workspace_id=ws.id, week_start=ws_date, kind="plan", payload=plan_payload
            ))
            fact_payload["diff_vs_plan"] = diff_payloads(plan_payload, fact_payload)
            db.add(m.WeekSnapshot(
                workspace_id=ws.id, week_start=ws_date, kind="fact", payload=fact_payload
            ))

        # план на текущую неделю — чтобы закрытие показало diff
        cur_plan = await build_week_payload(db, ws.id, current_week)
        db.add(m.WeekSnapshot(
            workspace_id=ws.id, week_start=current_week, kind="plan", payload=cur_plan
        ))

        # апдейты проектов
        for p in active[:3]:
            db.add(m.ProjectUpdate(
                workspace_id=ws.id, project_id=p.id,
                body="Неделя прошла по плану, готовим следующую веху.",
                created_by=user.id,
            ))
        await db.commit()
    print("Демо-данные загружены.")


if __name__ == "__main__":
    asyncio.run(seed())
