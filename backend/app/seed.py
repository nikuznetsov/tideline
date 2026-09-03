"""Demo data: make seed. 7 team members, 6 active + 2 finished projects,
allocations for 6 weeks back and 2 ahead, vacations, closed-week snapshots,
one overloaded member and one sole expert."""

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
    ("Alex Grant", "ML engineer", ["cuda", "ml", "rag"], "alex@demo.local"),
    ("Maria Winters", "Backend engineer", ["python", "infra"], "maria@demo.local"),
    ("Ian Falconer", "MLOps", ["infra", "k8s", "cuda"], "ian@demo.local"),
    ("Daria Moon", "Data Engineer", ["etl", "python"], "daria@demo.local"),
    ("Peter Wolfe", "Backend engineer", ["python", "go"], "peter@demo.local"),
    ("Anna Frost", "ML engineer", ["ml", "rag", "nlp"], "anna@demo.local"),
    ("Sam Stone", "Fullstack", ["ts", "python"], "sam@demo.local"),
]
DEMO_PASSWORD = "demo-password-123"

PROJECTS = [
    ("RAGX", "RAG platform for customer support", "active", "green"),
    ("VOICE", "B2B voice assistant", "active", "amber"),
    ("INFRA", "Migration to the new cluster", "active", "red"),
    ("SCOUT", "Model monitoring", "active", "green"),
    ("DOCS", "Document data extraction", "active", "green"),
    ("EDGE", "Inference on edge devices", "active", "amber"),
    ("LEGA", "Legacy scoring (closed)", "finished", "green"),
    ("HACK", "Internal hackathon (closed)", "finished", "green"),
]


async def seed() -> None:
    factory = get_session_factory()
    async with factory() as db:
        ws = await ensure_bootstrap(db)

        # wipe the workspace (idempotent seed)
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
            # team = participants: every member gets an account and viewer access
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
                weekly_update="On track, no blockers." if lifecycle == "active" else None,
                goal=f"Goal of {code}: bring it to production use.",
                scope_md="- Iteration 1: MVP\n- Iteration 2: pilot",
                links_md=(
                    "- [Project page in the wiki](https://wiki.example.com) — details, risks, architecture\n"
                    "- [Repository](https://example.com) — ask the team lead for access"
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

        # vacations: Daria this week, Peter next week
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

        # everyone's primary project + a secondary one
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
                        continue  # free day
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
                # overloaded Ian: an extra "half day" on INFRA in the current window
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

        # past-week snapshots: plan (slightly distorted) + fact
        for w in range(6, 0, -1):
            ws_date = current_week - timedelta(weeks=w)
            fact_payload = await build_week_payload(db, ws.id, ws_date)
            plan_payload = {
                "week_start": ws_date.isoformat(),
                "allocations": [
                    a for a in fact_payload["allocations"] if rng.random() > 0.18
                ],
            }
            # the plan sometimes promised more
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

        # plan for the current week — so that closing shows a diff
        cur_plan = await build_week_payload(db, ws.id, current_week)
        db.add(m.WeekSnapshot(
            workspace_id=ws.id, week_start=current_week, kind="plan", payload=cur_plan
        ))

        # project updates
        for p in active[:3]:
            db.add(m.ProjectUpdate(
                workspace_id=ws.id, project_id=p.id,
                body="The week went to plan; preparing the next milestone.",
                created_by=user.id,
            ))
        await db.commit()
    print("Demo data loaded.")


if __name__ == "__main__":
    asyncio.run(seed())
