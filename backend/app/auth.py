from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request

from app.config import get_settings
from app.supabase_client import get_profile_for_auth_user


@dataclass
class AuthenticatedProfile:
    supabase_user_id: str
    profile_id: str
    email: str | None

    @property
    def display_name(self) -> str:
        return self.email or self.profile_id


@lru_cache
def _jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(jwks_url)


def _supabase_issuer() -> str:
    settings = get_settings()
    if settings.supabase_jwt_issuer:
        return settings.supabase_jwt_issuer.rstrip("/")
    if settings.supabase_url:
        return f"{settings.supabase_url.rstrip('/')}/auth/v1"
    raise RuntimeError("KNIP_SUPABASE_URL or KNIP_SUPABASE_JWT_ISSUER must be configured")


def _supabase_jwks_url() -> str:
    settings = get_settings()
    if settings.supabase_jwt_jwks_url:
        return settings.supabase_jwt_jwks_url
    return f"{_supabase_issuer()}/.well-known/jwks.json"


def _raise_auth_error(message: str) -> None:
    raise HTTPException(
        status_code=401,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _extract_bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization") or request.headers.get("authorization")
    if not header:
        _raise_auth_error("Missing bearer token")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        _raise_auth_error("Missing bearer token")
    return token.strip()


def _decode_access_token(token: str) -> dict:
    settings = get_settings()
    issuer = _supabase_issuer()
    common_decode_kwargs = {
        "audience": settings.supabase_jwt_audience,
        "issuer": issuer,
        "options": {"require": ["sub", "exp", "iss", "aud"]},
    }

    try:
        if settings.supabase_jwt_secret:
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256", "HS384", "HS512"],
                **common_decode_kwargs,
            )

        signing_key = _jwks_client(_supabase_jwks_url()).get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
            **common_decode_kwargs,
        )
    except jwt.ExpiredSignatureError as exc:
        _raise_auth_error("Token expired")
        raise exc
    except jwt.InvalidTokenError as exc:
        _raise_auth_error("Invalid token")
        raise exc


def require_authenticated_profile(request: Request) -> AuthenticatedProfile:
    token = _extract_bearer_token(request)
    claims = _decode_access_token(token)

    supabase_user_id = str(claims.get("sub") or "").strip()
    if not supabase_user_id:
        _raise_auth_error("Invalid token")

    profile = get_profile_for_auth_user(supabase_user_id)
    if not profile:
        raise HTTPException(status_code=403, detail="Authenticated user has no profile")

    return AuthenticatedProfile(
        supabase_user_id=supabase_user_id,
        profile_id=str(profile["id"]),
        email=claims.get("email"),
    )
