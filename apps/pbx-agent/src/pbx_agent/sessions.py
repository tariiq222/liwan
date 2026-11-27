"""WebRTC SIP session lifecycle: password rotation with overlap, atomic pbx-db writes, revocation, and expiry reaping.

Asterisk 22 matches PJSIP digest authentication by ``(realm, username)`` and stops at the first matching ``auth``
object listed on the endpoint. Each session therefore allocates its own ``slot = secrets.token_hex(4)`` with
``auth_id = f"{ext}_{slot}"`` and ``auth_username = f"{ext}-{slot}"``, allowing the newest session and at most one
immediately preceding live session to coexist during the overlap window without colliding.
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pbx_agent.pbx_db import PbxStore, PbxStoreError
from pbx_agent.signing import turn_rest_credentials

if TYPE_CHECKING:
    from collections.abc import Callable

    from pbx_agent.settings import Settings

log = logging.getLogger(__name__)

SESSION_PASSWORD_BYTES = 18
SLOT_BYTES = 4
REAP_TICK_SECONDS = 5
REAP_STALE_SECONDS = 60

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    auth_id TEXT PRIMARY KEY,
    extension TEXT NOT NULL,
    auth_username TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_ext_created ON sessions (extension, created_at);
"""


@dataclass(frozen=True)
class IssuedSession:
    """One minted browser registration session ready to return to Odoo."""

    ws_url: str
    extension: str
    auth_username: str
    password: str
    ice_servers: list[dict]
    expires_in_seconds: int


def ice_servers_for_session(
    *,
    extension: str,
    stun_url: str | None,
    turn_url: str | None,
    turn_secret: str | None,
    session_seconds: int,
    now: float,
) -> list[dict]:
    """Build the ICE server list for one session, minting fresh coturn REST credentials when TURN is configured."""
    servers: list[dict] = []
    if stun_url:
        servers.append({"urls": stun_url})
    if turn_url and turn_secret:
        username, credential = turn_rest_credentials(
            turn_secret,
            extension,
            session_seconds=session_seconds,
            now=now,
        )
        servers.append({"urls": turn_url, "username": username, "credential": credential})
    return servers


class SessionManager:
    """Tracks active WebRTC SIP sessions in SQLite and writes Asterisk's PJSIP realtime rows to pbx-db."""

    def __init__(
        self,
        settings: Settings,
        store: PbxStore,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._settings = settings
        self._store = store
        self._clock = clock
        self._db_lock = threading.Lock()
        self._locks_guard = threading.Lock()
        self._ext_locks: dict[str, threading.Lock] = {}
        self._connection = sqlite3.connect(str(settings.queue_path), timeout=10, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._db_lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=FULL")
            self._connection.executescript(SCHEMA)
            self._connection.commit()

    def _lock_for(self, extension: str) -> threading.Lock:
        with self._locks_guard:
            lock = self._ext_locks.get(extension)
            if lock is None:
                lock = threading.Lock()
                self._ext_locks[extension] = lock
            return lock

    def _load_extension_rows(self, extension: str) -> list[sqlite3.Row]:
        with self._db_lock:
            return self._connection.execute(
                "SELECT auth_id, extension, auth_username, created_at, expires_at "
                "FROM sessions WHERE extension = ? ORDER BY created_at DESC, rowid DESC",
                (extension,),
            ).fetchall()

    def _next_slot(self, extension: str, existing_ids: set[str]) -> tuple[str, str]:
        while True:
            slot = secrets.token_hex(SLOT_BYTES)
            auth_id = f"{extension}_{slot}"
            if auth_id not in existing_ids:
                return auth_id, f"{extension}-{slot}"

    def issue(self, extension: str, *, now: float | None = None) -> IssuedSession:
        """Mint a new session for ``extension``, keeping at most one immediately preceding live auth for overlap."""
        with self._lock_for(extension):
            moment = self._clock() if now is None else now
            rows = self._load_extension_rows(extension)
            existing_ids = {str(row["auth_id"]) for row in rows}
            auth_id, auth_username = self._next_slot(extension, existing_ids)
            password = secrets.token_urlsafe(SESSION_PASSWORD_BYTES)

            live = [row for row in rows if float(row["expires_at"]) > moment]
            expired = [row for row in rows if float(row["expires_at"]) <= moment]

            kept: list[tuple[str, float]] = []
            stale_ids: list[str] = []
            if self._settings.session_overlap_seconds > 0 and live:
                prev = live[0]
                overlap_until = min(float(prev["expires_at"]), moment + self._settings.session_overlap_seconds)
                kept.append((str(prev["auth_id"]), overlap_until))
                stale_ids.extend(str(row["auth_id"]) for row in live[1:])
                stale_ids.extend(str(row["auth_id"]) for row in expired)
            else:
                stale_ids.extend(str(row["auth_id"]) for row in live)
                stale_ids.extend(str(row["auth_id"]) for row in expired)

            active_auth_ids = [auth_id] + [kept_id for kept_id, _ in kept]
            self._store.upsert_extension_session(
                extension=extension,
                auth_id=auth_id,
                auth_username=auth_username,
                password=password,
                auth_ids=active_auth_ids,
                session_seconds=self._settings.session_seconds,
                transport=self._settings.pjsip_transport,
                context=self._settings.pjsip_context,
                from_domain=self._settings.public_host,
                drop_auth_ids=stale_ids,
            )

            expires_at = moment + self._settings.session_seconds
            with self._db_lock, self._connection:
                self._connection.execute(
                    "INSERT INTO sessions (auth_id, extension, auth_username, created_at, expires_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (auth_id, extension, auth_username, moment, expires_at),
                )
                for kept_id, overlap_until in kept:
                    self._connection.execute(
                        "UPDATE sessions SET expires_at = ? WHERE auth_id = ?",
                        (overlap_until, kept_id),
                    )
                for stale_id in stale_ids:
                    self._connection.execute("DELETE FROM sessions WHERE auth_id = ?", (stale_id,))

            ice_servers = ice_servers_for_session(
                extension=extension,
                stun_url=self._settings.stun_url,
                turn_url=self._settings.turn_url,
                turn_secret=self._settings.turn_secret,
                session_seconds=self._settings.session_seconds,
                now=moment,
            )
            return IssuedSession(
                ws_url=self._settings.public_ws_url,
                extension=extension,
                auth_username=auth_username,
                password=password,
                ice_servers=ice_servers,
                expires_in_seconds=self._settings.session_seconds,
            )

    def revoke(self, extension: str) -> None:
        """Delete the extension's endpoint, aor, and all auth rows from pbx-db and SQLite."""
        with self._lock_for(extension):
            rows = self._load_extension_rows(extension)
            auth_ids = [str(row["auth_id"]) for row in rows]
            self._store.delete_extension(extension=extension, auth_ids=auth_ids)
            if auth_ids:
                with self._db_lock, self._connection:
                    self._connection.execute("DELETE FROM sessions WHERE extension = ?", (extension,))

    def reap(self, *, now: float | None = None) -> int:
        """Delete expired or past-overlap auths; when an extension has zero live sessions left, delete endpoint and aor too."""
        moment = self._clock() if now is None else now
        with self._db_lock:
            extensions = [
                str(row["extension"])
                for row in self._connection.execute(
                    "SELECT DISTINCT extension FROM sessions WHERE expires_at <= ?",
                    (moment,),
                ).fetchall()
            ]

        cleaned = 0
        for extension in extensions:
            with self._lock_for(extension):
                rows = self._load_extension_rows(extension)
                live = [row for row in rows if float(row["expires_at"]) > moment]
                expired = [row for row in rows if float(row["expires_at"]) <= moment]
                if not expired:
                    continue
                expired_ids = [str(row["auth_id"]) for row in expired]
                try:
                    if live:
                        self._store.update_endpoint_auths(
                            extension=extension,
                            auth_ids=[str(row["auth_id"]) for row in live],
                            drop_auth_ids=expired_ids,
                        )
                    else:
                        self._store.delete_extension(extension=extension, auth_ids=expired_ids)
                except PbxStoreError as exc:
                    log.warning("session reap for %s deferred: %s", extension, type(exc).__name__)
                    continue

                with self._db_lock, self._connection:
                    for auth_id in expired_ids:
                        self._connection.execute("DELETE FROM sessions WHERE auth_id = ?", (auth_id,))
                cleaned += len(expired_ids)
        return cleaned

    def active_sessions(self, extension: str) -> list[dict]:
        """Snapshot of stored session rows for ``extension`` (newest first)."""
        return [dict(row) for row in self._load_extension_rows(extension)]

    def close(self) -> None:
        with self._db_lock:
            self._connection.close()
