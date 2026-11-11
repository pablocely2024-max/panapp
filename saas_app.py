"""FastAPI application for PANAPP's super-admin and bakery-tenant domains."""

from __future__ import annotations

import hashlib
import hmac
import io
import logging
import os
import re
import secrets
import socket
import smtplib
import threading
import time
import uuid
import csv
from email.message import EmailMessage
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote, urlparse

import psycopg
import jwt
import qrcode
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError
from jwt import PyJWKClient
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from qrcode.image.svg import SvgPathImage
from starlette.middleware.trustedhost import TrustedHostMiddleware

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_NEON_AUTH_URL = "https://ep-lucky-lake-b8de2v7l.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth"


def resolve_public_hostname(configured_domain: str | None, external_hostname: str, external_url: str) -> str:
    candidates = (configured_domain, external_hostname, urlparse(external_url).hostname)
    for candidate in candidates:
        hostname = (candidate or "").strip().lower().lstrip(".")
        if hostname:
            return hostname
    return ""


def load_environment_files() -> None:
    for filename in (".env.local", ".env"):
        try:
            lines = (BASE_DIR / filename).read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            continue
        for line in lines:
            entry = line.strip()
            if not entry or entry.startswith("#"):
                continue
            if entry.startswith("export "):
                entry = entry[7:].lstrip()
            key, separator, value = entry.partition("=")
            key = key.strip()
            if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ.setdefault(key, value)


def read_port_setting(name: str, default: str) -> int:
    value = os.environ.get(name, default)
    try:
        port = int(value)
    except ValueError:
        raise RuntimeError(f"{name} debe ser un puerto numérico entre 1 y 65535.") from None
    if not 1 <= port <= 65535:
        raise RuntimeError(f"{name} debe ser un puerto numérico entre 1 y 65535.")
    return port


load_environment_files()
IS_RENDER = os.environ.get("RENDER", "").lower() == "true"
HOST = os.environ.get("PANAPP_HOST", "0.0.0.0" if IS_RENDER else "127.0.0.1")
PORT = (
    read_port_setting("PORT", os.environ.get("PANAPP_PORT", "8765"))
    if IS_RENDER
    else read_port_setting("PANAPP_PORT", os.environ.get("PORT", "8765"))
)
RENDER_EXTERNAL_HOSTNAME = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip().lower()
RENDER_EXTERNAL_URL = os.environ.get("RENDER_EXTERNAL_URL", "").strip()
RENDER_URL_HOSTNAME = (urlparse(RENDER_EXTERNAL_URL).hostname or "").lower()
BASE_DOMAIN = resolve_public_hostname(
    os.environ.get("PANAPP_BASE_DOMAIN"),
    RENDER_EXTERNAL_HOSTNAME,
    RENDER_EXTERNAL_URL,
)
LEGACY_TENANT_SLUG = os.environ.get("PANAPP_LEGACY_TENANT_SLUG", "panaderia-principal").strip().lower()
DATABASE_URL = os.environ.get("DATABASE_URL")
PANAPP_DB_VARIABLES = (
    "PANAPP_DB_HOST",
    "PANAPP_DB_PORT",
    "PANAPP_DB_NAME",
    "PANAPP_DB_USER",
    "PANAPP_DB_PASSWORD",
)
PANAPP_DB_CONFIGURED = all(os.environ.get(key) for key in PANAPP_DB_VARIABLES)
DB_CONFIG = {
    "host": os.environ.get("PANAPP_DB_HOST", "127.0.0.1"),
    "port": read_port_setting("PANAPP_DB_PORT", "5432"),
    "dbname": os.environ.get("PANAPP_DB_NAME", "panapp_local"),
    "user": os.environ.get("PANAPP_DB_USER", "postgres"),
    "connect_timeout": 5,
}
if os.environ.get("PANAPP_DB_PASSWORD"):
    DB_CONFIG["password"] = os.environ["PANAPP_DB_PASSWORD"]
ALLOWED_HOSTS = [
    host.strip().lower()
    for host in os.environ.get("PANAPP_ALLOWED_HOSTS", "").split(",")
    if host.strip()
]
NEON_AUTH_URL = os.environ.get("PANAPP_NEON_AUTH_URL", DEFAULT_NEON_AUTH_URL).strip().rstrip("/")
NEON_AUTH_ISSUER = os.environ.get("PANAPP_NEON_AUTH_ISSUER", NEON_AUTH_URL).strip()
NEON_AUTH_AUDIENCE = os.environ.get("PANAPP_NEON_AUTH_AUDIENCE", "authenticated").strip()
NEON_AUTH_JWKS_URL = f"{NEON_AUTH_URL}/.well-known/jwks.json" if NEON_AUTH_URL else ""
neon_jwks_client = PyJWKClient(NEON_AUTH_JWKS_URL, cache_keys=True, timeout=5) if NEON_AUTH_JWKS_URL else None

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
TENANT_SESSION_COOKIE = "panapp_tenant_session"
SUPERADMIN_SESSION_COOKIE = "panapp_superadmin_session"
SESSION_TTL_HOURS = 8
SESSION_IDLE_TIMEOUT_MINUTES = 5
DEFAULT_PANAPP_EMAIL = "panappanaderias@gmail.com"
PASSWORD_ITERATIONS = 480_000
NEON_DNS_ATTEMPTS = 5
NEON_DNS_RETRY_BASE_SECONDS = 0.25
ROLE_ADMIN = "ADMIN_PANADERIA"
ROLE_SUPERADMIN = "SUPERADMIN"
LEGACY_TENANT_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
failed_logins: dict[str, tuple[int, float]] = {}
auth_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        initialize_database()
    except psycopg.Error:
        logging.exception("No se pudo inicializar el esquema multi-tenant de PANAPP.")
        raise
    yield


app = FastAPI(
    title="PANAPP SaaS",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
trusted_hosts = [
    "127.0.0.1",
    "localhost",
    "testserver",
    "[::1]",
    *ALLOWED_HOSTS,
    RENDER_EXTERNAL_HOSTNAME,
    RENDER_URL_HOSTNAME,
]
trusted_hosts = [host for host in trusted_hosts if host]
if BASE_DOMAIN:
    trusted_hosts.extend([BASE_DOMAIN, f"*.{BASE_DOMAIN}"])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts)


def connect_db():
    if PANAPP_DB_CONFIGURED:
        config = dict(DB_CONFIG)
        if config["host"].lower().endswith(".neon.tech"):
            config["sslmode"] = os.environ.get("PANAPP_DB_SSLMODE", "require")
            return connect_to_neon(config["host"], config)
        elif os.environ.get("PANAPP_DB_SSLMODE"):
            config["sslmode"] = os.environ["PANAPP_DB_SSLMODE"]
        return psycopg.connect(**config)
    if DATABASE_URL:
        config = {"connect_timeout": DB_CONFIG["connect_timeout"]}
        database_host = (urlparse(DATABASE_URL).hostname or "").lower()
        if database_host.endswith(".neon.tech"):
            config["sslmode"] = os.environ.get("PANAPP_DB_SSLMODE", "require")
            return connect_to_neon(database_host, config, conninfo=DATABASE_URL)
        return psycopg.connect(DATABASE_URL, **config)
    return psycopg.connect(**DB_CONFIG)


def connect_to_neon(host: str, config: dict, *, conninfo: str | None = None):
    last_dns_error = None
    addresses = []
    for attempt in range(NEON_DNS_ATTEMPTS):
        try:
            addresses = list(
                dict.fromkeys(
                    result[4][0]
                    for result in socket.getaddrinfo(
                        host,
                        config.get("port", 5432),
                        type=socket.SOCK_STREAM,
                    )
                )
            )
            break
        except socket.gaierror as error:
            last_dns_error = error
            if attempt < NEON_DNS_ATTEMPTS - 1:
                time.sleep(NEON_DNS_RETRY_BASE_SECONDS * (2 ** attempt))
    if not addresses:
        raise psycopg.OperationalError(
            f"Unable to resolve Neon host {host!r} after {NEON_DNS_ATTEMPTS} attempts. "
            "Check the DNS/network connection and configured database endpoint."
        ) from last_dns_error

    last_connection_error = None
    for address in addresses:
        params = dict(config)
        params["host"] = host
        params["hostaddr"] = address
        try:
            if conninfo is not None:
                params.pop("port", None)
                return psycopg.connect(conninfo, **params)
            return psycopg.connect(**params)
        except psycopg.OperationalError as error:
            if error.sqlstate is not None:
                raise
            last_connection_error = error
    if last_connection_error is not None:
        raise last_connection_error
    raise psycopg.OperationalError(f"Neon host {host!r} did not return any IP addresses.")


def password_hash(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS).hex()


def allow_login_attempt(address: str) -> bool:
    now = time.time()
    with auth_lock:
        attempts, started = failed_logins.get(address, (0, now))
        if now - started > 900:
            failed_logins.pop(address, None)
            return True
        return attempts < 8


def record_login_failure(address: str) -> None:
    now = time.time()
    with auth_lock:
        attempts, started = failed_logins.get(address, (0, now))
        if now - started > 900:
            attempts, started = 0, now
        failed_logins[address] = (attempts + 1, started)


def clear_login_failures(address: str) -> None:
    with auth_lock:
        failed_logins.pop(address, None)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def verify_neon_access_token(token: str) -> dict:
    if not neon_jwks_client or not NEON_AUTH_ISSUER or not NEON_AUTH_AUDIENCE:
        raise HTTPException(status_code=503, detail="La autenticación Neon no está configurada.")
    try:
        signing_key = neon_jwks_client.get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError as error:
        logging.warning("No se pudieron consultar las claves públicas de Neon Auth: %s", error)
        raise HTTPException(status_code=503, detail="El servicio de autenticación no está disponible.") from error
    except PyJWKClientError as error:
        raise HTTPException(status_code=401, detail="Token de Neon Auth inválido.") from error
    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["EdDSA"],
            audience=NEON_AUTH_AUDIENCE,
            issuer=NEON_AUTH_ISSUER,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=401, detail="Token de Neon Auth inválido o vencido.") from error
    if not isinstance(claims.get("sub"), str) or not claims["sub"].strip():
        raise HTTPException(status_code=401, detail="La identidad del token de Neon Auth no es válida.")
    return claims


def initialize_database() -> None:
    legacy_salt_hash = None
    with connect_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_tenants (
                panaderia_id UUID PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'canceled')),
                menu_token TEXT UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute("ALTER TABLE panapp_tenants ADD COLUMN IF NOT EXISTS menu_token TEXT")
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS panapp_tenants_menu_token_unique ON panapp_tenants (menu_token) WHERE menu_token IS NOT NULL"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_plans (
                plan_id UUID PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                monthly_amount NUMERIC(12, 2) NOT NULL CHECK (monthly_amount >= 0),
                annual_amount NUMERIC(12, 2) NOT NULL CHECK (annual_amount >= 0),
                active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_subscriptions (
                subscription_id UUID PRIMARY KEY,
                panaderia_id UUID NOT NULL REFERENCES panapp_tenants(panaderia_id),
                plan_id UUID NOT NULL REFERENCES panapp_plans(plan_id),
                billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'annual')),
                status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
                current_period_start TIMESTAMPTZ NOT NULL,
                current_period_end TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_payments (
                payment_id UUID PRIMARY KEY,
                panaderia_id UUID NOT NULL REFERENCES panapp_tenants(panaderia_id),
                subscription_id UUID NOT NULL REFERENCES panapp_subscriptions(subscription_id),
                amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
                status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
                reference TEXT NOT NULL DEFAULT '',
                paid_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_users (
                user_id UUID PRIMARY KEY,
                panaderia_id UUID NOT NULL REFERENCES panapp_tenants(panaderia_id),
                username TEXT NOT NULL,
                salt TEXT,
                password_hash TEXT,
                role TEXT NOT NULL CHECK (role IN ('ADMIN_PANADERIA', 'MESERO')),
                auth_subject TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (panaderia_id, username)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_invitations (
                invitation_id UUID PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                user_id UUID NOT NULL REFERENCES panapp_users(user_id),
                panaderia_id UUID NOT NULL REFERENCES panapp_tenants(panaderia_id),
                email TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS panapp_invitations_pending_idx
            ON panapp_invitations (user_id, email, expires_at)
            WHERE used_at IS NULL
            """
        )
        connection.execute("ALTER TABLE panapp_users ALTER COLUMN salt DROP NOT NULL")
        connection.execute("ALTER TABLE panapp_users ALTER COLUMN password_hash DROP NOT NULL")
        connection.execute("ALTER TABLE panapp_users ADD COLUMN IF NOT EXISTS auth_subject TEXT")
        connection.execute(
            "DROP INDEX IF EXISTS panapp_users_auth_subject_unique"
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS panapp_users_auth_subject_idx
            ON panapp_users (auth_subject) WHERE auth_subject IS NOT NULL
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS panapp_users_tenant_auth_subject_unique
            ON panapp_users (panaderia_id, auth_subject) WHERE auth_subject IS NOT NULL
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_superadmins (
                superadmin_id UUID PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_sessions (
                token_hash TEXT PRIMARY KEY,
                principal_type TEXT NOT NULL CHECK (principal_type IN ('superadmin', 'tenant')),
                principal_id UUID NOT NULL,
                panaderia_id UUID REFERENCES panapp_tenants(panaderia_id),
                role TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            "ALTER TABLE panapp_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_state (
                panaderia_id UUID NOT NULL REFERENCES panapp_tenants(panaderia_id),
                state_key TEXT NOT NULL,
                payload JSONB NOT NULL,
                revision BIGINT NOT NULL DEFAULT 1,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (panaderia_id, state_key)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS panapp_orders (
                order_id UUID PRIMARY KEY,
                panaderia_id UUID NOT NULL REFERENCES panapp_tenants(panaderia_id),
                customer_name TEXT NOT NULL,
                order_type TEXT NOT NULL CHECK (order_type IN ('table', 'pickup', 'delivery')),
                table_number INTEGER,
                delivery_address TEXT NOT NULL DEFAULT '',
                items JSONB NOT NULL,
                total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
                status TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'confirmed', 'preparing', 'ready', 'completed', 'canceled')),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            INSERT INTO panapp_plans (plan_id, code, name, monthly_amount, annual_amount)
            VALUES
                ('20000000-0000-4000-8000-000000000001', 'starter', 'Esencial', 99000, 990000),
                ('20000000-0000-4000-8000-000000000002', 'business', 'Negocio', 179000, 1790000)
            ON CONFLICT (code) DO NOTHING
            """
        )
        connection.execute(
            """
            INSERT INTO panapp_tenants (panaderia_id, slug, name, status)
            VALUES (%s, %s, 'Panadería existente', 'active')
            ON CONFLICT (panaderia_id) DO NOTHING
            """,
            (LEGACY_TENANT_ID, LEGACY_TENANT_SLUG),
        )
        tenants_without_menu_token = connection.execute(
            "SELECT panaderia_id FROM panapp_tenants WHERE menu_token IS NULL"
        ).fetchall()
        for (tenant_id,) in tenants_without_menu_token:
            connection.execute(
                "UPDATE panapp_tenants SET menu_token = %s WHERE panaderia_id = %s AND menu_token IS NULL",
                (secrets.token_urlsafe(18), tenant_id),
            )

        old_state_exists = connection.execute(
            "SELECT to_regclass('public.panapp_state') IS NOT NULL"
        ).fetchone()[0]
        if old_state_exists:
            columns = {
                row[0]
                for row in connection.execute(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'panapp_state'
                    """
                ).fetchall()
            }
            if "panaderia_id" not in columns:
                connection.execute("ALTER TABLE panapp_state ADD COLUMN panaderia_id UUID")
                connection.execute(
                    "UPDATE panapp_state SET panaderia_id = %s WHERE panaderia_id IS NULL",
                    (LEGACY_TENANT_ID,),
                )
                connection.execute("ALTER TABLE panapp_state DROP CONSTRAINT IF EXISTS panapp_state_pkey")
                connection.execute("ALTER TABLE panapp_state ALTER COLUMN panaderia_id SET NOT NULL")
                connection.execute(
                    """
                    ALTER TABLE panapp_state
                    ADD CONSTRAINT panapp_state_pkey PRIMARY KEY (panaderia_id, state_key)
                    """
                )
                connection.execute(
                    """
                    ALTER TABLE panapp_state
                    ADD CONSTRAINT panapp_state_panaderia_id_fkey
                    FOREIGN KEY (panaderia_id) REFERENCES panapp_tenants(panaderia_id)
                    """
                )

        legacy_exists = connection.execute(
            "SELECT to_regclass('public.panapp_security') IS NOT NULL"
        ).fetchone()[0]
        if legacy_exists:
            columns = {
                row[0]
                for row in connection.execute(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'panapp_security'
                    """
                ).fetchall()
            }
            if {"singleton", "username", "salt", "password_hash"}.issubset(columns):
                legacy_salt_hash = connection.execute(
                    """
                    SELECT username, salt, password_hash
                    FROM panapp_security WHERE singleton = TRUE
                    """
                ).fetchone()
                if legacy_salt_hash:
                    connection.execute(
                        """
                        INSERT INTO panapp_users
                            (user_id, panaderia_id, username, salt, password_hash, role)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (panaderia_id, username) DO NOTHING
                        """,
                        (
                            uuid.uuid4(),
                            LEGACY_TENANT_ID,
                            legacy_salt_hash[0].lower(),
                            legacy_salt_hash[1],
                            legacy_salt_hash[2],
                            ROLE_ADMIN,
                        ),
                    )
            if "panaderia_id" not in columns:
                connection.execute("ALTER TABLE panapp_security ADD COLUMN panaderia_id UUID")
                connection.execute(
                    "UPDATE panapp_security SET panaderia_id = %s WHERE panaderia_id IS NULL",
                    (LEGACY_TENANT_ID,),
                )
                connection.execute("ALTER TABLE panapp_security ALTER COLUMN panaderia_id SET NOT NULL")
                connection.execute(
                    """
                    ALTER TABLE panapp_security
                    ADD CONSTRAINT panapp_security_panaderia_id_fkey
                    FOREIGN KEY (panaderia_id) REFERENCES panapp_tenants(panaderia_id)
                    """
                )

        connection.execute(
            """
            INSERT INTO panapp_subscriptions
                (subscription_id, panaderia_id, plan_id, billing_period, status,
                 current_period_start, current_period_end)
            SELECT %s, tenant.panaderia_id, plan.plan_id, 'monthly', 'active',
                   NOW(), NOW() + INTERVAL '100 years'
            FROM panapp_tenants tenant
            JOIN panapp_plans plan ON plan.code = 'starter'
            WHERE tenant.panaderia_id = %s
              AND NOT EXISTS (
                  SELECT 1 FROM panapp_subscriptions current
                  WHERE current.panaderia_id = tenant.panaderia_id
                    AND current.status = 'active'
              )
            """,
            (uuid.uuid4(), LEGACY_TENANT_ID),
        )

        founder_email = os.environ.get("PANAPP_SUPERADMIN_EMAIL", "").strip().lower()
        founder_password = os.environ.get("PANAPP_SUPERADMIN_PASSWORD", "")
        if founder_email and founder_password:
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", founder_email) or len(founder_password) < 12:
                raise ValueError("PANAPP_SUPERADMIN_EMAIL debe ser válido y la contraseña tener al menos 12 caracteres.")
            exists = connection.execute(
                "SELECT 1 FROM panapp_superadmins WHERE username = %s",
                (founder_email,),
            ).fetchone()
            if not exists:
                salt = secrets.token_bytes(32)
                connection.execute(
                    """
                    INSERT INTO panapp_superadmins
                        (superadmin_id, username, salt, password_hash)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        uuid.uuid4(),
                        founder_email,
                        salt.hex(),
                        password_hash(founder_password, salt),
                    ),
                )


@app.middleware("http")
async def resolve_tenant_host(request: Request, call_next):
    host = request.headers.get("host", "").split(":", 1)[0].strip("[]").lower()
    path = request.scope["path"]
    if path != "/api/health" and not path.startswith("/t/") and BASE_DOMAIN and host.endswith(f".{BASE_DOMAIN}"):
        slug = host[: -(len(BASE_DOMAIN) + 1)]
        if re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", slug) and slug != "superadmin":
            request.scope["path"] = f"/t/{slug}{path}"
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if "/api/" in request.scope["path"]:
        response.headers["Cache-Control"] = "no-store"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def validate_slug(slug: str) -> str:
    normalized = slug.strip().lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", normalized):
        raise HTTPException(status_code=422, detail="El identificador de panadería no es válido.")
    if normalized in {"admin", "api", "login", "menu", "superadmin", "www"}:
        raise HTTPException(status_code=422, detail="Ese identificador está reservado.")
    return normalized


def tenant_by_slug(slug: str, *, must_be_active: bool = True) -> dict:
    slug = validate_slug(slug)
    with connect_db() as connection:
        row = connection.execute(
            """
            SELECT tenant.panaderia_id, tenant.slug, tenant.name, tenant.status, tenant.created_at, tenant.menu_token,
                   subscription.status, subscription.current_period_end
            FROM panapp_tenants tenant
            LEFT JOIN LATERAL (
                SELECT status, current_period_end
                FROM panapp_subscriptions
                WHERE panaderia_id = tenant.panaderia_id
                ORDER BY created_at DESC LIMIT 1
            ) subscription ON TRUE
            WHERE tenant.slug = %s
            """,
            (slug,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Panadería no encontrada.")
    tenant = {
        "id": str(row[0]),
        "slug": row[1],
        "name": row[2],
        "status": row[3],
        "created_at": row[4].isoformat(),
        "menu_token": row[5],
        "subscription_status": row[6],
        "subscription_ends_at": row[7].isoformat() if row[7] else None,
    }
    if must_be_active:
        if tenant["status"] != "active":
            raise HTTPException(status_code=423, detail="Esta panadería no tiene el servicio activo.")
        if row[6] != "active" or row[7] is None or row[7] <= datetime.now(timezone.utc):
            with connect_db() as connection:
                connection.execute(
                    "UPDATE panapp_tenants SET status = 'suspended' WHERE panaderia_id = %s",
                    (uuid.UUID(tenant["id"]),),
                )
                connection.execute(
                    """
                    UPDATE panapp_subscriptions SET status = 'past_due'
                    WHERE panaderia_id = %s AND status = 'active'
                    """,
                    (uuid.UUID(tenant["id"]),),
                )
                connection.execute(
                    "UPDATE panapp_sessions SET expires_at = NOW() WHERE panaderia_id = %s",
                    (uuid.UUID(tenant["id"]),),
                )
            raise HTTPException(status_code=423, detail="La suscripción venció; contacta a PANAPP.")
    return tenant


def tenant_by_menu_token(menu_token: str, *, must_be_active: bool = True) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", menu_token):
        raise HTTPException(status_code=404, detail="El enlace del menú no es válido.")
    with connect_db() as connection:
        row = connection.execute(
            "SELECT slug FROM panapp_tenants WHERE menu_token = %s",
            (menu_token,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="El enlace del menú no existe.")
    return tenant_by_slug(row[0], must_be_active=must_be_active)


def current_session(request: Request) -> dict | None:
    is_superadmin_route = request.url.path.startswith(("/superadmin", "/api/superadmin"))
    cookie_name = SUPERADMIN_SESSION_COOKIE if is_superadmin_route else TENANT_SESSION_COOKIE
    token = request.cookies.get(cookie_name)
    if not token:
        return None
    with connect_db() as connection:
        touch_activity = not (
            request.method == "GET" and request.url.path.endswith("/api/state")
        )
        row = connection.execute(
            """
            UPDATE panapp_sessions
            SET last_activity_at = CASE WHEN %s THEN NOW() ELSE last_activity_at END
            WHERE token_hash = %s
              AND expires_at > NOW()
              AND last_activity_at > NOW() - (%s * INTERVAL '1 minute')
            RETURNING principal_type, principal_id, panaderia_id, role
            """,
            (touch_activity, hash_token(token), SESSION_IDLE_TIMEOUT_MINUTES),
        ).fetchone()
        if row:
            username_row = connection.execute(
                """
                SELECT username FROM panapp_users WHERE user_id = %s
                UNION ALL
                SELECT username FROM panapp_superadmins WHERE superadmin_id = %s
                LIMIT 1
                """,
                (row[1], row[1]),
            ).fetchone()
    if not row:
        return None
    return {
        "principal_type": row[0],
        "principal_id": str(row[1]),
        "panaderia_id": str(row[2]) if row[2] else None,
        "role": row[3],
        "username": username_row[0] if username_row else None,
    }


def require_superadmin(request: Request) -> dict:
    identity = current_session(request)
    if not identity or identity["principal_type"] != "superadmin" or identity["role"] != ROLE_SUPERADMIN:
        raise HTTPException(status_code=401, detail="Acceso exclusivo para superadministradores.")
    return identity


def require_tenant_admin(request: Request, tenant_id: str) -> dict:
    identity = current_session(request)
    if (
        not identity
        or identity["principal_type"] != "tenant"
        or identity["panaderia_id"] != tenant_id
        or identity["role"] != ROLE_ADMIN
    ):
        raise HTTPException(status_code=401, detail="Inicia sesión en esta panadería para continuar.")
    return identity


def issue_session(response: Response, request: Request, principal_type: str, principal_id: str, role: str, tenant_id: str | None = None) -> None:
    token = secrets.token_urlsafe(40)
    with connect_db() as connection:
        connection.execute(
            """
            INSERT INTO panapp_sessions
                (token_hash, principal_type, principal_id, panaderia_id, role, expires_at, last_activity_at)
            VALUES (%s, %s, %s, %s, %s, NOW() + (%s * INTERVAL '1 hour'), NOW())
            """,
            (
                hash_token(token),
                principal_type,
                uuid.UUID(principal_id),
                uuid.UUID(tenant_id) if tenant_id else None,
                role,
                SESSION_TTL_HOURS,
            ),
        )
    response.set_cookie(
        SUPERADMIN_SESSION_COOKIE if principal_type == "superadmin" else TENANT_SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_HOURS * 60 * 60,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/",
    )


def create_admin_invitation(connection, user_id: uuid.UUID, tenant_id: uuid.UUID, email: str) -> str:
    token = secrets.token_urlsafe(32)
    connection.execute(
        """
        INSERT INTO panapp_invitations
            (invitation_id, token_hash, user_id, panaderia_id, email, expires_at)
        VALUES (%s, %s, %s, %s, %s, NOW() + INTERVAL '7 days')
        """,
        (uuid.uuid4(), hash_token(token), user_id, tenant_id, email),
    )
    return token


def send_smtp_email(email: str, subject: str, content: str) -> bool:
    host = os.environ.get("PANAPP_SMTP_HOST", "smtp.gmail.com").strip()
    username = os.environ.get("PANAPP_SMTP_USER", DEFAULT_PANAPP_EMAIL).strip()
    password = os.environ.get("PANAPP_SMTP_PASSWORD", "")
    sender = os.environ.get("PANAPP_SMTP_FROM", username).strip()
    if not password or not all((host, username, sender)):
        return False

    port = read_port_setting("PANAPP_SMTP_PORT", "587")
    use_ssl = os.environ.get("PANAPP_SMTP_USE_SSL", "").strip().lower() in {"1", "true", "yes"}
    timeout = 8
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = email
    message.set_content(content)

    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=timeout) as server:
            server.login(username, password)
            refused = server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(username, password)
            refused = server.send_message(message)
    if refused:
        raise smtplib.SMTPRecipientsRefused(refused)
    logging.info("SMTP aceptó el mensaje de PANAPP para su entrega.")
    return True


def send_admin_invitation(email: str, tenant_name: str, invitation_url: str) -> bool:
    return send_smtp_email(
        email,
        f"Invitación de acceso a {tenant_name} · PANAPP",
        f"""Hola:

Se autorizó tu correo como administrador de {tenant_name} en PANAPP.
Abre el enlace seguro para verificar tu correo y configurar el acceso:

{invitation_url}

El enlace vence en 7 días y solo se puede usar una vez. Por seguridad, PANAPP nunca envía contraseñas por correo.
Si no esperabas esta invitación, ignora este mensaje.
""",
    )


def deliver_admin_invitation(email: str, tenant_name: str, invitation_url: str) -> dict:
    try:
        sent = send_admin_invitation(email, tenant_name, invitation_url)
    except (OSError, smtplib.SMTPException, RuntimeError, ValueError):
        logging.exception("No se pudo enviar la invitación PANAPP al administrador.")
        return {
            "invitation_sent": False,
            "invitation_url": invitation_url,
            "invitation_message": "El acceso quedó autorizado, pero no se pudo enviar el correo. Configura SMTP o copia el enlace seguro.",
        }
    if not sent:
        return {
            "invitation_sent": False,
            "invitation_url": invitation_url,
            "invitation_message": "El acceso quedó autorizado, pero falta configurar el correo SMTP. Copia el enlace seguro para compartirlo.",
        }
    return {
        "invitation_sent": True,
        "invitation_message": "Se envió un enlace seguro para crear la contraseña. No se envían contraseñas por correo.",
    }


def require_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != request.headers.get("host", "").lower():
        raise HTTPException(status_code=403, detail="Origen de solicitud no permitido.")


def read_tenant_state(tenant_id: str) -> dict:
    with connect_db() as connection:
        row = connection.execute(
            """
            SELECT payload, revision, updated_at
            FROM panapp_state WHERE panaderia_id = %s AND state_key = 'main'
            """,
            (uuid.UUID(tenant_id),),
        ).fetchone()
    if not row:
        return {"data": None, "revision": 0, "updated_at": None}
    return {"data": row[0], "revision": row[1], "updated_at": row[2].isoformat()}


def write_tenant_state(tenant_id: str, payload: dict) -> dict:
    with connect_db() as connection:
        row = connection.execute(
            """
            INSERT INTO panapp_state (panaderia_id, state_key, payload)
            VALUES (%s, 'main', %s)
            ON CONFLICT (panaderia_id, state_key) DO UPDATE
                SET payload = EXCLUDED.payload,
                    revision = panapp_state.revision + 1,
                    updated_at = NOW()
            RETURNING revision, updated_at
            """,
            (uuid.UUID(tenant_id), Jsonb(payload)),
        ).fetchone()
    return {"revision": row[0], "updated_at": row[1].isoformat()}


def public_catalog(tenant_id: str, tenant_name: str = "") -> dict:
    state = read_tenant_state(tenant_id)
    data = state["data"] if isinstance(state["data"], dict) else {}
    profile = data.get("perfilEmpresa") if isinstance(data.get("perfilEmpresa"), dict) else {}
    configuration = data.get("configuracionMenu") if isinstance(data.get("configuracionMenu"), dict) else {}
    products = data.get("productos") if isinstance(data.get("productos"), list) else []

    def public_text(value: object) -> str:
        return value if isinstance(value, str) else ""

    return {
        "revision": state["revision"],
        "business": {
            key: (
                tenant_name
                if key == "nombre" and public_text(profile.get(key, "")).strip().casefold() == "panadería panapp"
                else public_text(profile.get(key, "")) or (tenant_name if key == "nombre" else "")
            )
            for key in ("nombre", "tipo", "eslogan", "descripcion", "direccion", "ciudad", "horario", "telefono", "email", "moneda")
        },
        "whatsapp": public_text(configuration.get("whatsapp", "")),
        "products": [
            {
                "id": product.get("id"),
                "nombre": public_text(product.get("nombre")),
                "precio": product.get("precio") if isinstance(product.get("precio"), (int, float)) else None,
                "categoria": public_text(product.get("categoria")) or "Especiales",
                "disponible": isinstance(product.get("stock"), (int, float)) and product["stock"] > 0,
            }
            for product in products
            if isinstance(product, dict)
        ],
    }


def asset(name: str) -> FileResponse:
    if name not in {"auth.html", "admin.html", "menu.html", "superadmin.html", "cookie-policy.html", "auth.js", "neon-auth.js", "admin.js", "menu.js", "superadmin.js", "styles.css"}:
        raise HTTPException(status_code=404, detail="Recurso no encontrado.")
    media_types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }
    return FileResponse(BASE_DIR / name, media_type=media_types[Path(name).suffix])


class LoginBody(BaseModel):
    username: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class TenantCreateBody(BaseModel):
    slug: str = Field(min_length=3, max_length=63)
    name: str = Field(min_length=2, max_length=160)
    owner_email: str = Field(min_length=3, max_length=254)
    plan: Literal["starter", "business"]
    billing_period: Literal["monthly", "annual"]


class TenantAdminBody(BaseModel):
    username: str = Field(min_length=3, max_length=254)


class TenantStatusBody(BaseModel):
    status: Literal["active", "suspended", "canceled"]


class SubscriptionUpdateBody(BaseModel):
    plan: Literal["starter", "business"]
    billing_period: Literal["monthly", "annual"]


class PaymentBody(BaseModel):
    amount: float = Field(ge=0, le=999999999)
    reference: str = Field(default="", max_length=160)
    status: Literal["pending", "paid", "failed"] = "paid"


class OrderItem(BaseModel):
    product_id: str | int
    quantity: int = Field(ge=1, le=50)


class PublicOrderBody(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    order_type: Literal["table", "pickup", "delivery"]
    table_number: int | None = Field(default=None, ge=1, le=999)
    delivery_address: str = Field(default="", max_length=300)
    items: list[OrderItem] = Field(min_length=1, max_length=30)


@app.get("/")
def root():
    return RedirectResponse("/superadmin", status_code=302)


@app.get("/superadmin")
def superadmin_page():
    return asset("superadmin.html")


@app.get("/cookies")
def cookie_policy_page():
    return asset("cookie-policy.html")


@app.get("/superadmin.js")
def superadmin_script():
    return asset("superadmin.js")


@app.get("/styles.css")
def styles():
    return asset("styles.css")


@app.get("/auth.js")
def auth_script():
    return asset("auth.js")


@app.get("/neon-auth.js")
def neon_auth_script():
    return asset("neon-auth.js")


@app.get("/admin.js")
def admin_script():
    return asset("admin.js")


@app.get("/menu.js")
def menu_script():
    return asset("menu.js")

@app.get("/api/health")
def health():
    try:
        with connect_db() as connection:
            connection.execute("SELECT 1")
        return {"ok": True, "database": "connected"}
    except psycopg.Error as error:
        logging.exception("PANAPP PostgreSQL health check failed.")
        raise HTTPException(status_code=503, detail="Database unavailable.") from error


@app.get("/api/superadmin/status")
def superadmin_status(request: Request):
    identity = current_session(request)
    return {
        "authenticated": bool(identity and identity["principal_type"] == "superadmin"),
        "role": identity["role"] if identity else None,
    }


@app.post("/api/superadmin/login")
def superadmin_login(body: LoginBody, request: Request, response: Response):
    require_same_origin(request)
    address = request.client.host if request.client else "unknown"
    if not allow_login_attempt(address):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera 15 minutos.")
    with connect_db() as connection:
        row = connection.execute(
            """
            SELECT superadmin_id, username, salt, password_hash
            FROM panapp_superadmins WHERE username = %s
            """,
            (body.username.strip().lower(),),
        ).fetchone()
    if not row:
        record_login_failure(address)
        raise HTTPException(status_code=401, detail="Credenciales incorrectas.")
    candidate = password_hash(body.password, bytes.fromhex(row[2]))
    if not hmac.compare_digest(candidate, row[3]):
        record_login_failure(address)
        raise HTTPException(status_code=401, detail="Credenciales incorrectas.")
    clear_login_failures(address)
    issue_session(response, request, "superadmin", str(row[0]), ROLE_SUPERADMIN)
    return {"ok": True, "role": ROLE_SUPERADMIN}


@app.post("/api/superadmin/logout")
def superadmin_logout(request: Request, response: Response):
    require_same_origin(request)
    token = request.cookies.get(SUPERADMIN_SESSION_COOKIE)
    if token:
        with connect_db() as connection:
            connection.execute("DELETE FROM panapp_sessions WHERE token_hash = %s", (hash_token(token),))
    response.delete_cookie(SUPERADMIN_SESSION_COOKIE, path="/", httponly=True, samesite="strict")
    return {"ok": True}


@app.post("/api/superadmin/activity")
def superadmin_activity(request: Request, _: Annotated[dict, Depends(require_superadmin)]):
    require_same_origin(request)
    return {"ok": True}


@app.get("/api/superadmin/overview")
def superadmin_overview(_: Annotated[dict, Depends(require_superadmin)]):
    with connect_db() as connection:
        counts = connection.execute(
            """
            SELECT
                COUNT(*) FILTER (
                    WHERE tenant.status = 'active' AND subscription.status = 'active'
                      AND subscription.current_period_end > NOW()
                ) AS active_tenants,
                COALESCE(SUM(
                    CASE subscription.billing_period
                        WHEN 'annual' THEN plan.annual_amount / 12
                        ELSE plan.monthly_amount
                    END
                ) FILTER (
                    WHERE tenant.status = 'active' AND subscription.status = 'active'
                      AND subscription.current_period_end > NOW()
                ), 0) AS mrr
            FROM panapp_tenants tenant
            LEFT JOIN LATERAL (
                SELECT plan_id, billing_period, status, current_period_end
                FROM panapp_subscriptions
                WHERE panaderia_id = tenant.panaderia_id
                ORDER BY created_at DESC LIMIT 1
            ) subscription ON TRUE
            LEFT JOIN panapp_plans plan ON plan.plan_id = subscription.plan_id
            """
        ).fetchone()
    try:
        with connect_db() as connection:
            connection.execute("SELECT 1")
        database_status = "connected"
    except psycopg.Error:
        database_status = "disconnected"
    return {
        "active_tenants": counts[0],
        "mrr": float(counts[1]),
        "database": database_status,
    }


@app.get("/api/superadmin/plans")
def superadmin_plans(_: Annotated[dict, Depends(require_superadmin)]):
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT code, name, monthly_amount, annual_amount
            FROM panapp_plans WHERE active = TRUE ORDER BY monthly_amount
            """
        ).fetchall()
    return [
        {
            "code": row[0],
            "name": row[1],
            "monthly_amount": float(row[2]),
            "annual_amount": float(row[3]),
        }
        for row in rows
    ]


@app.get("/api/superadmin/tenants")
def superadmin_tenants(_: Annotated[dict, Depends(require_superadmin)]):
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT tenant.panaderia_id, tenant.slug, tenant.name, tenant.status, tenant.created_at, tenant.menu_token,
                   subscription.billing_period, subscription.status, plan.code, plan.name,
                   plan.monthly_amount, plan.annual_amount, admin.username
            FROM panapp_tenants tenant
            LEFT JOIN LATERAL (
                SELECT plan_id, billing_period, status, current_period_end
                FROM panapp_subscriptions
                WHERE panaderia_id = tenant.panaderia_id
                ORDER BY created_at DESC LIMIT 1
            ) subscription ON TRUE
            LEFT JOIN panapp_plans plan ON plan.plan_id = subscription.plan_id
            LEFT JOIN LATERAL (
                SELECT username
                FROM panapp_users
                WHERE panaderia_id = tenant.panaderia_id AND role = %s
                ORDER BY created_at DESC
                LIMIT 1
            ) admin ON TRUE
            ORDER BY tenant.created_at DESC
            """,
            (ROLE_ADMIN,),
        ).fetchall()
    return [
        {
            "id": str(row[0]),
            "slug": row[1],
            "name": row[2],
            "status": row[3],
            "created_at": row[4].isoformat(),
            "menu_token": row[5],
            "billing_period": row[6],
            "subscription_status": row[7],
            "plan_code": row[8],
            "plan_name": row[9],
            "monthly_amount": float(row[10]) if row[10] is not None else None,
            "annual_amount": float(row[11]) if row[11] is not None else None,
            "admin_email": row[12],
        }
        for row in rows
    ]


@app.post("/api/superadmin/tenants")
def create_tenant(body: TenantCreateBody, request: Request, _: Annotated[dict, Depends(require_superadmin)]):
    require_same_origin(request)
    slug = validate_slug(body.slug)
    email = body.owner_email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Correo del administrador inválido.")
    tenant_id = uuid.uuid4()
    subscription_id = uuid.uuid4()
    user_id = uuid.uuid4()
    menu_token = secrets.token_urlsafe(18)
    temporary_password = secrets.token_urlsafe(18)
    salt = secrets.token_bytes(32)
    password_digest = password_hash(temporary_password, salt)
    with connect_db() as connection:
        plan = connection.execute(
            "SELECT plan_id FROM panapp_plans WHERE code = %s AND active = TRUE",
            (body.plan,),
        ).fetchone()
        if not plan:
            raise HTTPException(status_code=422, detail="El plan seleccionado no está disponible.")
        tenant = connection.execute(
            """
            INSERT INTO panapp_tenants (panaderia_id, slug, name, status, menu_token)
            VALUES (%s, %s, %s, 'active', %s)
            ON CONFLICT (slug) DO NOTHING
            RETURNING panaderia_id
            """,
            (tenant_id, slug, body.name.strip(), menu_token),
        ).fetchone()
        if not tenant:
            raise HTTPException(status_code=409, detail="El identificador de panadería ya está en uso.")
        now = datetime.now(timezone.utc)
        end = now + (timedelta(days=365) if body.billing_period == "annual" else timedelta(days=30))
        connection.execute(
            """
            INSERT INTO panapp_subscriptions
                (subscription_id, panaderia_id, plan_id, billing_period, status,
                 current_period_start, current_period_end)
            VALUES (%s, %s, %s, %s, 'active', %s, %s)
            """,
            (subscription_id, tenant_id, plan[0], body.billing_period, now, end),
        )
        connection.execute(
            """
            INSERT INTO panapp_users
                (user_id, panaderia_id, username, salt, password_hash, role)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (user_id, tenant_id, email, salt.hex(), password_digest, ROLE_ADMIN),
        )
        connection.execute(
            """
            INSERT INTO panapp_state (panaderia_id, state_key, payload)
            VALUES (%s, 'main', %s)
            """,
            (tenant_id, Jsonb({"productos": [], "insumos": [], "proveedores": [], "encargos": [], "ventas": [], "mermas": []})),
        )
    menu_url = tenant_menu_url(request, menu_token)
    return {
        "id": str(tenant_id),
        "slug": slug,
        "name": body.name.strip(),
        "status": "active",
        "username": email,
        "temporary_password": temporary_password,
        "menu_url": menu_url,
        "menu_qr_url": f"{menu_url}/qr.svg",
        "admin_login_url": f"{str(request.base_url).rstrip('/')}/t/{quote(slug, safe='')}/login",
    }


@app.post("/api/superadmin/tenants/{slug}/admin")
def provision_tenant_admin(
    slug: str,
    body: TenantAdminBody,
    request: Request,
    _: Annotated[dict, Depends(require_superadmin)],
):
    require_same_origin(request)
    email = body.username.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Correo del administrador inválido.")
    tenant = tenant_by_slug(slug, must_be_active=False)
    temporary_password = secrets.token_urlsafe(18)
    salt = secrets.token_bytes(32)
    password_digest = password_hash(temporary_password, salt)
    with connect_db() as connection:
        user = connection.execute(
            """
            INSERT INTO panapp_users
                (user_id, panaderia_id, username, salt, password_hash, role)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (panaderia_id, username) DO UPDATE
            SET salt = EXCLUDED.salt,
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role
            RETURNING user_id
            """,
            (
                uuid.uuid4(),
                uuid.UUID(tenant["id"]),
                email,
                salt.hex(),
                password_digest,
                ROLE_ADMIN,
            ),
        ).fetchone()
        if not user:
            raise HTTPException(status_code=500, detail="No se pudo autorizar el administrador.")
        connection.execute(
            "UPDATE panapp_invitations SET used_at = NOW() WHERE user_id = %s AND used_at IS NULL",
            (user[0],),
        )
        connection.execute(
            "UPDATE panapp_sessions SET expires_at = NOW() WHERE principal_id = %s",
            (user[0],),
        )
    menu_url = tenant_menu_url(request, tenant["menu_token"])
    return {
        "slug": tenant["slug"],
        "username": email,
        "temporary_password": temporary_password,
        "menu_url": menu_url,
        "menu_qr_url": f"{menu_url}/qr.svg",
        "admin_login_url": f"{str(request.base_url).rstrip('/')}/t/{quote(tenant['slug'], safe='')}/login",
    }


@app.patch("/api/superadmin/tenants/{slug}/status")
def update_tenant_status(slug: str, body: TenantStatusBody, request: Request, _: Annotated[dict, Depends(require_superadmin)]):
    require_same_origin(request)
    tenant = tenant_by_slug(slug, must_be_active=False)
    with connect_db() as connection:
        connection.execute(
            "UPDATE panapp_tenants SET status = %s WHERE panaderia_id = %s",
            (body.status, uuid.UUID(tenant["id"])),
        )
        if body.status == "canceled":
            connection.execute(
                """
                UPDATE panapp_subscriptions SET status = 'canceled'
                WHERE panaderia_id = %s AND status <> 'canceled'
                """,
                (uuid.UUID(tenant["id"]),),
            )
        if body.status != "active":
            connection.execute(
                """
                UPDATE panapp_sessions SET expires_at = NOW()
                WHERE panaderia_id = %s
                """,
                (uuid.UUID(tenant["id"]),),
            )
        else:
            connection.execute(
                """
                UPDATE panapp_subscriptions
                SET status = 'active',
                    current_period_start = NOW(),
                    current_period_end = NOW() + CASE billing_period
                        WHEN 'annual' THEN INTERVAL '1 year'
                        ELSE INTERVAL '1 month'
                    END
                WHERE subscription_id = (
                    SELECT subscription_id FROM panapp_subscriptions
                    WHERE panaderia_id = %s ORDER BY created_at DESC LIMIT 1
                )
                """,
                (uuid.UUID(tenant["id"]),),
            )
    return {"slug": slug, "status": body.status}


@app.post("/api/superadmin/tenants/{slug}/payments")
def register_payment(slug: str, body: PaymentBody, request: Request, _: Annotated[dict, Depends(require_superadmin)]):
    require_same_origin(request)
    tenant = tenant_by_slug(slug, must_be_active=False)
    if tenant["status"] == "canceled":
        raise HTTPException(status_code=409, detail="No se pueden registrar pagos para una suscripción cancelada.")
    with connect_db() as connection:
        subscription = connection.execute(
            """
            SELECT subscription_id, billing_period FROM panapp_subscriptions
            WHERE panaderia_id = %s ORDER BY created_at DESC LIMIT 1
            """,
            (uuid.UUID(tenant["id"]),),
        ).fetchone()
        if not subscription:
            raise HTTPException(status_code=409, detail="La panadería aún no tiene una suscripción.")
        payment_id = uuid.uuid4()
        connection.execute(
            """
            INSERT INTO panapp_payments
                (payment_id, panaderia_id, subscription_id, amount, status, reference, paid_at)
            VALUES (%s, %s, %s, %s, %s, %s,
                    CASE WHEN %s = 'paid' THEN NOW() ELSE NULL END)
            """,
            (
                payment_id,
                uuid.UUID(tenant["id"]),
                subscription[0],
                body.amount,
                body.status,
                body.reference.strip(),
                body.status,
            ),
        )
        if body.status == "paid":
            interval = "1 year" if subscription[1] == "annual" else "1 month"
            connection.execute(
                """
                UPDATE panapp_subscriptions
                SET status = 'active',
                    current_period_end = GREATEST(current_period_end, NOW()) + %s::interval
                WHERE subscription_id = %s
                """,
                (interval, subscription[0]),
            )
            connection.execute(
                "UPDATE panapp_tenants SET status = 'active' WHERE panaderia_id = %s",
                (uuid.UUID(tenant["id"]),),
            )
    return {"payment_id": str(payment_id), "status": body.status}


@app.get("/api/superadmin/tenants/{slug}/payments")
def list_payments(slug: str, _: Annotated[dict, Depends(require_superadmin)]):
    tenant = tenant_by_slug(slug, must_be_active=False)
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT payment_id, amount, status, reference, paid_at, created_at
            FROM panapp_payments WHERE panaderia_id = %s
            ORDER BY created_at DESC LIMIT 100
            """,
            (uuid.UUID(tenant["id"]),),
        ).fetchall()
    return [
        {
            "id": str(row[0]),
            "amount": float(row[1]),
            "status": row[2],
            "reference": row[3],
            "paid_at": row[4].isoformat() if row[4] else None,
            "created_at": row[5].isoformat(),
        }
        for row in rows
    ]


@app.get("/api/superadmin/reports/subscription-revenue.csv")
def subscription_revenue_report(
    month: str,
    _: Annotated[dict, Depends(require_superadmin)],
):
    try:
        report_month = datetime.strptime(month, "%Y-%m")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="El mes debe tener el formato AAAA-MM.") from error
    if report_month.strftime("%Y-%m") != month:
        raise HTTPException(status_code=422, detail="El mes debe tener el formato AAAA-MM.")
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT tenant.name, tenant.slug, payment.amount, payment.reference,
                   payment.paid_at AT TIME ZONE 'America/Bogota'
            FROM panapp_payments payment
            JOIN panapp_tenants tenant ON tenant.panaderia_id = payment.panaderia_id
            WHERE payment.status = 'paid'
              AND to_char(payment.paid_at AT TIME ZONE 'America/Bogota', 'YYYY-MM') = %s
            ORDER BY payment.paid_at, tenant.name
            """,
            (month,),
        ).fetchall()
    report = io.StringIO(newline="")
    report.write("\ufeff")
    writer = csv.writer(report)
    writer.writerow(("Fecha (America/Bogota)", "Panadería", "Slug", "Valor COP", "Referencia"))
    for row in rows:
        writer.writerow((row[4].strftime("%Y-%m-%d %H:%M:%S"), row[0], row[1], row[2], row[3]))
    return Response(
        content=report.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="panapp-ingresos-{month}.csv"'},
    )


@app.get("/api/superadmin/reports/subscription-revenue")
def subscription_revenue_summary(
    month: str,
    _: Annotated[dict, Depends(require_superadmin)],
):
    try:
        report_month = datetime.strptime(month, "%Y-%m")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="El mes debe tener el formato AAAA-MM.") from error
    if report_month.strftime("%Y-%m") != month:
        raise HTTPException(status_code=422, detail="El mes debe tener el formato AAAA-MM.")
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT tenant.name, tenant.slug, payment.amount, payment.reference,
                   payment.paid_at AT TIME ZONE 'America/Bogota'
            FROM panapp_payments payment
            JOIN panapp_tenants tenant ON tenant.panaderia_id = payment.panaderia_id
            WHERE payment.status = 'paid'
              AND to_char(payment.paid_at AT TIME ZONE 'America/Bogota', 'YYYY-MM') = %s
            ORDER BY payment.paid_at, tenant.name
            """,
            (month,),
        ).fetchall()
    payments = [
        {
            "tenant_name": row[0],
            "tenant_slug": row[1],
            "amount": float(row[2]),
            "reference": row[3],
            "paid_at": row[4].isoformat(),
        }
        for row in rows
    ]
    return {
        "month": month,
        "payment_count": len(payments),
        "total": float(sum((Decimal(str(row[2])) for row in rows), Decimal("0"))),
        "payments": payments,
    }


@app.put("/api/superadmin/tenants/{slug}/subscription")
def update_subscription(slug: str, body: SubscriptionUpdateBody, request: Request, _: Annotated[dict, Depends(require_superadmin)]):
    require_same_origin(request)
    tenant = tenant_by_slug(slug, must_be_active=False)
    subscription_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    period_end = now + (timedelta(days=365) if body.billing_period == "annual" else timedelta(days=30))
    with connect_db() as connection:
        plan = connection.execute(
            "SELECT plan_id FROM panapp_plans WHERE code = %s AND active = TRUE",
            (body.plan,),
        ).fetchone()
        if not plan:
            raise HTTPException(status_code=422, detail="El plan seleccionado no está disponible.")
        connection.execute(
            """
            UPDATE panapp_subscriptions SET status = 'canceled'
            WHERE panaderia_id = %s AND status = 'active'
            """,
            (uuid.UUID(tenant["id"]),),
        )
        connection.execute(
            """
            INSERT INTO panapp_subscriptions
                (subscription_id, panaderia_id, plan_id, billing_period, status,
                 current_period_start, current_period_end)
            VALUES (%s, %s, %s, %s, 'active', %s, %s)
            """,
            (
                subscription_id,
                uuid.UUID(tenant["id"]),
                plan[0],
                body.billing_period,
                now,
                period_end,
            ),
        )
    return {"subscription_id": str(subscription_id), "status": "active"}


@app.get("/t/{slug}/login")
def tenant_login_page(slug: str):
    tenant_by_slug(slug)
    return asset("auth.html")


@app.get("/t/{slug}/admin")
def tenant_admin_page(slug: str, request: Request):
    tenant = tenant_by_slug(slug)
    require_tenant_admin(request, tenant["id"])
    return asset("admin.html")


@app.get("/t/{slug}/menu")
def tenant_menu_page(slug: str):
    tenant = tenant_by_slug(slug)
    return RedirectResponse(f"/m/{quote(tenant['menu_token'], safe='')}", status_code=302)


def tenant_menu_url(request: Request, menu_token: str) -> str:
    return f"{str(request.base_url).rstrip('/')}/m/{quote(menu_token, safe='')}"


@app.get("/m/{menu_token}")
def public_menu_page(menu_token: str):
    tenant_by_menu_token(menu_token)
    return asset("menu.html")


@app.get("/m/{menu_token}/api/menu")
def public_token_menu(menu_token: str):
    tenant = tenant_by_menu_token(menu_token)
    return public_catalog(tenant["id"], tenant["name"])


@app.get("/t/{slug}/menu/qr.svg")
def tenant_menu_qr(slug: str, request: Request):
    tenant = tenant_by_slug(slug)
    menu_url = tenant_menu_url(request, tenant["menu_token"])
    qr = qrcode.make(menu_url, image_factory=SvgPathImage)
    output = io.BytesIO()
    qr.save(output)
    return Response(
        content=output.getvalue(),
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f'attachment; filename="{tenant["slug"]}-menu-qr.svg"',
        },
    )


@app.get("/m/{menu_token}/qr.svg")
def public_menu_qr(menu_token: str, request: Request):
    tenant = tenant_by_menu_token(menu_token)
    return tenant_menu_qr(tenant["slug"], request)


@app.get("/t/{slug}/api/security/status")
def tenant_security_status(slug: str, request: Request):
    tenant = tenant_by_slug(slug)
    identity = current_session(request)
    if identity and identity["principal_type"] == "tenant" and identity["panaderia_id"] != tenant["id"]:
        identity = None
    with connect_db() as connection:
        configured = connection.execute(
            "SELECT 1 FROM panapp_users WHERE panaderia_id = %s LIMIT 1",
            (uuid.UUID(tenant["id"]),),
        ).fetchone() is not None
    username = None
    if identity and identity["principal_type"] == "tenant":
        username = identity["username"]
    return {
        "configured": configured,
        "authenticated": bool(
            identity
            and identity["principal_type"] == "tenant"
            and identity["role"] == ROLE_ADMIN
        ),
        "username": username,
        "role": identity["role"] if identity else None,
        "tenant": {"slug": tenant["slug"], "name": tenant["name"]},
    }


@app.get("/api/security/provider")
@app.get("/t/{slug}/api/security/provider")
def tenant_auth_provider(slug: str | None = None):
    if slug:
        tenant_by_slug(slug)
    if not NEON_AUTH_URL:
        raise HTTPException(status_code=503, detail="Neon Auth no está configurado.")
    return {"provider": "neon", "auth_url": NEON_AUTH_URL}


@app.post("/api/security/neon/session")
@app.post("/t/{slug}/api/security/neon/session")
def neon_tenant_login(
    request: Request,
    response: Response,
    slug: str | None = None,
):
    require_same_origin(request)
    authorization = request.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Inicia sesión con Neon Auth para continuar.")

    claims = verify_neon_access_token(token.strip())
    subject = claims["sub"]
    email = claims.get("email")
    email_verified = claims.get("email_verified") is True
    requested_slug = validate_slug(slug) if slug else None
    invitation_token = request.headers.get("x-panapp-invitation", "")

    with connect_db() as connection:
        subject_filter = ""
        parameters: tuple = (subject,)
        if requested_slug:
            subject_filter = "AND tenant.slug = %s"
            parameters += (requested_slug,)
        linked_users = connection.execute(
            """
            SELECT users.user_id, users.panaderia_id, users.username, users.role, tenant.slug
            FROM panapp_users users
            JOIN panapp_tenants tenant ON tenant.panaderia_id = users.panaderia_id
            WHERE users.auth_subject = %s
            """
            + subject_filter
            + """
            ORDER BY tenant.slug
            """,
            parameters,
        ).fetchall()
        if len(linked_users) > 1:
            raise HTTPException(
                status_code=409,
                detail="Esta identidad tiene acceso a varias panaderías. Inicia sesión desde el acceso de tu negocio.",
            )
        user = linked_users[0] if linked_users else None

        if not user:
            if not isinstance(email, str) or not email_verified:
                raise HTTPException(
                    status_code=403,
                    detail="Verifica el correo registrado por el propietario para habilitar el acceso.",
                )
            parameters: tuple = (email.strip().lower(), ROLE_ADMIN)
            tenant_filter = ""
            if requested_slug:
                tenant_filter = "AND tenant.slug = %s"
                parameters += (requested_slug,)
            users = connection.execute(
                f"""
                SELECT users.user_id, users.panaderia_id, users.username, users.role,
                       tenant.slug, users.auth_subject
                FROM panapp_users users
                JOIN panapp_tenants tenant ON tenant.panaderia_id = users.panaderia_id
                WHERE users.username = %s AND users.role = %s {tenant_filter}
                ORDER BY tenant.slug
                """,
                parameters,
            ).fetchall()
            if not users:
                raise HTTPException(
                    status_code=403,
                    detail="Este correo todavía no tiene acceso autorizado a una panadería.",
                )
            if len(users) > 1:
                raise HTTPException(
                    status_code=409,
                    detail="Este correo pertenece a varias panaderías. Inicia sesión desde el acceso de tu negocio.",
                )
            user = users[0]
            if user[5] and user[5] != subject:
                raise HTTPException(
                    status_code=409,
                    detail="El correo ya está vinculado a otra identidad de Neon Auth. Contacta al superadministrador.",
                )
            if user[5] is None:
                invitation = connection.execute(
                    """
                    SELECT invitation_id, token_hash
                    FROM panapp_invitations
                    WHERE user_id = %s AND panaderia_id = %s AND email = %s
                      AND used_at IS NULL AND expires_at > NOW()
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (user[0], user[1], email.strip().lower()),
                ).fetchone()
                if invitation and not hmac.compare_digest(
                    invitation[1],
                    hash_token(invitation_token) if invitation_token else "",
                ):
                    raise HTTPException(
                        status_code=403,
                        detail="Abre el enlace de invitación que enviamos a tu correo para activar el acceso.",
                    )
                if invitation:
                    connection.execute(
                        """
                        UPDATE panapp_invitations SET used_at = NOW()
                        WHERE invitation_id = %s AND used_at IS NULL
                        """,
                        (invitation[0],),
                    )
                connection.execute(
                    "UPDATE panapp_users SET auth_subject = %s WHERE user_id = %s AND auth_subject IS NULL",
                    (subject, user[0]),
                )
            linked_user = connection.execute(
                """
                SELECT users.user_id, users.panaderia_id, users.username, users.role, tenant.slug
                FROM panapp_users users
                JOIN panapp_tenants tenant ON tenant.panaderia_id = users.panaderia_id
                WHERE users.user_id = %s AND users.auth_subject = %s
                """,
                (user[0], subject),
            ).fetchone()
            if not linked_user:
                raise HTTPException(status_code=409, detail="La identidad ya está vinculada a otra cuenta.")
            user = linked_user

    tenant = tenant_by_slug(user[4])
    if user[3] != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Esta cuenta no tiene acceso al panel administrativo.")
    issue_session(response, request, "tenant", str(user[0]), user[3], tenant["id"])
    return {"ok": True, "username": user[2], "role": user[3], "tenant": tenant["slug"]}


def verify_legacy_tenant_credentials(username: str, password: str, slug: str | None = None) -> bool:
    email = username.strip().lower()
    parameters: tuple = (email, ROLE_ADMIN)
    tenant_filter = ""
    if slug:
        tenant_filter = "AND tenant.slug = %s"
        parameters += (validate_slug(slug),)
    with connect_db() as connection:
        users = connection.execute(
            f"""
            SELECT users.salt, users.password_hash
            FROM panapp_users users
            JOIN panapp_tenants tenant ON tenant.panaderia_id = users.panaderia_id
            WHERE users.username = %s AND users.role = %s
              AND users.auth_subject IS NULL
              AND users.salt IS NOT NULL AND users.password_hash IS NOT NULL
              {tenant_filter}
            ORDER BY tenant.slug
            """,
            parameters,
        ).fetchall()
    if len(users) != 1:
        return False
    salt, stored_hash = users[0]
    return hmac.compare_digest(
        password_hash(password, bytes.fromhex(salt)),
        stored_hash,
    )


@app.post("/api/security/legacy-credentials")
@app.post("/t/{slug}/api/security/legacy-credentials")
def verify_legacy_tenant_login(
    body: LoginBody,
    request: Request,
    slug: str | None = None,
):
    require_same_origin(request)
    if not NEON_AUTH_URL:
        raise HTTPException(status_code=404, detail="No hay credenciales antiguas por migrar.")
    address = request.client.host if request.client else "unknown"
    if not allow_login_attempt(address):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera 15 minutos.")
    if not verify_legacy_tenant_credentials(body.username, body.password, slug):
        record_login_failure(address)
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    clear_login_failures(address)
    return {"ok": True, "email": body.username.strip().lower()}


@app.get("/api/security/status")
def global_security_status(request: Request):
    identity = current_session(request)
    tenant_slug = None
    authenticated = bool(
        identity
        and identity["principal_type"] == "tenant"
        and identity["role"] == ROLE_ADMIN
        and identity["panaderia_id"]
    )
    if authenticated:
        with connect_db() as connection:
            row = connection.execute(
                "SELECT slug FROM panapp_tenants WHERE panaderia_id = %s",
                (uuid.UUID(identity["panaderia_id"]),),
            ).fetchone()
        tenant_slug = row[0] if row else None
        authenticated = tenant_slug is not None
    return {
        "authenticated": authenticated,
        "tenant": tenant_slug,
        "username": identity["username"] if authenticated else None,
    }


@app.post("/api/security/login")
def global_tenant_login(body: LoginBody, request: Request, response: Response):
    require_same_origin(request)
    address = request.client.host if request.client else "unknown"
    if not allow_login_attempt(address):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera 15 minutos.")
    username = body.username.strip().lower()
    with connect_db() as connection:
        rows = connection.execute(
            """
            SELECT users.user_id, users.panaderia_id, users.salt, users.password_hash,
                   users.role, tenants.slug
            FROM panapp_users users
            JOIN panapp_tenants tenants ON tenants.panaderia_id = users.panaderia_id
            WHERE users.username = %s
            """,
            (username,),
        ).fetchall()
    matches = [
        row for row in rows
        if row[2] is not None
        and row[3] is not None
        and hmac.compare_digest(
            password_hash(body.password, bytes.fromhex(row[2])),
            row[3],
        )
    ]
    admins = [row for row in matches if row[4] == ROLE_ADMIN]
    if not admins:
        if matches:
            clear_login_failures(address)
            raise HTTPException(status_code=403, detail="Esta cuenta no tiene acceso al panel administrativo.")
        record_login_failure(address)
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    if len(admins) > 1:
        clear_login_failures(address)
        raise HTTPException(
            status_code=409,
            detail="Este correo y contraseña están asociados a varias panaderías. Usa el acceso de la panadería correspondiente.",
        )
    user = admins[0]
    tenant = tenant_by_slug(user[5])
    clear_login_failures(address)
    issue_session(response, request, "tenant", str(user[0]), user[4], tenant["id"])
    return {
        "ok": True,
        "username": username,
        "role": user[4],
        "tenant": tenant["slug"],
    }


@app.post("/t/{slug}/api/security/login")
def tenant_login(slug: str, body: LoginBody, request: Request, response: Response):
    require_same_origin(request)
    tenant = tenant_by_slug(slug)
    address = request.client.host if request.client else "unknown"
    if not allow_login_attempt(address):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera 15 minutos.")
    with connect_db() as connection:
        row = connection.execute(
            """
            SELECT user_id, username, salt, password_hash, role
            FROM panapp_users WHERE panaderia_id = %s AND username = %s
            """,
            (uuid.UUID(tenant["id"]), body.username.strip().lower()),
        ).fetchone()
    if not row or row[2] is None or row[3] is None:
        record_login_failure(address)
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    candidate = password_hash(body.password, bytes.fromhex(row[2]))
    if not hmac.compare_digest(candidate, row[3]):
        record_login_failure(address)
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    if row[4] != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Esta cuenta no tiene acceso al panel administrativo.")
    clear_login_failures(address)
    issue_session(response, request, "tenant", str(row[0]), row[4], tenant["id"])
    return {
        "ok": True,
        "username": row[1],
        "role": row[4],
        "tenant": tenant["slug"],
    }


@app.post("/t/{slug}/api/menu/orders")
def create_public_order(slug: str, body: PublicOrderBody, request: Request):
    require_same_origin(request)
    tenant = tenant_by_slug(slug)
    if body.order_type == "table" and body.table_number is None:
        raise HTTPException(status_code=422, detail="Indica el número de mesa.")
    if body.order_type == "delivery" and not body.delivery_address.strip():
        raise HTTPException(status_code=422, detail="Indica la dirección de entrega.")
    state = read_tenant_state(tenant["id"])
    data = state["data"] if isinstance(state["data"], dict) else {}
    products = data.get("productos") if isinstance(data.get("productos"), list) else []
    product_by_id = {str(item.get("id")): item for item in products if isinstance(item, dict)}
    order_lines = []
    total = 0.0
    for item in body.items:
        product = product_by_id.get(str(item.product_id))
        if not product or not isinstance(product.get("stock"), (int, float)) or product["stock"] <= 0:
            raise HTTPException(status_code=409, detail="Uno de los productos ya no está disponible.")
        price = product.get("precio")
        if not isinstance(price, (int, float)) or price < 0:
            raise HTTPException(status_code=409, detail="Uno de los productos no tiene un precio válido.")
        line_total = float(price) * item.quantity
        total += line_total
        order_lines.append({
            "product_id": str(item.product_id),
            "name": str(product.get("nombre", "Producto"))[:160],
            "quantity": item.quantity,
            "unit_price": float(price),
            "total": line_total,
        })
    order_id = uuid.uuid4()
    with connect_db() as connection:
        connection.execute(
            """
            INSERT INTO panapp_orders
                (order_id, panaderia_id, customer_name, order_type, table_number,
                 delivery_address, items, total)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                order_id,
                uuid.UUID(tenant["id"]),
                body.customer_name.strip(),
                body.order_type,
                body.table_number,
                body.delivery_address.strip(),
                Jsonb(order_lines),
                total,
            ),
        )
    configuration = data.get("configuracionMenu")
    if not isinstance(configuration, dict):
        configuration = {}
    phone = str(configuration.get("whatsapp", ""))
    phone = re.sub(r"\D", "", phone)
    delivery = {
        "table": f"Mesa {body.table_number}",
        "pickup": "Para recoger",
        "delivery": f"Domicilio: {body.delivery_address.strip()}",
    }[body.order_type]
    message = (
        f"Pedido PANAPP #{str(order_id)[:8]} · {tenant['name']}\n"
        f"Cliente: {body.customer_name.strip()}\n"
        + "\n".join(f"{line['quantity']} x {line['name']} — {line['total']:.0f}" for line in order_lines)
        + f"\nTotal estimado: {total:.0f}\nEntrega: {delivery}"
    )
    whatsapp_url = f"https://wa.me/{phone}?text={quote(message)}" if 10 <= len(phone) <= 15 else None
    return {"order_id": str(order_id), "status": "received", "total": total, "whatsapp_url": whatsapp_url}


@app.post("/m/{menu_token}/api/menu/orders")
def create_public_token_order(menu_token: str, body: PublicOrderBody, request: Request):
    tenant = tenant_by_menu_token(menu_token)
    return create_public_order(tenant["slug"], body, request)


@app.post("/t/{slug}/api/security/logout")
def tenant_logout(slug: str, request: Request, response: Response):
    require_same_origin(request)
    tenant = tenant_by_slug(slug, must_be_active=False)
    identity = current_session(request)
    if identity and identity["panaderia_id"] == tenant["id"]:
        token = request.cookies.get(TENANT_SESSION_COOKIE)
        if token:
            with connect_db() as connection:
                connection.execute("DELETE FROM panapp_sessions WHERE token_hash = %s", (hash_token(token),))
    response.delete_cookie(TENANT_SESSION_COOKIE, path="/", httponly=True, samesite="strict")
    return {"ok": True}


@app.post("/t/{slug}/api/security/activity")
def tenant_activity(slug: str, request: Request):
    require_same_origin(request)
    tenant = tenant_by_slug(slug)
    require_tenant_admin(request, tenant["id"])
    return {"ok": True}


@app.post("/t/{slug}/api/security/password")
def tenant_password(slug: str, request: Request, response: Response, body: dict):
    require_same_origin(request)
    tenant = tenant_by_slug(slug)
    identity = require_tenant_admin(request, tenant["id"])
    current_password = str(body.get("current_password", ""))
    new_password = str(body.get("new_password", ""))
    if not 12 <= len(new_password) <= 256:
        raise HTTPException(status_code=422, detail="La nueva contraseña debe tener entre 12 y 256 caracteres.")
    with connect_db() as connection:
        row = connection.execute(
            """
            SELECT salt, password_hash FROM panapp_users
            WHERE user_id = %s AND panaderia_id = %s
            """,
            (uuid.UUID(identity["principal_id"]), uuid.UUID(tenant["id"])),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=403, detail="No se pudo validar la cuenta administradora.")
        if (
            row[0] is None
            or row[1] is None
            or not hmac.compare_digest(password_hash(current_password, bytes.fromhex(row[0])), row[1])
        ):
            raise HTTPException(status_code=403, detail="La contraseña actual no es correcta.")
        salt = secrets.token_bytes(32)
        connection.execute(
            """
            UPDATE panapp_users SET salt = %s, password_hash = %s
            WHERE user_id = %s AND panaderia_id = %s
            """,
            (salt.hex(), password_hash(new_password, salt), uuid.UUID(identity["principal_id"]), uuid.UUID(tenant["id"])),
        )
        connection.execute(
            "DELETE FROM panapp_sessions WHERE principal_id = %s",
            (uuid.UUID(identity["principal_id"]),),
        )
    issue_session(response, request, "tenant", identity["principal_id"], identity["role"], tenant["id"])
    return {"ok": True, "tenant": tenant["slug"], "username": identity["username"]}


@app.get("/t/{slug}/api/state")
def tenant_state(slug: str, request: Request):
    tenant = tenant_by_slug(slug)
    require_tenant_admin(request, tenant["id"])
    return read_tenant_state(tenant["id"])


@app.put("/t/{slug}/api/state")
def save_tenant_state(slug: str, request: Request, payload: dict):
    require_same_origin(request)
    tenant = tenant_by_slug(slug)
    require_tenant_admin(request, tenant["id"])
    data = payload.get("data")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Se requiere un objeto 'data'.")
    return {"ok": True, **write_tenant_state(tenant["id"], data)}


@app.get("/t/{slug}/api/menu")
def tenant_menu(slug: str):
    tenant = tenant_by_slug(slug)
    return public_catalog(tenant["id"], tenant["name"])


@app.get("/t/{slug}/auth.html")
def tenant_auth_asset(slug: str):
    tenant_by_slug(slug)
    return asset("auth.html")


@app.get("/t/{slug}/admin.html")
def tenant_admin_asset(slug: str, request: Request):
    return tenant_admin_page(slug, request)


@app.get("/t/{slug}/menu.html")
def tenant_menu_asset(slug: str):
    tenant_by_slug(slug)
    return asset("menu.html")


@app.get("/t/{slug}/{route:path}")
def tenant_routes(slug: str, route: str, request: Request):
    tenant = tenant_by_slug(slug)
    if route in {"", "index.html"}:
        return RedirectResponse(f"/t/{slug}/menu", status_code=302)
    if route in {"login", "auth.html"}:
        return asset("auth.html")
    if route in {"admin", "admin.html"}:
        require_tenant_admin(request, tenant["id"])
        return asset("admin.html")
    if route in {"menu", "menu.html"}:
        return asset("menu.html")
    if route in {"auth.js", "neon-auth.js", "admin.js", "menu.js", "styles.css"}:
        return asset(route)
    raise HTTPException(status_code=404, detail="Ruta no encontrada.")


@app.get("/login")
def default_login():
    return asset("auth.html")


@app.get("/admin")
def default_admin(request: Request):
    tenant = tenant_by_slug(LEGACY_TENANT_SLUG)
    identity = current_session(request)
    destination = (
        f"/t/{LEGACY_TENANT_SLUG}/admin"
        if identity
        and identity["principal_type"] == "tenant"
        and identity["role"] == ROLE_ADMIN
        and identity["panaderia_id"] == tenant["id"]
        else f"/t/{LEGACY_TENANT_SLUG}/login"
    )
    return RedirectResponse(destination, status_code=302)


@app.get("/menu")
def default_menu():
    return RedirectResponse(f"/t/{LEGACY_TENANT_SLUG}/menu", status_code=302)


@app.get("/api/{route:path}")
def default_api_routes(route: str):
    if route == "health":
        return health()
    raise HTTPException(status_code=404, detail="Ruta no encontrada.")


def main() -> int:
    if HOST not in {"127.0.0.1", "localhost", "::1", "0.0.0.0"}:
        logging.error("PANAPP_HOST debe ser loopback o 0.0.0.0 detrás de un proxy HTTPS.")
        return 1
    if HOST == "0.0.0.0" and not BASE_DOMAIN:
        logging.error("Configura PANAPP_BASE_DOMAIN antes de escuchar en una interfaz pública.")
        return 1
    tls_certfile = os.environ.get("PANAPP_TLS_CERTFILE")
    tls_keyfile = os.environ.get("PANAPP_TLS_KEYFILE")
    if bool(tls_certfile) != bool(tls_keyfile):
        logging.error("PANAPP_TLS_CERTFILE y PANAPP_TLS_KEYFILE deben configurarse juntos.")
        return 1
    if tls_certfile and (not Path(tls_certfile).is_file() or not Path(tls_keyfile).is_file()):
        logging.error("No se encontraron los archivos TLS configurados para PANAPP.")
        return 1
    scheme = "https" if tls_certfile else "http"
    logging.info("PANAPP FastAPI disponible en %s://%s:%s", scheme, HOST, PORT)
    trusted_proxies = os.environ.get("PANAPP_TRUSTED_PROXIES", "127.0.0.1")
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        proxy_headers=True,
        forwarded_allow_ips=trusted_proxies,
        ssl_certfile=tls_certfile,
        ssl_keyfile=tls_keyfile,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
