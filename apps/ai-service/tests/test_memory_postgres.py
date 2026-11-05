"""Runs only with AI_TEST_DATABASE_URL: memory, the offboarding outbox and the leaver sweep on a bootstrapped schema."""
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg_pool import AsyncConnectionPool

from liwan_ai_service.memory import MAX_NOTES, MemoryFull, PostgresMemoryStore
from liwan_ai_service.store import PostgresRunStore, initialize_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs AI_TEST_DATABASE_URL")


@pytest.fixture
async def pool():
    base = os.environ["AI_TEST_DATABASE_URL"]
    schema = f"tmem_{uuid4().hex[:12]}"
    admin = await psycopg.AsyncConnection.connect(base, autocommit=True)
    await admin.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    await admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    conninfo = make_conninfo(base, options=f"-c search_path={schema},public")
    await initialize_tenant(conninfo)
    await initialize_tenant(conninfo)  # re-running the bootstrap on a finished schema is the upgrade path
    opened = AsyncConnectionPool(conninfo, min_size=1, max_size=3, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await opened.open()
    try:
        yield opened
    finally:
        await opened.close()
        await admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        await admin.close()


async def test_notes_follow_the_same_rules_in_postgres(pool):
    store = PostgresMemoryStore(pool)
    for index in range(MAX_NOTES):
        await store.remember("42", f"note {index}")
    with pytest.raises(MemoryFull):
        await store.remember("42", "one too many")
    note = await store.propose("1", "formal tone", "42")
    assert (await store.propose("1", "formal  tone", "43")).id == note.id
    assert (await store.for_prompt("42", "1")).company == []
    assert await store.approve("2", note.id) is None
    await store.approve("1", note.id)
    prompt = await store.for_prompt("42", "1")
    assert len(prompt.user) == MAX_NOTES and prompt.company == ["formal tone"]


async def test_the_outbox_forgets_a_leaver_and_the_sweep_deletes_their_runs(pool):
    store, runs = PostgresMemoryStore(pool), PostgresRunStore(pool)
    await store.remember("42", "likes tables")
    await runs.create("r_leaver", "42")
    async with pool.connection() as conn:
        await conn.execute("INSERT INTO ai_outbox (kind, user_ref, created_at) VALUES ('user_deactivated', '42', now() - interval '40 days')")
        with pytest.raises(psycopg.errors.CheckViolation):
            await conn.execute("INSERT INTO ai_outbox (kind, user_ref) VALUES ('user_deactivated', 'x; drop')")
    assert await store.drain_outbox() == 1
    assert await store.user_notes("42") == []
    assert await store.expired_leavers(30) == ["42"]
    with pytest.raises(ValueError, match="left"):
        await store.remember("42", "after leaving")
    async with pool.connection() as conn:  # a reactivation written after the deactivation is applied after it
        await conn.execute("INSERT INTO ai_outbox (kind, user_ref) VALUES ('user_deactivated', '50'), ('user_reactivated', '50')")
    await store.drain_outbox()
    assert "50" not in await store.expired_leavers(0)
    assert await runs.delete_runs_of("42") == ["r_leaver"]
    await store.mark_swept("42")
    assert await store.expired_leavers(0) == []
    with pytest.raises(ValueError, match="left"):  # still marked until reactivated
        await store.remember("42", "after the sweep")
