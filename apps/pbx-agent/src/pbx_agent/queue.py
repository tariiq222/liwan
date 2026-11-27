"""The durable local event queue (design 4.5, 4.6): one SQLite file, one row per event.

The queue is the only place an ``event_id`` is assigned, and it is written into the stored bytes, so every retry
posts exactly the same body and Odoo's idempotency key never moves. A row is acknowledged only after a 2xx and is
otherwise retried forever; the file stays bounded because acknowledged rows, finished call legs and announced
recordings are pruned (``ACKED_RETENTION_SECONDS``, ``LEG_RETENTION_SECONDS``).
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pbx_agent.signing import canonical_json

if TYPE_CHECKING:
    from pathlib import Path

ACKED_RETENTION_SECONDS = 24 * 60 * 60
# Legs and announced recordings are kept for as long as CEL can replay a call, so a replayed row is never sent twice.
LEG_RETENTION_SECONDS = 3 * 24 * 60 * 60

# The two keys the queue takes once only: a call leg the live stream delivered, and a call whose recording was announced.
_CLAIM_LEG = "INSERT OR IGNORE INTO legs (leg_key, first_seen_at) VALUES (?, ?)"
_CLAIM_RECORDING = "INSERT OR IGNORE INTO recordings (linkedid, announced_at) VALUES (?, ?)"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    body BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    acknowledged_at INTEGER
);
CREATE INDEX IF NOT EXISTS events_due ON events (acknowledged_at, next_attempt_at);
CREATE TABLE IF NOT EXISTS legs (
    leg_key TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recordings (
    linkedid TEXT PRIMARY KEY,
    announced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


@dataclass(frozen=True)
class QueuedEvent:
    """One stored event, exactly as it will be posted."""

    event_id: str
    body: bytes
    attempts: int


class EventQueue:
    """Thread-safe access to the SQLite queue; the database calls are short and local."""

    def __init__(self, path: Path) -> None:
        self._lock = threading.Lock()
        self._connection = sqlite3.connect(str(path), timeout=10, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=FULL")
            self._connection.executescript(SCHEMA)
            self._connection.commit()

    def enqueue(self, payload: dict, *, now: int) -> str:
        """Store one event under a new ``event_id``; every later attempt posts these same bytes."""
        with self._lock, self._connection:
            return self._store(payload, now=now)

    def enqueue_for_leg(self, leg_key: str, payload: dict, *, now: int) -> str | None:
        """Store one event and claim its call leg in one transaction; ``None`` when the leg was already seen."""
        with self._lock, self._connection:
            return self._store(payload, now=now) if self._claim(_CLAIM_LEG, leg_key, now=now) else None

    def enqueue_for_recording(self, linkedid: str, payload: dict, *, now: int) -> str | None:
        """Store one event and claim the call's recording in one transaction; ``None`` when it was already announced."""
        with self._lock, self._connection:
            return self._store(payload, now=now) if self._claim(_CLAIM_RECORDING, linkedid, now=now) else None

    def mark_leg(self, leg_key: str, *, now: int) -> None:
        """Remember a call leg the live stream already delivered, so reconciliation leaves it alone."""
        with self._lock, self._connection:
            self._claim(_CLAIM_LEG, leg_key, now=now)

    def _claim(self, claim: str, key: str, *, now: int) -> bool:
        """Take a once-only key; ``False`` when it was taken before. The caller holds the lock and the transaction."""
        return self._connection.execute(claim, (key, now)).rowcount == 1

    def _store(self, payload: dict, *, now: int) -> str:
        """Write one row; the caller holds the lock and the transaction."""
        event_id = str(uuid.uuid4())
        body = canonical_json({**payload, "event_id": event_id})
        self._connection.execute(
            "INSERT INTO events (event_id, body, created_at, next_attempt_at) VALUES (?, ?, ?, ?)",
            (event_id, body, now, now),
        )
        return event_id

    def due(self, *, now: int, limit: int = 20) -> list[QueuedEvent]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT event_id, body, attempts FROM events "
                "WHERE acknowledged_at IS NULL AND next_attempt_at <= ? ORDER BY seq LIMIT ?",
                (now, limit),
            ).fetchall()
        return [QueuedEvent(row["event_id"], row["body"], row["attempts"]) for row in rows]

    def acknowledge(self, event_id: str, *, now: int) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE events SET acknowledged_at = ? WHERE event_id = ? AND acknowledged_at IS NULL",
                (now, event_id),
            )

    def retry(self, event_id: str, *, attempts: int, next_attempt_at: int) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE events SET attempts = ?, next_attempt_at = ? WHERE event_id = ? AND acknowledged_at IS NULL",
                (attempts, next_attempt_at, event_id),
            )

    def depth(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) FROM events WHERE acknowledged_at IS NULL").fetchone()
        return int(row[0])

    def meta_get(self, name: str, default: str | None = None) -> str | None:
        with self._lock:
            row = self._connection.execute("SELECT value FROM meta WHERE name = ?", (name,)).fetchone()
        return default if row is None else str(row["value"])

    def meta_set(self, name: str, value: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                (name, value),
            )

    def prune(self, *, now: int) -> tuple[int, int, int]:
        """Delete acknowledged events past their window, and call legs and announced recordings past the replay horizon."""
        with self._lock, self._connection:
            events = self._connection.execute(
                "DELETE FROM events WHERE acknowledged_at IS NOT NULL AND acknowledged_at < ?",
                (now - ACKED_RETENTION_SECONDS,),
            ).rowcount
            horizon = now - LEG_RETENTION_SECONDS
            legs = self._connection.execute("DELETE FROM legs WHERE first_seen_at < ?", (horizon,)).rowcount
            recordings = self._connection.execute("DELETE FROM recordings WHERE announced_at < ?", (horizon,)).rowcount
            return events, legs, recordings

    def close(self) -> None:
        with self._lock:
            self._connection.close()
