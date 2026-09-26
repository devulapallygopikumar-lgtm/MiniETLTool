from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/mini_etl"
    allowed_origin: str = "http://localhost:3000"
    upload_dir: Path = Path("./data/uploads")
    schema_sample_rows: int = 10_000
    issue_sample_cap: int = 100

    # Single seeded tenant for the two-day slice (ARCHITECTURE.md §20.6 #1):
    # tenant_id is on every table but multi-tenancy itself is out of scope.
    default_tenant_id: str = "default"

    # Auth (ARCHITECTURE.md §11.1). jwt_secret has no safe default -- set it
    # via env in any environment that isn't a throwaway local dev DB.
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    access_token_minutes: int = 15
    refresh_token_days: int = 7


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
