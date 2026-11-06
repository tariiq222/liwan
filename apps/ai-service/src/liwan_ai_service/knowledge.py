"""The knowledge index in the tenant's schema ``liwan_ai`` (spec 2026-11-04 §6.3).

The index holds vectors and references (``model``, ``res_id``, ``company_id``, ``chunk_no``), never record text. Odoo cannot
reach the service, so it feeds ``ai_knowledge_queue`` (INSERT only, like ``ai_outbox``) with the chunk text of changed
records; the service drains the queue in order, embeds the text and replaces the record's rows in ``ai_knowledge_chunk``.
A queue row lives until it is indexed or, at the latest, ``QUEUE_MAX_AGE_HOURS``: every tick deletes older rows whether or
not an embedder is configured, so record text never rests in the service.

Chunk numbers are the 0-based positions in the queued ``chunks`` array. A search returns only references: Odoo rebuilds the
text of a candidate it may read, and drops the rest.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

from psycopg import Rollback

from liwan_ai_service.control import StateCompatibilityError
from liwan_ai_service.embeddings import Embedder

QUEUE_KINDS = ("upsert", "delete", "reset")
DRAIN_BATCH = 100
QUEUE_MAX_AGE_HOURS = 24  # the longest a row of chunk text may wait in the queue
# A provider answering with one of these cannot say anything about a single row (bad key, unknown model, throttled, timed
# out); any other HTTP status is the provider rejecting that input.
PROVIDER_WIDE_STATUS = frozenset({401, 403, 404, 408, 429})
log = logging.getLogger("liwan_ai_service")
SEARCH_LIMIT = 40  # candidates a search returns: Odoo resolves at most 8 readable ones from them

CREATE_KNOWLEDGE = (
    # A CHECK cannot hold a subquery, so the shape of the chunk array (1 to 20 strings of 1 to 2000 characters, the
    # limits of Odoo's chunker) is one immutable function. Odoo's insert of a malformed row fails; nothing is dropped.
    """
CREATE OR REPLACE FUNCTION ai_knowledge_chunks_ok(chunks jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $check$
SELECT CASE WHEN jsonb_typeof(chunks) = 'array' THEN
    jsonb_array_length(chunks) BETWEEN 1 AND 20
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(chunks) AS chunk
                    WHERE jsonb_typeof(chunk) <> 'string' OR char_length(chunk #>> '{}') NOT BETWEEN 1 AND 2000)
ELSE false END
$check$
""",
    # Written by Odoo's database role (INSERT only, granted below); drained by the service, which deletes what it indexed.
    "CREATE TABLE IF NOT EXISTS ai_knowledge_queue (id BIGSERIAL PRIMARY KEY,"
    " kind TEXT NOT NULL CHECK (kind IN ('upsert', 'delete', 'reset')),"
    " model TEXT, res_id BIGINT, company_id BIGINT, chunks JSONB,"
    " created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
    " CHECK (kind <> 'reset' OR (model IS NULL AND res_id IS NULL AND chunks IS NULL)),"
    " CHECK (kind <> 'delete' OR (model IS NOT NULL AND res_id IS NOT NULL AND chunks IS NULL)),"
    " CHECK (kind <> 'upsert' OR (model IS NOT NULL AND res_id IS NOT NULL AND company_id IS NOT NULL"
    " AND chunks IS NOT NULL AND ai_knowledge_chunks_ok(chunks))))",
    # No fixed dimension: a search compares only rows of one embed_model (an exact scan; a tenant's index is small).
    "CREATE TABLE IF NOT EXISTS ai_knowledge_chunk (model TEXT NOT NULL, res_id BIGINT NOT NULL, company_id BIGINT NOT NULL,"
    " chunk_no INTEGER NOT NULL CHECK (chunk_no >= 0), embed_model TEXT NOT NULL, embedding vector NOT NULL,"
    " PRIMARY KEY (model, res_id, chunk_no))",
    "CREATE INDEX IF NOT EXISTS ai_knowledge_chunk_company ON ai_knowledge_chunk (company_id)",
)
# The database owner is Odoo's role: it may append to the queue and nothing else in this schema.
GRANT_KNOWLEDGE_QUEUE = """
DO $grant$
DECLARE
    owner_role TEXT := (SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname = current_database());
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', current_schema(), owner_role);
    EXECUTE format('GRANT INSERT ON %I.ai_knowledge_queue TO %I', current_schema(), owner_role);
    EXECUTE format('GRANT USAGE ON SEQUENCE %I.ai_knowledge_queue_id_seq TO %I', current_schema(), owner_role);
END
$grant$
"""
KNOWLEDGE_TABLES = ("ai_knowledge_queue", "ai_knowledge_chunk")


class PgvectorMissing(StateCompatibilityError):
    """The ``vector`` type is not visible in the AI schema: the operator script (deploy/ai/tenant_schema.sql) installs it."""


async def require_vector(conn) -> None:
    """Refuses a tenant database whose ``liwan_ai`` schema cannot reach pgvector.

    The extension is not trusted, so only the superuser operator step creates it; the AI role never runs ``CREATE EXTENSION``.
    """
    if (await (await conn.execute("SELECT to_regtype('vector')")).fetchone())[0] is None:
        msg = "ai_state_incompatible: the pgvector extension is not installed in schema liwan_ai (run deploy/ai/tenant_schema.sql)"
        raise PgvectorMissing(msg)


async def grant_knowledge_queue(conn) -> None:
    """Lets the database owner (Odoo) append to the queue; the AI role keeps ownership of everything."""
    await conn.execute(GRANT_KNOWLEDGE_QUEUE)


def rejects_the_input(error: Exception) -> bool:
    """Whether the provider refused this text itself, as opposed to being unreachable or refusing every request.

    Only an HTTP status answers that (the OpenAI and Ollama clients both carry ``status_code``): a connection error, a
    timeout or an error of unknown origin has none, and a bad key, an unknown model or a throttle is not about one row.
    Those must never cost a record, so the batch stays queued and the next tick retries.
    """
    status = getattr(error, "status_code", None)
    return status is not None and status not in PROVIDER_WIDE_STATUS


async def embed_all(embedder: Embedder, texts: list[str]) -> list[list[float]]:
    """One vector per text, or an error: a provider that answers with another count is not trusted with the index."""
    vectors = await embedder.documents(texts) if texts else []
    if len(vectors) != len(texts):
        msg = "the embedder returned a different number of vectors than texts"
        raise ValueError(msg)
    return vectors


def vector_literal(values: list[float]) -> str:
    """A vector as pgvector's text form, passed as a parameter and cast in SQL."""
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


@dataclass(frozen=True)
class QueueRow:
    id: int
    kind: str
    model: str | None
    res_id: int | None
    company_id: int | None
    chunks: list[str] | None


def current_upserts(rows: list[QueueRow]) -> list[int]:
    """The positions of the upserts that still matter: a later change to the same record, or any reset, supersedes one."""
    last_reset = max((index for index, row in enumerate(rows) if row.kind == "reset"), default=-1)
    last_of = {(row.model, row.res_id): index for index, row in enumerate(rows) if row.kind != "reset"}
    return [index for index, row in enumerate(rows) if row.kind == "upsert" and index > last_reset and last_of[(row.model, row.res_id)] == index]


@dataclass(frozen=True)
class Drained:
    applied: int = 0  # queue rows taken off the queue
    dropped: int = 0  # of those, upserts the provider refused and that were deleted without being indexed


class KnowledgeStore(Protocol):
    async def search(self, company_id: int, query_vector: list[float], embed_model: str, limit: int = SEARCH_LIMIT) -> list[dict[str, Any]]: ...
    async def drain(self, embedder: Embedder) -> Drained: ...
    async def purge_expired(self) -> int: ...


class PostgresKnowledgeStore:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def search(self, company_id: int, query_vector: list[float], embed_model: str, limit: int = SEARCH_LIMIT) -> list[dict[str, Any]]:
        """The ``limit`` chunks of one company nearest (cosine) to ``query_vector``, among those indexed by ``embed_model``."""
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT model, res_id, chunk_no FROM ai_knowledge_chunk"
                " WHERE company_id = %s AND embed_model = %s AND vector_dims(embedding) = %s"
                " ORDER BY embedding <=> %s::vector, model, res_id, chunk_no LIMIT %s",
                (company_id, embed_model, len(query_vector), vector_literal(query_vector), limit),
            )).fetchall()
        return [{"model": model, "res_id": res_id, "chunk_no": chunk_no} for model, res_id, chunk_no in rows]

    async def purge_expired(self) -> int:
        """Delete the rows queued more than ``QUEUE_MAX_AGE_HOURS`` ago, indexed or not; returns how many."""
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                "DELETE FROM ai_knowledge_queue WHERE created_at < now() - make_interval(hours => %s) RETURNING id", (QUEUE_MAX_AGE_HOURS,),
            )).fetchall()
        return len(rows)

    async def drain(self, embedder: Embedder) -> Drained:
        """Index the oldest ``DRAIN_BATCH`` queue rows, in the order Odoo wrote them.

        The text is embedded with no transaction open. The rows are then deleted and the index changed in one
        transaction under the queue's advisory lock, so a failure leaves the queue untouched and the next tick retries.
        A concurrent drain (another generation) that already took some of the rows makes this one apply nothing.
        """
        async with self.pool.connection() as conn:
            fetched = await (await conn.execute(
                "SELECT id, kind, model, res_id, company_id, chunks FROM ai_knowledge_queue ORDER BY id LIMIT %s", (DRAIN_BATCH,),
            )).fetchall()
        rows = [QueueRow(*row) for row in fetched]
        if not rows:
            return Drained()
        embedded, dropped = await self._embed(embedder, rows, current_upserts(rows))
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('ai_knowledge_queue'))")
            ids = [row.id for row in rows]
            gone = await (await conn.execute("DELETE FROM ai_knowledge_queue WHERE id = ANY(%s) RETURNING id", (ids,))).fetchall()
            if len(gone) != len(rows):
                raise Rollback  # another drain applied part of this batch meanwhile: the rest is read again next tick
            for index, row in enumerate(rows):
                await self._apply(conn, row, embedded.get(index), embedder.model_id)
            return Drained(len(rows), dropped)
        return Drained()

    @staticmethod
    async def _embed(embedder: Embedder, rows: list[QueueRow], current: list[int]) -> tuple[dict[int, list[str]], int]:
        """The vector literals of each current upsert, and how many upserts the provider refused.

        The whole batch goes in one call. If the provider rejects it, each row is embedded alone: one that the provider
        refuses by itself is dropped (logged by id and model, never its text) and its old chunks go with it, so a single
        bad record cannot stall the tenant. A failure that says nothing about the row (see ``rejects_the_input``) leaves
        the batch queued. When no row of a batch of several embeds, the provider is refusing everything, not one record:
        that leaves the batch queued too.
        """
        texts = [chunk for index in current for chunk in rows[index].chunks]
        try:
            vectors = await embed_all(embedder, texts)
        except Exception as error:
            if not rejects_the_input(error):
                raise
            log.warning("knowledge batch rejected by the embedder (%s); embedding its rows one by one", type(error).__name__)
        else:
            vector_of = iter(vectors)
            return {index: [vector_literal(next(vector_of)) for _chunk in rows[index].chunks] for index in current}, 0
        embedded: dict[int, list[str]] = {}
        refused: list[int] = []
        for index in current:
            try:
                vectors = await embed_all(embedder, rows[index].chunks)
            except Exception as error:
                if not rejects_the_input(error):
                    raise
                row = rows[index]
                log.warning("knowledge row %s (%s) was refused by the embedder (%s) and is dropped", row.id, row.model, type(error).__name__)
                refused.append(index)
                last = error
            else:
                embedded[index] = [vector_literal(vector) for vector in vectors]
        if refused and not embedded and len(current) > 1:
            raise last
        return {**embedded, **dict.fromkeys(refused, [])}, len(refused)

    @staticmethod
    async def _apply(conn, row: QueueRow, vectors: list[str] | None, embed_model: str) -> None:
        """One queue row's change to the index; ``vectors`` are those of a current upsert (None for a superseded one)."""
        if row.kind == "reset":
            await conn.execute("DELETE FROM ai_knowledge_chunk")
        elif row.kind == "delete" or vectors is not None:
            await conn.execute("DELETE FROM ai_knowledge_chunk WHERE model = %s AND res_id = %s", (row.model, row.res_id))
        if vectors is None:
            return
        chunks = [(row.model, row.res_id, row.company_id, number, embed_model, vector) for number, vector in enumerate(vectors)]
        if not vectors:
            return  # a record the provider refused: its old chunks are gone and there is nothing to index
        async with conn.cursor() as cursor:
            await cursor.executemany(
                "INSERT INTO ai_knowledge_chunk (model, res_id, company_id, chunk_no, embed_model, embedding)"
                " VALUES (%s, %s, %s, %s, %s, %s::vector)", chunks,
            )
