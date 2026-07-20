import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.core.config import get_settings

_ph = PasswordHasher()

SESSION_COOKIE = "tideline_session"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="tideline-session")


def create_session_token(user_id: str) -> str:
    return _serializer().dumps({"uid": user_id})


def read_session_token(token: str) -> str | None:
    try:
        data = _serializer().loads(
            token, max_age=get_settings().session_max_age_seconds
        )
        return data.get("uid")
    except BadSignature:
        return None


def generate_share_token() -> str:
    """Токен ссылки: 32 байта энтропии, urlsafe."""
    return secrets.token_urlsafe(32)


def hash_share_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
