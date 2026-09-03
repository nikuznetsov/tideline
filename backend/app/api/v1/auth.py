from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.core.rate_limit import enforce, login_limiter
from app.core.security import (
    SESSION_COOKIE,
    create_session_token,
    hash_password,
    verify_password,
)
from app.db.models import AppUser
from app.db.session import get_db
from app.schemas import (
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    RegisterRequest,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, user_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(user_id),
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.app_base_url.startswith("https"),
        samesite="lax",
    )


@router.post("/register", response_model=UserOut)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce(login_limiter, request)
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(422, "This doesn't look like an email address")
    dup = (
        await db.execute(select(AppUser.id).where(AppUser.email == email))
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(422, "This email is already registered — log in instead")
    user = AppUser(
        email=email,
        name=f"{body.first_name.strip()} {body.last_name.strip()}",
        password_hash=hash_password(body.password),
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    _set_session_cookie(response, str(user.id))
    return user


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce(login_limiter, request)
    user = (
        await db.execute(
            select(AppUser).where(AppUser.email == body.email.strip().lower())
        )
    ).scalar_one_or_none()
    if not user or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    _set_session_cookie(response, str(user.id))
    return user


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: AppUser = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: ProfileUpdate,
    user: AppUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(422, "This doesn't look like an email address")
    if email != user.email:
        dup = (
            await db.execute(
                select(AppUser.id).where(
                    AppUser.email == email, AppUser.id != user.id
                )
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(422, "This email is already taken")
    user.name = body.name.strip()
    user.email = email
    await db.commit()
    return user


@router.post("/me/password")
async def change_password(
    body: PasswordChange,
    user: AppUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"ok": True}
