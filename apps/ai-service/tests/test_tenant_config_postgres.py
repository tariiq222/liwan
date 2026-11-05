"""Runs only with AI_TEST_DATABASE_URL: the tenant key is stored as pgcrypto ciphertext and rotates between secrets."""
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg_pool import AsyncConnectionPool

from liwan_ai_service.store import initialize_tenant
from liwan_ai_service.tenant_config import Keyring, KeyUnavailable, PostgresTenantConfig

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs AI_TEST_DATABASE_URL")

TENANT_KEY = "sk-tenant-0123456789abcd"
OLD = Keyring({"k1": "a" * 40}, "k1")
NEW = Keyring({"k1": "a" * 40, "k2": "b" * 40}, "k2")


@pytest.fixture
async def config():
    """A bootstrapped tenant schema; pgcrypto is reached through ``public`` here, through ``liwan_ai`` in a deployment."""
    base = os.environ["AI_TEST_DATABASE_URL"]
    schema = f"tcfg_{uuid4().hex[:12]}"
    admin = await psycopg.AsyncConnection.connect(base, autocommit=True)
    await admin.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    await admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    conninfo = make_conninfo(base, options=f"-c search_path={schema},public")
    await initialize_tenant(conninfo, retention_days=14)
    pool = AsyncConnectionPool(conninfo, min_size=1, max_size=2, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await pool.open()
    try:
        yield PostgresTenantConfig(pool), pool
    finally:
        await pool.close()
        await admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        await admin.close()


async def stored(pool):
    async with pool.connection() as conn:
        return await (await conn.execute("SELECT key_ciphertext, key_id, key_last4 FROM ai_tenant_config")).fetchone()


async def test_the_bootstrap_window_and_a_key_stored_only_as_ciphertext(config):
    store, pool = config
    assert (await store.get()).retention_days == 14
    status = (await store.set_key("anthropic", "claude-test", TENANT_KEY, OLD)).key
    assert (status.configured, status.last4) == (True, "abcd")
    ciphertext, key_id, last4 = await stored(pool)
    assert key_id == "k1" and last4 == "abcd" and TENANT_KEY.encode() not in bytes(ciphertext)
    key = await store.load_key(OLD)
    assert (key.provider, key.model, key.api_key) == ("anthropic", "claude-test", TENANT_KEY)


async def test_rotation_moves_the_key_to_the_current_secret(config):
    store, pool = config
    await store.set_key("anthropic", "claude-test", TENANT_KEY, OLD)
    assert await store.rotate(NEW) is True
    assert (await stored(pool))[1] == "k2"
    assert (await store.load_key(Keyring({"k2": "b" * 40}, "k2"))).api_key == TENANT_KEY
    assert await store.rotate(NEW) is False  # already under the current secret


async def test_a_ciphertext_whose_secret_is_gone_is_unavailable_not_garbage(config):
    store, _pool = config
    await store.set_key("anthropic", "claude-test", TENANT_KEY, OLD)
    with pytest.raises(KeyUnavailable):
        await store.load_key(Keyring({"k9": "c" * 40}, "k9"))


async def test_the_key_columns_are_all_set_or_all_empty(config):
    store, pool = config
    async with pool.connection() as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            await conn.execute("UPDATE ai_tenant_config SET key_provider = 'anthropic'")
    assert (await store.clear_key()).key.configured is False
