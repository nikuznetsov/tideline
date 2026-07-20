from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.core.rate_limit import enforce, login_limiter
from app.core.security import SESSION_COOKIE, create_session_token, verify_password
from app.db.models import AppUser
from app.db.session import get_db
from app.schemas import LoginRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce(login_limiter, request)
    user = (
        await db.execute(select(AppUser).where(AppUser.email == body.email.lower()))
    ).scalar_one_or_none()
    if not user or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(str(user.id)),
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.app_base_url.startswith("https"),
        samesite="lax",
    )
    return user


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: AppUser = Depends(get_current_user)):
    return user
