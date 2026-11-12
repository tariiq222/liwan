"""Runs only with AI_TEST_DATABASE_URL: the knowledge queue and index on a bootstrapped schema (pgvector must be installed)."""
import json
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg_pool import AsyncConnectionPool

from liwan_ai_service.control import StateCompatibilityError
from liwan_ai_service.knowledge import (
    DRAIN_BATCH,
    QUEUE_MAX_AGE_HOURS,
    PgvectorMissing,
    PostgresKnowledgeStore,
    QueueRow,
    current_upserts,
    vector_literal,
)
from liwan_ai_service.store import initialize_tenant, validate_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs AI_TEST_DATABASE_URL")

VECTORS = {"alpha": [1.0, 0.0, 0.0], "beta": [0.0, 1.0, 0.0], "gamma": [0.0, 0.0, 1.0]}


class RejectedInputError(Exception):  # stands for an SDK's HTTP status error
    def __init__(self, status_code) -> None:
        super().__init__("provider said no")
        self.status_code = status_code


class FakeEmbedder:
    """Each text is the unit vector its word names; a text that is none of them is a constant vector.

    A text in ``poison`` makes any call that carries it fail with ``poison_error``.
    """

    def __init__(self, model_id="fake:1", fail=False, on_embed=None, poison=(), poison_error=None) -> None:
        self.model_id, self.fail, self.on_embed, self.texts = model_id, fail, on_embed, []
        self.poison, self.poison_error, self.calls = set(poison), poison_error or RejectedInputError(400), 0

    async def query(self, text):
        return VECTORS[text]

    async def documents(self, texts):
        self.texts += texts
        self.calls += 1
        if self.on_embed:
            await self.on_embed()
        if self.fail:
            msg = "provider down"
            raise ConnectionError(msg)
        if self.poison & set(texts):
            raise self.poison_error
        return [VECTORS.get(text, [0.5, 0.5, 0.5]) for text in texts]


@pytest.fixture
async def pool():
    base = os.environ["AI_TEST_DATABASE_URL"]
    schema = f"tkn_{uuid4().hex[:12]}"
    admin = await psycopg.AsyncConnection.connect(base, autocommit=True)
    await admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    conninfo = make_conninfo(base, options=f"-c search_path={schema}")
    await initialize_tenant(conninfo)
    await initialize_tenant(conninfo)  # a finished schema is only validated
    opened = AsyncConnectionPool(conninfo, min_size=1, max_size=4, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await opened.open()
    try:
        yield opened
    finally:
        await opened.close()
        await admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        await admin.close()


async def queue(pool, kind, model=None, res_id=None, company_id=None, chunks=None):
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO ai_knowledge_queue (kind, model, res_id, company_id, chunks) VALUES (%s, %s, %s, %s, %s)",
            (kind, model, res_id, company_id, json.dumps(chunks) if chunks is not None else None),
        )


async def upsert(pool, res_id, chunks, company_id=1, model="project.task"):
    await queue(pool, "upsert", model, res_id, company_id, chunks)


async def count(pool, table):
    async with pool.connection() as conn:
        return (await (await conn.execute(f"SELECT count(*) FROM {table}")).fetchone())[0]  # noqa: S608 - a fixed table name of this test


async def indexed(pool):
    async with pool.connection() as conn:
        return await (await conn.execute("SELECT model, res_id, chunk_no, company_id, embed_model FROM ai_knowledge_chunk ORDER BY 1, 2, 3")).fetchall()


async def test_the_queue_accepts_only_the_documented_shapes(pool):
    good = [("upsert", "project.task", 1, 1, ["a", "x" * 2000]), ("upsert", "crm.lead", 2, 1, ["a"] * 20),
            ("delete", "project.task", 1, None, None), ("delete", "project.task", 1, 1, None), ("reset", None, None, None, None)]
    for kind, model, res_id, company_id, chunks in good:
        await queue(pool, kind, model, res_id, company_id, chunks)
    bad = [
        ("upsert", "project.task", 1, 1, []), ("upsert", "project.task", 1, 1, ["a"] * 21), ("upsert", "project.task", 1, 1, [""]),
        ("upsert", "project.task", 1, 1, ["x" * 2001]), ("upsert", "project.task", 1, 1, [1]), ("upsert", "project.task", 1, 1, {"a": "b"}),
        ("upsert", "project.task", 1, 1, "text"), ("upsert", "project.task", 1, 1, None), ("upsert", None, 1, 1, ["a"]),
        ("upsert", "project.task", None, 1, ["a"]), ("upsert", "project.task", 1, None, ["a"]),
        ("delete", None, 1, None, None), ("delete", "project.task", None, None, None), ("delete", "project.task", 1, None, ["a"]),
        ("reset", "project.task", None, None, None), ("reset", None, 1, None, None), ("reset", None, None, None, ["a"]),
        ("purge", None, None, None, None),
    ]
    for row in bad:
        with pytest.raises(psycopg.errors.CheckViolation):
            await queue(pool, *row)
    assert await count(pool, "ai_knowledge_queue") == len(good)


async def test_a_tenant_missing_the_knowledge_tables_fails_readiness_like_missing_memory(pool):
    async with pool.connection() as conn:
        await validate_tenant(conn, (await (await conn.execute("SELECT checkpoint_version FROM ai_tenant_schema")).fetchone())[0])
        await conn.execute("DROP TABLE ai_knowledge_chunk")
        with pytest.raises(StateCompatibilityError, match="ai_state_incompatible"):
            await validate_tenant(conn, 0)


async def test_a_drain_indexes_in_order_and_empties_the_queue(pool):
    store, embedder = PostgresKnowledgeStore(pool), FakeEmbedder()
    assert (await store.drain(embedder)).applied == 0  # an empty queue calls no provider
    assert embedder.texts == []
    await upsert(pool, 1, ["alpha", "beta"])
    await upsert(pool, 2, ["gamma"], company_id=2)
    assert (await store.drain(embedder)).applied == 2
    assert await count(pool, "ai_knowledge_queue") == 0
    assert await indexed(pool) == [("project.task", 1, 0, 1, "fake:1"), ("project.task", 1, 1, 1, "fake:1"), ("project.task", 2, 0, 2, "fake:1")]
    await upsert(pool, 1, ["gamma"])  # a new version replaces every chunk of the record
    await queue(pool, "delete", "project.task", 2)
    await store.drain(embedder)
    assert await indexed(pool) == [("project.task", 1, 0, 1, "fake:1")]


async def test_a_later_row_supersedes_an_earlier_one_in_the_same_batch(pool):
    store, embedder = PostgresKnowledgeStore(pool), FakeEmbedder()
    await upsert(pool, 1, ["alpha"])
    await queue(pool, "reset")
    await upsert(pool, 2, ["beta"])
    await upsert(pool, 3, ["gamma"])
    await queue(pool, "delete", "project.task", 3)
    await upsert(pool, 2, ["gamma", "gamma"])
    assert (await store.drain(embedder)).applied == 6
    assert embedder.texts == ["gamma", "gamma"]  # only the version that survives is embedded
    assert [(row[1], row[2]) for row in await indexed(pool)] == [(2, 0), (2, 1)]


async def test_a_reset_clears_the_index_and_later_rows_rebuild_it(pool):
    store, embedder = PostgresKnowledgeStore(pool), FakeEmbedder()
    await upsert(pool, 1, ["alpha"])
    await store.drain(embedder)
    await queue(pool, "reset")
    await store.drain(embedder)
    assert await indexed(pool) == []
    await upsert(pool, 1, ["alpha"])
    await store.drain(embedder)
    assert len(await indexed(pool)) == 1


async def test_an_embedding_failure_rolls_back_leaves_the_queue_and_the_next_tick_retries(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await store.drain(FakeEmbedder())
    await upsert(pool, 1, ["beta"])
    await queue(pool, "delete", "project.task", 9)
    with pytest.raises(ConnectionError):
        await store.drain(FakeEmbedder(fail=True))
    assert await count(pool, "ai_knowledge_queue") == 2
    assert await store.search(1, VECTORS["alpha"], "fake:1", 1) == [{"model": "project.task", "res_id": 1, "chunk_no": 0}]
    assert (await store.drain(FakeEmbedder())).applied == 2
    assert await count(pool, "ai_knowledge_queue") == 0


async def test_a_batch_that_another_drain_already_took_applies_nothing(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])

    async def other_drain_took_it():
        await queue_gone(pool)

    embedder = FakeEmbedder(on_embed=other_drain_took_it)
    assert (await store.drain(embedder)).applied == 0
    assert await indexed(pool) == []


async def queue_gone(pool):
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM ai_knowledge_queue")


async def test_a_drain_takes_at_most_one_batch_in_id_order(pool):
    store, embedder = PostgresKnowledgeStore(pool), FakeEmbedder()
    for res_id in range(DRAIN_BATCH + 5):
        await upsert(pool, res_id, ["alpha"])
    assert (await store.drain(embedder)).applied == DRAIN_BATCH
    assert await count(pool, "ai_knowledge_queue") == 5
    assert (await store.drain(embedder)).applied == 5
    assert await count(pool, "ai_knowledge_chunk") == DRAIN_BATCH + 5


async def test_a_search_is_ordered_by_cosine_distance_and_stays_in_its_company_and_embed_model(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha", "beta"])
    await upsert(pool, 2, ["gamma"])
    await upsert(pool, 3, ["alpha"], company_id=2)  # another company's record is never a candidate
    await upsert(pool, 4, ["alpha"], model="crm.lead")
    await store.drain(FakeEmbedder())
    refs = await store.search(1, VECTORS["alpha"], "fake:1")
    assert [(ref["model"], ref["res_id"], ref["chunk_no"]) for ref in refs] == [  # equal distances fall back to the reference order
        ("crm.lead", 4, 0), ("project.task", 1, 0), ("project.task", 1, 1), ("project.task", 2, 0),
    ]
    assert [ref["res_id"] for ref in await store.search(1, VECTORS["gamma"], "fake:1", 1)] == [2]
    assert await store.search(2, VECTORS["alpha"], "fake:1") == [{"model": "project.task", "res_id": 3, "chunk_no": 0}]
    assert await store.search(3, VECTORS["alpha"], "fake:1") == []
    assert await store.search(1, VECTORS["alpha"], "another:model") == []  # vectors of another model are another space
    assert await store.search(1, [1.0, 0.0], "fake:1") == []  # and a vector of another size is never compared


async def test_a_new_embedding_model_is_searched_apart_until_the_index_is_rebuilt(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await store.drain(FakeEmbedder("fake:1"))
    await upsert(pool, 1, ["alpha"])
    await store.drain(FakeEmbedder("fake:2"))  # re-queued records move to the new model
    assert await store.search(1, VECTORS["alpha"], "fake:1") == []
    assert len(await store.search(1, VECTORS["alpha"], "fake:2")) == 1


def test_only_the_upserts_that_still_matter_are_current():
    def row(id, kind, res_id=None):
        return QueueRow(id, kind, "m" if kind != "reset" else None, res_id, 1, ["a"] if kind == "upsert" else None)

    rows = [row(1, "upsert", 1), row(2, "upsert", 1), row(3, "reset"), row(4, "upsert", 2), row(5, "delete", 2), row(6, "upsert", 3)]
    assert current_upserts(rows) == [5]
    assert vector_literal([1, 0.5, 1e-07]) == "[1.0,0.5,1e-07]"


async def test_the_database_owner_may_append_to_the_queue_and_nothing_else(pool):
    """Odoo's role is the database owner: it gets INSERT and the sequence, never a read, and the shape checks still run for it."""
    role = f"tkn_owner_{uuid4().hex[:10]}"
    admin = await psycopg.AsyncConnection.connect(os.environ["AI_TEST_DATABASE_URL"], autocommit=True)
    if not (await (await admin.execute("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).fetchone())[0]:
        await admin.close()
        pytest.skip("changing the database owner needs a superuser AI_TEST_DATABASE_URL")
    try:
        await admin.execute(sql.SQL("CREATE ROLE {}").format(sql.Identifier(role)))
        await admin.execute(sql.SQL("ALTER DATABASE {} OWNER TO {}").format(sql.Identifier(await _database(admin)), sql.Identifier(role)))
        async with pool.connection() as conn:  # the grant runs on every bootstrap: a new owner is covered by the next one
            from liwan_ai_service.knowledge import grant_knowledge_queue

            await grant_knowledge_queue(conn)
            schema = (await (await conn.execute("SELECT current_schema()")).fetchone())[0]
        privileges = (await (await admin.execute(
            "SELECT has_table_privilege(%(r)s, %(q)s, 'INSERT'), has_table_privilege(%(r)s, %(q)s, 'SELECT'),"
            " has_table_privilege(%(r)s, %(q)s, 'DELETE'), has_table_privilege(%(r)s, %(c)s, 'INSERT'),"
            " has_sequence_privilege(%(r)s, %(s)s, 'USAGE')",
            {"r": role, "q": f"{schema}.ai_knowledge_queue", "c": f"{schema}.ai_knowledge_chunk", "s": f"{schema}.ai_knowledge_queue_id_seq"},
        )).fetchone())
        assert privileges == (True, False, False, False, True)
        await admin.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
        insert = sql.SQL("INSERT INTO {}.ai_knowledge_queue (kind, model, res_id, company_id, chunks) VALUES ('upsert', 'm', 1, 1, {})")
        await admin.execute(insert.format(sql.Identifier(schema), sql.Literal('["text"]')))
        with pytest.raises(psycopg.errors.CheckViolation):
            await admin.execute(insert.format(sql.Identifier(schema), sql.Literal("[]")))
    finally:
        await admin.execute("RESET ROLE")
        await admin.execute(sql.SQL("ALTER DATABASE {} OWNER TO CURRENT_USER").format(sql.Identifier(await _database(admin))))
        await admin.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
        await admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
        await admin.close()


async def _database(conn) -> str:
    return (await (await conn.execute("SELECT current_database()")).fetchone())[0]


async def test_a_database_without_pgvector_is_refused_clearly_before_any_ddl():
    """The AI role cannot create the extension, so bootstrap and readiness only check that the type is reachable."""
    base = os.environ["AI_TEST_DATABASE_URL"]
    name = f"tkn_novec_{uuid4().hex[:10]}"
    admin = await psycopg.AsyncConnection.connect(base, autocommit=True)
    try:
        await admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
        conninfo = make_conninfo(base, dbname=name)
        with pytest.raises(PgvectorMissing, match="pgvector"):
            await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(conninfo, autocommit=True) as conn:
            assert (await (await conn.execute("SELECT to_regclass('ai_runs')")).fetchone())[0] is None  # nothing was created
    finally:
        await admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))
        await admin.close()


async def test_the_purge_deletes_rows_past_the_age_limit_and_only_those(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO ai_knowledge_queue (kind, model, res_id, company_id, chunks, created_at)"
            " VALUES ('upsert', 'm', 2, 1, '[\"old\"]', now() - make_interval(hours => %s)),"
            " ('reset', NULL, NULL, NULL, NULL, now() - make_interval(hours => %s))",
            (QUEUE_MAX_AGE_HOURS + 1, QUEUE_MAX_AGE_HOURS + 5),
        )
        await conn.execute("INSERT INTO ai_knowledge_queue (kind, model, res_id, created_at) VALUES ('delete', 'm', 3, now() - make_interval(hours => %s))",
                           (QUEUE_MAX_AGE_HOURS - 1,))
    assert await store.purge_expired() == 2
    assert await count(pool, "ai_knowledge_queue") == 2  # the fresh upsert and the delete 23 hours old stay
    assert await store.purge_expired() == 0


async def test_a_record_the_provider_refuses_is_dropped_and_the_rest_of_the_batch_is_indexed(pool, caplog):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await store.drain(FakeEmbedder())  # an older version of the record that will turn poisonous
    await upsert(pool, 1, ["bad"])
    await upsert(pool, 2, ["beta"])
    await upsert(pool, 3, ["gamma"])
    embedder = FakeEmbedder(poison={"bad"})
    drained = await store.drain(embedder)
    assert (drained.applied, drained.dropped) == (3, 1)
    assert await count(pool, "ai_knowledge_queue") == 0
    assert [row[1] for row in await indexed(pool)] == [2, 3]  # the refused record's old chunks are gone too
    assert "row" in caplog.text and "project.task" in caplog.text and "bad" not in caplog.text  # id and model, never the text


async def test_a_single_refused_row_is_dropped_even_when_it_is_the_whole_batch(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["bad"])
    drained = await store.drain(FakeEmbedder(poison={"bad"}, poison_error=RejectedInputError(413)))
    assert (drained.applied, drained.dropped) == (1, 1) and await count(pool, "ai_knowledge_queue") == 0


@pytest.mark.parametrize("error", [ConnectionError("down"), TimeoutError(), RejectedInputError(401), RejectedInputError(403), RejectedInputError(404), RejectedInputError(408),
                                   RejectedInputError(429), RejectedInputError(500), RejectedInputError(502), RejectedInputError(503), RejectedInputError(504)])
async def test_a_failure_that_says_nothing_about_a_row_leaves_the_whole_batch_queued(pool, error):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await upsert(pool, 2, ["bad"])
    embedder = FakeEmbedder(poison={"bad"}, poison_error=error)
    with pytest.raises(type(error)):
        await store.drain(embedder)
    assert embedder.calls == 1  # no row-by-row retry against a provider that is down or refusing everything
    assert await count(pool, "ai_knowledge_queue") == 2 and await indexed(pool) == []


async def test_a_provider_refusing_every_row_is_not_mistaken_for_every_record_being_bad(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["bad"])
    await upsert(pool, 2, ["bad"])
    with pytest.raises(RejectedInputError):
        await store.drain(FakeEmbedder(poison={"bad"}))
    assert await count(pool, "ai_knowledge_queue") == 2


async def test_a_provider_going_down_during_the_row_by_row_retry_leaves_the_batch_queued(pool):
    class DownOnRetry(FakeEmbedder):
        async def documents(self, texts):
            if len(texts) == 1:
                raise ConnectionError("down")
            return await super().documents(texts)

    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await upsert(pool, 2, ["bad"])
    with pytest.raises(ConnectionError):
        await store.drain(DownOnRetry(poison={"bad"}))
    assert await count(pool, "ai_knowledge_queue") == 2


@pytest.mark.parametrize("status", [400, 413, 422])
async def test_only_the_input_statuses_start_the_row_by_row_retry(pool, status):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await upsert(pool, 2, ["bad"])
    drained = await store.drain(FakeEmbedder(poison={"bad"}, poison_error=RejectedInputError(status)))
    assert (drained.applied, drained.dropped) == (2, 1) and len(await indexed(pool)) == 1


async def test_a_reset_voids_everything_before_it_without_any_text_reaching_the_provider(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 999, ["alpha"])
    await store.drain(FakeEmbedder())  # an index to wipe
    assert len(await indexed(pool)) == 1
    for res_id in range(DRAIN_BATCH + 50):  # more than one batch precedes the reset
        await upsert(pool, res_id, ["alpha"])
    await queue(pool, "reset")
    embedder = FakeEmbedder(fail=True)  # and the provider is down: it must not even be asked
    drained = await store.drain(embedder)
    assert embedder.calls == 0 and embedder.texts == []
    assert drained.applied == DRAIN_BATCH + 51
    assert await count(pool, "ai_knowledge_queue") == 0 and await indexed(pool) == []


async def test_rows_queued_after_the_newest_reset_are_still_indexed(pool):
    store = PostgresKnowledgeStore(pool)
    await upsert(pool, 1, ["alpha"])
    await queue(pool, "reset")
    await upsert(pool, 2, ["beta"])
    await queue(pool, "reset")
    await upsert(pool, 3, ["gamma"])
    embedder = FakeEmbedder()
    drained = await store.drain(embedder)
    assert embedder.texts == ["gamma"] and drained.applied == 5  # the first reset and what it voided never reach the provider
    assert [row[1] for row in await indexed(pool)] == [3] and await count(pool, "ai_knowledge_queue") == 0
