from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "KNIP API"
    environment: str = "development"
    cors_origins: str = "http://localhost:8080,http://127.0.0.1:8080"
    census_api_key: str | None = None
    http_timeout_seconds: float = 20.0
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_secret_key: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_issuer: str | None = None
    supabase_jwt_jwks_url: str | None = None
    supabase_jwt_secret: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="KNIP_",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
