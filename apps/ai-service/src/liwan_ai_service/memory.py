"""Employee and company memory, and the offboarding outbox, in the tenant's schema ``liwan_ai`` (spec 2026-11-04 §6.4).

Employee notes belong to one user: only they read or delete them, and they are saved without approval. Company notes are
proposed by an agent and reach a prompt only once a settings manager of that company approved them. A note is a short
statement of style or preference, never a copy of a company record.

Odoo cannot reach the service, so it reports a user's deactivation (and a reactivation) through ``ai_outbox``, the one
table its database role may insert into. The service drains it before every run and in the retention sweep: a leaver's
notes are deleted at once, their conversations once ``leaver_retention_days`` have passed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol

MAX_NOTE_CHARS = 300
MAX_NOTES = 20  # per employee, and approved per company: what a prompt may carry
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
Scope = Literal["user", "company"]
Status = Literal["active", "proposed", "approved"]
OUTBOX_KINDS = ("user_deactivated", "user_reactivated")


MAX_PROPOSALS = 20  # pending company notes: an agent cannot flood the manager's review list


class MemoryFull(Exception):  # noqa: N818 - a domain condition the caller reports, not a failure
    """A note cannot be added: the employee's notes, the company's pending proposals or its approved notes are full."""


USER_FULL = "the user's memory is full; they can delete notes on the memory page"
PROPOSALS_FULL = "the company already has the most pending proposals; its manager must review them first"
COMPANY_FULL = f"the company already has {MAX_NOTES} approved notes; delete one before approving another"


def clean_note(text: str) -> str:
    """One note as stored: control characters and runs of spaces collapsed, at most ``MAX_NOTE_CHARS`` characters."""
    note = " ".join(CONTROL.sub(" ", text).split())
    if not note:
        msg = "a note cannot be empty"
        raise ValueError(msg)
    if len(note) > MAX_NOTE_CHARS:
        msg = f"a note is at most {MAX_NOTE_CHARS} characters"
        raise ValueError(msg)
    return note


@dataclass(frozen=True)
class Note:
    id: int
    scope: Scope
    owner: str  # the user ref of an employee note, the company id of a company note
    content: str
    status: Status
    proposed_by: str | None
    created_at: datetime


@dataclass(frozen=True)
class PromptMemory:
    """What one run's prompt carries: the employee's notes and the approved notes of their company."""

    user: list[str] = field(default_factory=list)
    company: list[str] = field(default_factory=list)


class MemoryStore(Protocol):
    async def user_notes(self, user_ref: str) -> list[Note]: ...
    async def remember(self, user_ref: str, content: str) -> Note: ...
    async def forget(self, user_ref: str, note_id: int) -> bool: ...
    async def forget_all(self, user_ref: str) -> int: ...
    async def company_notes(self, company: str) -> list[Note]: ...
    async def propose(self, company: str, content: str, proposed_by: str) -> Note: ...
    async def approve(self, company: str, note_id: int) -> Note | None: ...
    async def discard(self, company: str, note_id: int) -> bool: ...
    async def for_prompt(self, user_ref: str, company: str | None) -> PromptMemory: ...
    async def drain_outbox(self) -> int: ...
    async def expired_leavers(self, days: int) -> list[str]: ...
    async def mark_swept(self, user_ref: str) -> None: ...


class MemoryMemoryStore:
    """Development and tests: the same rules, held in the process."""

    def __init__(self) -> None:
        self.notes: dict[int, Note] = {}
        self.outbox: list[tuple[str, str, datetime]] = []
        self.leavers: dict[str, datetime] = {}
        self.swept: set[str] = set()
        self._next = 1

    def _add(self, scope: Scope, owner: str, content: str, status: Status, proposed_by: str | None = None) -> Note:
        note = Note(self._next, scope, owner, clean_note(content), status, proposed_by, datetime.now(UTC))
        self.notes[note.id] = note
        self._next += 1
        return note

    def _of(self, scope: Scope, owner: str) -> list[Note]:
        return sorted((n for n in self.notes.values() if n.scope == scope and n.owner == owner), key=lambda n: n.id)

    async def user_notes(self, user_ref: str) -> list[Note]:
        return self._of("user", user_ref)

    async def remember(self, user_ref: str, content: str) -> Note:
        if user_ref in self.leavers:
            msg = "this user has left; nothing is remembered"
            raise ValueError(msg)
        if len(self._of("user", user_ref)) >= MAX_NOTES:
            raise MemoryFull(USER_FULL)
        return self._add("user", user_ref, content, "active")

    async def forget(self, user_ref: str, note_id: int) -> bool:
        note = self.notes.get(note_id)
        if note is None or note.scope != "user" or note.owner != user_ref:
            return False
        del self.notes[note_id]
        return True

    async def forget_all(self, user_ref: str) -> int:
        mine = self._of("user", user_ref)
        for note in mine:
            del self.notes[note.id]
        return len(mine)

    async def company_notes(self, company: str) -> list[Note]:
        return self._of("company", company)

    async def propose(self, company: str, content: str, proposed_by: str) -> Note:
        notes = self._of("company", company)
        same = next((n for n in notes if n.content == clean_note(content)), None)
        if same is not None:
            return same  # a repeated proposal is the same note, never a second one to review
        if sum(n.status == "proposed" for n in notes) >= MAX_PROPOSALS:
            raise MemoryFull(PROPOSALS_FULL)
        return self._add("company", company, content, "proposed", proposed_by)

    async def approve(self, company: str, note_id: int) -> Note | None:
        note = self.notes.get(note_id)
        if note is None or note.scope != "company" or note.owner != company:
            return None
        if note.status != "approved" and sum(n.status == "approved" for n in self._of("company", company)) >= MAX_NOTES:
            raise MemoryFull(COMPANY_FULL)
        approved = Note(note.id, note.scope, note.owner, note.content, "approved", note.proposed_by, note.created_at)
        self.notes[note_id] = approved
        return approved

    async def discard(self, company: str, note_id: int) -> bool:
        note = self.notes.get(note_id)
        if note is None or note.scope != "company" or note.owner != company:
            return False
        del self.notes[note_id]
        return True

    async def for_prompt(self, user_ref: str, company: str | None) -> PromptMemory:
        approved = [n.content for n in self._of("company", company or "") if n.status == "approved"]
        return PromptMemory(user=[n.content for n in self._of("user", user_ref)][:MAX_NOTES], company=approved[:MAX_NOTES])

    async def drain_outbox(self) -> int:
        events, self.outbox = self.outbox, []
        for kind, user_ref, at in events:  # in the order they were written
            await self._apply(kind, user_ref, at)
        return len(events)

    async def _apply(self, kind: str, user_ref: str, at: datetime) -> None:
        if kind == "user_deactivated":
            await self.forget_all(user_ref)
            self.leavers.setdefault(user_ref, at)
        else:
            self.leavers.pop(user_ref, None)
            self.swept.discard(user_ref)

    async def expired_leavers(self, days: int) -> list[str]:
        now = datetime.now(UTC)
        return sorted(
            user for user, at in self.leavers.items() if user not in self.swept and (now - at).total_seconds() >= days * 86400
        )

    async def mark_swept(self, user_ref: str) -> None:
        self.swept.add(user_ref)


CREATE_MEMORY = (
    "CREATE TABLE IF NOT EXISTS ai_memory (id BIGSERIAL PRIMARY KEY,"
    " scope TEXT NOT NULL CHECK (scope IN ('user', 'company')), owner TEXT NOT NULL,"
    " content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 300),"  # MAX_NOTE_CHARS
    " status TEXT NOT NULL CHECK (status IN ('active', 'proposed', 'approved')), proposed_by TEXT,"
    " created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
    " CHECK ((scope = 'user') = (status = 'active')), CHECK ((status = 'proposed') = (proposed_by IS NOT NULL) OR status = 'approved'))",
    "CREATE INDEX IF NOT EXISTS ai_memory_scope_owner ON ai_memory (scope, owner, id)",
    # Written by Odoo's database role (INSERT only, granted below); drained by the service.
    "CREATE TABLE IF NOT EXISTS ai_outbox (id BIGSERIAL PRIMARY KEY,"
    " kind TEXT NOT NULL CHECK (kind IN ('user_deactivated', 'user_reactivated')),"
    " user_ref TEXT NOT NULL CHECK (user_ref ~ '^[1-9][0-9]{0,18}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    # A leaver stays marked until reactivated (no note is saved for them meanwhile); ``swept`` once their runs are gone.
    "CREATE TABLE IF NOT EXISTS ai_leavers (user_ref TEXT PRIMARY KEY, deactivated_at TIMESTAMPTZ NOT NULL,"
    " swept BOOLEAN NOT NULL DEFAULT false)",
)
# The database owner is Odoo's role: it may append offboarding events and nothing else in this schema. The role and the
# schema (liwan_ai in a deployment) are read by the server itself, inside one literal statement.
GRANT_OUTBOX = """
DO $grant$
DECLARE
    owner_role TEXT := (SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname = current_database());
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', current_schema(), owner_role);
    EXECUTE format('GRANT INSERT ON %I.ai_outbox TO %I', current_schema(), owner_role);
    EXECUTE format('GRANT USAGE ON SEQUENCE %I.ai_outbox_id_seq TO %I', current_schema(), owner_role);
END
$grant$
"""
MEMORY_TABLES = ("ai_memory", "ai_outbox", "ai_leavers")


async def grant_outbox(conn) -> None:
    """Lets the database owner (Odoo) insert offboarding events; the AI role keeps ownership of everything."""
    await conn.execute(GRANT_OUTBOX)


class PostgresMemoryStore:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def _rows(self, query: str, params: tuple) -> list[Note]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(query, params)).fetchall()
        return [Note(*row) for row in rows]

    async def user_notes(self, user_ref: str) -> list[Note]:
        return await self._rows("SELECT id, scope, owner, content, status, proposed_by, created_at"
            " FROM ai_memory WHERE scope = 'user' AND owner = %s ORDER BY id", (user_ref,))

    async def remember(self, user_ref: str, content: str) -> Note:
        note = clean_note(content)
        async with self.pool.connection() as conn, conn.transaction():
            # One employee's notes are counted under a lock on that employee, so two saves cannot both pass the cap.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('ai_memory:' || %s))", (user_ref,))
            if await (await conn.execute("SELECT 1 FROM ai_leavers WHERE user_ref = %s", (user_ref,))).fetchone():
                msg = "this user has left; nothing is remembered"
                raise ValueError(msg)
            (count,) = await (await conn.execute("SELECT count(*) FROM ai_memory WHERE scope = 'user' AND owner = %s", (user_ref,))).fetchone()
            if count >= MAX_NOTES:
                raise MemoryFull(USER_FULL)
            row = await (await conn.execute(
                "INSERT INTO ai_memory (scope, owner, content, status) VALUES ('user', %s, %s, 'active')"
                " RETURNING id, scope, owner, content, status, proposed_by, created_at",
                (user_ref, note),
            )).fetchone()
        return Note(*row)

    async def forget(self, user_ref: str, note_id: int) -> bool:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "DELETE FROM ai_memory WHERE id = %s AND scope = 'user' AND owner = %s RETURNING id", (note_id, user_ref),
            )).fetchone()
        return row is not None

    async def forget_all(self, user_ref: str) -> int:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute("DELETE FROM ai_memory WHERE scope = 'user' AND owner = %s RETURNING id", (user_ref,))).fetchall()
        return len(rows)

    async def company_notes(self, company: str) -> list[Note]:
        return await self._rows("SELECT id, scope, owner, content, status, proposed_by, created_at"
            " FROM ai_memory WHERE scope = 'company' AND owner = %s ORDER BY id", (company,))

    async def propose(self, company: str, content: str, proposed_by: str) -> Note:
        note = clean_note(content)
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('ai_memory_company:' || %s))", (company,))
            same = await (await conn.execute(
                "SELECT id, scope, owner, content, status, proposed_by, created_at FROM ai_memory"
                " WHERE scope = 'company' AND owner = %s AND content = %s", (company, note),
            )).fetchone()
            if same:
                return Note(*same)
            (pending,) = await (await conn.execute(
                "SELECT count(*) FROM ai_memory WHERE scope = 'company' AND owner = %s AND status = 'proposed'", (company,),
            )).fetchone()
            if pending >= MAX_PROPOSALS:
                raise MemoryFull(PROPOSALS_FULL)
            row = await (await conn.execute(
                "INSERT INTO ai_memory (scope, owner, content, status, proposed_by) VALUES ('company', %s, %s, 'proposed', %s)"
                " RETURNING id, scope, owner, content, status, proposed_by, created_at",
                (company, note, proposed_by),
            )).fetchone()
        return Note(*row)

    async def approve(self, company: str, note_id: int) -> Note | None:
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('ai_memory_company:' || %s))", (company,))
            (approved,) = await (await conn.execute(
                "SELECT count(*) FROM ai_memory WHERE scope = 'company' AND owner = %s AND status = 'approved' AND id <> %s",
                (company, note_id),
            )).fetchone()
            if approved >= MAX_NOTES:
                raise MemoryFull(COMPANY_FULL)
            row = await (await conn.execute(
                "UPDATE ai_memory SET status = 'approved' WHERE id = %s AND scope = 'company' AND owner = %s"
                " RETURNING id, scope, owner, content, status, proposed_by, created_at",
                (note_id, company),
            )).fetchone()
        return Note(*row) if row else None

    async def discard(self, company: str, note_id: int) -> bool:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "DELETE FROM ai_memory WHERE id = %s AND scope = 'company' AND owner = %s RETURNING id", (note_id, company),
            )).fetchone()
        return row is not None

    async def for_prompt(self, user_ref: str, company: str | None) -> PromptMemory:
        async with self.pool.connection() as conn:
            user = await (await conn.execute(
                "SELECT content FROM ai_memory WHERE scope = 'user' AND owner = %s ORDER BY id LIMIT %s", (user_ref, MAX_NOTES),
            )).fetchall()
            approved = await (await conn.execute(
                "SELECT content FROM ai_memory WHERE scope = 'company' AND owner = %s AND status = 'approved' ORDER BY id LIMIT %s",
                (company or "", MAX_NOTES),
            )).fetchall()
        return PromptMemory(user=[row[0] for row in user], company=[row[0] for row in approved])

    async def drain_outbox(self) -> int:
        async with self.pool.connection() as conn, conn.transaction():
            # One drain at a time per tenant: events are applied strictly in the order Odoo wrote them, so a reactivation
            # never lands before the deactivation it answers (a run start and the sweep may drain concurrently).
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('ai_outbox'))")
            events = await (await conn.execute("DELETE FROM ai_outbox RETURNING id, kind, user_ref, created_at")).fetchall()
            for _id, kind, user_ref, at in sorted(events):
                # The employee's own lock, as ``remember`` takes it: a save already under way either lands before the
                # deletion (and is deleted) or sees the leaver mark (and is refused); it can never slip in between.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext('ai_memory:' || %s))", (user_ref,))
                if kind == "user_deactivated":
                    await conn.execute("DELETE FROM ai_memory WHERE scope = 'user' AND owner = %s", (user_ref,))
                    await conn.execute(
                        "INSERT INTO ai_leavers (user_ref, deactivated_at) VALUES (%s, %s) ON CONFLICT (user_ref) DO NOTHING", (user_ref, at),
                    )
                else:
                    await conn.execute("DELETE FROM ai_leavers WHERE user_ref = %s", (user_ref,))
        return len(events)

    async def expired_leavers(self, days: int) -> list[str]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT user_ref FROM ai_leavers WHERE NOT swept AND deactivated_at <= now() - make_interval(days => %s) ORDER BY user_ref",
                (days,),
            )).fetchall()
        return [row[0] for row in rows]

    async def mark_swept(self, user_ref: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE ai_leavers SET swept = true WHERE user_ref = %s", (user_ref,))
