"""The tenant's AI configuration that lives with its AI state: run retention and the tenant's own provider key.

The key is encrypted inside PostgreSQL with ``pgcrypto`` (``pgp_sym_encrypt``, AES-256) under a deployment secret
named by a key id; each ciphertext stores the id of the secret that encrypted it, so the secret can rotate
(``python -m liwan_ai_service.tenant_config --rotate``). The key is write-only: only ``configured``, the provider,
the model and its last four characters ever leave this module (spec 2026-11-04 §6.8).
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

KEY_ID = re.compile(r"[a-z0-9_-]{1,32}")
MIN_SECRET_LENGTH = 32
DEFAULT_RETENTION_DAYS = 30
MIN_RETENTION_DAYS, MAX_RETENTION_DAYS = 1, 365
LAST_CHARACTERS = 4


class KeyUnavailable(Exception):  # noqa: N818 - a domain condition the routes answer with 503 ai_key_unavailable
    """No deployment secret can encrypt or decrypt a tenant key (none configured, or a ciphertext's key id is unknown)."""


@dataclass(frozen=True)
class Keyring:
    """The deployment's key-encryption secrets by id, and the id new ciphertexts use."""

    secrets: Mapping[str, str]
    current_id: str

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> Keyring | None:
        """``AI_KEY_ENCRYPTION_KEYS`` (``id:secret,id:secret``) and ``AI_KEY_ENCRYPTION_KEY_ID``; None when both are unset."""
        from liwan_ai_service.settings import SettingsError

        raw, current = environ.get("AI_KEY_ENCRYPTION_KEYS", "").strip(), environ.get("AI_KEY_ENCRYPTION_KEY_ID", "").strip()
        if not raw and not current:
            return None
        secrets: dict[str, str] = {}
        for entry in raw.split(","):
            key_id, _, secret = entry.strip().partition(":")
            if not KEY_ID.fullmatch(key_id) or len(secret) < MIN_SECRET_LENGTH or key_id in secrets:
                msg = f"AI_KEY_ENCRYPTION_KEYS must list unique id:secret pairs, secrets of {MIN_SECRET_LENGTH}+ characters"
                raise SettingsError("AI_KEY_ENCRYPTION_KEYS", msg)
            secrets[key_id] = secret
        if current not in secrets:
            raise SettingsError("AI_KEY_ENCRYPTION_KEY_ID", "AI_KEY_ENCRYPTION_KEY_ID must name one of AI_KEY_ENCRYPTION_KEYS")
        return cls(secrets=secrets, current_id=current)

    def secret(self, key_id: str) -> str:
        try:
            return self.secrets[key_id]
        except KeyError:
            raise KeyUnavailable("ai_key_unavailable") from None


@dataclass(frozen=True)
class KeyStatus:
    configured: bool
    provider: str | None = None
    model: str | None = None
    last4: str | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class TenantKey:
    provider: str
    model: str
    api_key: str
    updated_at: datetime


@dataclass(frozen=True)
class TenantConfig:
    retention_days: int
    key: KeyStatus


class TenantConfigStore(Protocol):
    async def get(self) -> TenantConfig: ...
    async def set_retention(self, days: int) -> TenantConfig: ...
    async def set_key(self, provider: str, model: str, api_key: str, keyring: Keyring | None) -> TenantConfig: ...
    async def clear_key(self) -> TenantConfig: ...
    async def load_key(self, keyring: Keyring | None) -> TenantKey | None: ...


def check_retention(days: int) -> int:
    if not MIN_RETENTION_DAYS <= days <= MAX_RETENTION_DAYS:
        msg = f"retention_days must be {MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS}"
        raise ValueError(msg)
    return days


class MemoryTenantConfig:
    """Development and tests: the same rules without a database (the key is held as given, nothing is persisted)."""

    def __init__(self, retention_days: int = DEFAULT_RETENTION_DAYS) -> None:
        self.retention_days = retention_days
        self.key: TenantKey | None = None

    async def get(self) -> TenantConfig:
        return TenantConfig(self.retention_days, _status(self.key))

    async def set_retention(self, days: int) -> TenantConfig:
        self.retention_days = check_retention(days)
        return await self.get()

    async def set_key(self, provider: str, model: str, api_key: str, keyring: Keyring | None) -> TenantConfig:
        if keyring is None:
            raise KeyUnavailable("ai_key_unavailable")
        self.key = TenantKey(provider, model, api_key, datetime.now(UTC))
        return await self.get()

    async def clear_key(self) -> TenantConfig:
        self.key = None
        return await self.get()

    async def load_key(self, keyring: Keyring | None) -> TenantKey | None:
        return self.key


def _status(key: TenantKey | None) -> KeyStatus:
    if key is None:
        return KeyStatus(configured=False)
    return KeyStatus(True, key.provider, key.model, key.api_key[-LAST_CHARACTERS:], key.updated_at)




class PostgresTenantConfig:
    """``ai_tenant_config`` of one tenant schema; ``pgcrypto`` lives in the same schema (deploy/ai/tenant_schema.sql)."""

    def __init__(self, pool) -> None:
        self.pool = pool

    async def get(self) -> TenantConfig:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT retention_days, key_provider, key_model, key_last4, key_updated_at FROM ai_tenant_config WHERE singleton",
            )).fetchone()
        return _config_of(row)

    async def set_retention(self, days: int) -> TenantConfig:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "UPDATE ai_tenant_config SET retention_days = %s WHERE singleton"
                " RETURNING retention_days, key_provider, key_model, key_last4, key_updated_at", (check_retention(days),),
            )).fetchone()
        return _config_of(row)

    async def set_key(self, provider: str, model: str, api_key: str, keyring: Keyring | None) -> TenantConfig:
        if keyring is None:
            raise KeyUnavailable("ai_key_unavailable")
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "UPDATE ai_tenant_config SET key_provider = %s, key_model = %s,"
                " key_ciphertext = pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), key_id = %s, key_last4 = %s, key_updated_at = now()"
                " WHERE singleton"
                " RETURNING retention_days, key_provider, key_model, key_last4, key_updated_at",
                (provider, model, api_key, keyring.secret(keyring.current_id), keyring.current_id, api_key[-LAST_CHARACTERS:]),
            )).fetchone()
        return _config_of(row)

    async def clear_key(self) -> TenantConfig:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "UPDATE ai_tenant_config SET key_provider = NULL, key_model = NULL, key_ciphertext = NULL, key_id = NULL,"
                " key_last4 = NULL, key_updated_at = NULL WHERE singleton"
                " RETURNING retention_days, key_provider, key_model, key_last4, key_updated_at",
            )).fetchone()
        return _config_of(row)

    async def load_key(self, keyring: Keyring | None) -> TenantKey | None:
        """The key as one read: its id and ciphertext come from the same row version, so a rotation or a new key
        written meanwhile cannot pair one key's ciphertext with another's secret."""
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT key_provider, key_model, key_id, key_updated_at, key_ciphertext FROM ai_tenant_config"
                " WHERE singleton AND key_ciphertext IS NOT NULL",
            )).fetchone()
            if row is None:
                return None
            provider, model, key_id, updated_at, ciphertext = row
            if keyring is None:
                raise KeyUnavailable("ai_key_unavailable")
            decrypted = await (await conn.execute("SELECT pgp_sym_decrypt(%s::bytea, %s)", (ciphertext, keyring.secret(key_id)))).fetchone()
        return TenantKey(provider, model, decrypted[0], updated_at)

    async def rotate(self, keyring: Keyring) -> bool:
        """Re-encrypt the key under the current secret; False when there is none or it already uses it."""
        async with self.pool.connection() as conn, conn.transaction():
            row = await (await conn.execute(
                "SELECT key_id FROM ai_tenant_config WHERE singleton AND key_ciphertext IS NOT NULL FOR UPDATE",
            )).fetchone()
            if row is None or row[0] == keyring.current_id:
                return False
            await conn.execute(
                "UPDATE ai_tenant_config SET key_ciphertext = pgp_sym_encrypt(pgp_sym_decrypt(key_ciphertext, %s), %s, 'cipher-algo=aes256'),"
                " key_id = %s WHERE singleton",
                (keyring.secret(row[0]), keyring.secret(keyring.current_id), keyring.current_id),
            )
        return True


def _config_of(row) -> TenantConfig:
    retention_days, provider, model, last4, updated_at = row
    key = KeyStatus(True, provider, model, last4, updated_at) if provider is not None else KeyStatus(configured=False)
    return TenantConfig(retention_days, key)


async def rotate_all() -> tuple[int, list[str]]:
    """Re-encrypt every served tenant's key under the current secret: ``(rotated count, failed tenant databases)``."""
    import os

    from liwan_ai_service.cleanup import open_tenant_states
    from liwan_ai_service.settings import CleanupSettings

    keyring = Keyring.from_env(os.environ)
    if keyring is None:
        raise KeyUnavailable("ai_key_unavailable")
    states = open_tenant_states(CleanupSettings.from_env(os.environ).database_url)
    rotated, failures = 0, []

    def unavailable(database: str, error: Exception) -> None:
        failures.append(database)
        print(f"rotation failed for {database}: {type(error).__name__}", file=sys.stderr)

    try:
        async with contextlib.aclosing(states.each(on_unavailable=unavailable)) as sweep:
            async for state in sweep:
                try:
                    rotated += await state.config.rotate(keyring)
                except Exception as error:  # noqa: BLE001 - one tenant's failure is reported and stops no other
                    unavailable(state.database, error)
    finally:
        await states.aclose()
    return rotated, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LiwanOS AI tenant configuration operations")
    parser.add_argument("--rotate", action="store_true", help="re-encrypt every tenant key under AI_KEY_ENCRYPTION_KEY_ID")
    args = parser.parse_args(argv)
    if not args.rotate:
        parser.print_help()
        return 2
    rotated, failures = asyncio.run(rotate_all())
    print(f"re-encrypted {rotated} tenant keys; {len(failures)} tenants failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
