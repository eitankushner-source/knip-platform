from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_supabase_admin_client() -> Client:
    settings = get_settings()

    if not settings.supabase_url:
        raise RuntimeError("KNIP_SUPABASE_URL is not configured")

    if not settings.supabase_secret_key:
        raise RuntimeError("KNIP_SUPABASE_SECRET_KEY is not configured")

    return create_client(
        settings.supabase_url,
        settings.supabase_secret_key,
    )
