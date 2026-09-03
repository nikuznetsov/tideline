from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./tideline.db"
    secret_key: str = "dev-secret-change-me"
    admin_email: str = "admin@example.com"
    admin_password: str = "admin"
    app_base_url: str = "http://localhost:8000"
    workspace_slug: str = "main"
    workspace_name: str = "Main"
    tz: str = "UTC"
    log_level: str = "INFO"
    sentry_dsn: str | None = None

    session_max_age_seconds: int = 60 * 60 * 24 * 14
    static_dir: str = "static"
    # when set, /metrics requires a Bearer token (otherwise metrics are public)
    metrics_token: str | None = None

    backup_dir: str | None = None
    backup_s3_endpoint: str | None = None
    backup_s3_bucket: str | None = None
    backup_s3_access_key: str | None = None
    backup_s3_secret_key: str | None = None

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        # some hosts hand out postgres:// — SQLAlchemy async requires postgresql+asyncpg://
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
