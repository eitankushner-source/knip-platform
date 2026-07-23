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

def get_admin_profile_id() -> str:
    client = get_supabase_admin_client()
    response = (
        client.table("profiles")
        .select("id")
        .eq("email", "eitankushner@gmail.com")
        .limit(1)
        .execute()
    )

    rows = response.data or []
    if not rows:
        raise RuntimeError("Admin profile was not found in Supabase")

    return str(rows[0]["id"])
