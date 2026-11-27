"""Direct atomic PostgreSQL writer for Asterisk 22 PJSIP realtime tables (pbx-db).

Asterisk 22's ``res_config_pgsql.so`` reads ``ps_auths``, ``ps_aors`` and ``ps_endpoints`` live from ``pbx-db``,
making ``pbx-agent`` the sole writer. Writing directly inside one PostgreSQL transaction avoids Asterisk 22's
unquoted ``100rel`` identifier bug in ARI dynamic config pushes and guarantees all-or-nothing updates without
best-effort multi-step rollbacks.

``psycopg`` is imported lazily inside ``PostgresPbxStore`` methods so pure-Python unit tests run without a
PostgreSQL driver installed on the host. No DSN, password or driver error message ever appears in logs,
exceptions or ``repr()``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

log = logging.getLogger(__name__)

CONNECT_TIMEOUT_SECONDS = 5

UPSERT_AUTH_SQL = (
    "INSERT INTO ps_auths (id, auth_type, username, password) "
    "VALUES (%s, 'userpass', %s, %s) "
    "ON CONFLICT (id) DO UPDATE SET "
    "auth_type = 'userpass', "
    "username = EXCLUDED.username, "
    "password = EXCLUDED.password"
)

UPSERT_AOR_SQL = (
    "INSERT INTO ps_aors (id, max_contacts, remove_existing, default_expiration, maximum_expiration) "
    "VALUES (%s, 1, 'yes', %s, %s) "
    "ON CONFLICT (id) DO UPDATE SET "
    "max_contacts = 1, "
    "remove_existing = 'yes', "
    "default_expiration = EXCLUDED.default_expiration, "
    "maximum_expiration = EXCLUDED.maximum_expiration"
)

# G.711 only: the pinned Asterisk image has no opus translator, so an opus browser leg would record an empty WAV and
# bridge to the ulaw trunk without audio. A peer that offers no G.711 is refused instead of recorded empty.
UPSERT_ENDPOINT_SQL = (
    "INSERT INTO ps_endpoints ("
    "id, transport, aors, auth, context, disallow, allow, direct_media, webrtc, "
    "rtp_symmetric, force_rport, rewrite_contact, from_domain, dtmf_mode, "
    "device_state_busy_at, allow_transfer, callerid"
    ") VALUES ("
    "%s, %s, %s, %s, %s, 'all', 'ulaw,alaw', 'no', 'yes', "
    "'yes', 'yes', 'yes', %s, 'rfc4733', 1, 'yes', %s"
    ") ON CONFLICT (id) DO UPDATE SET "
    "transport = EXCLUDED.transport, "
    "aors = EXCLUDED.aors, "
    "auth = EXCLUDED.auth, "
    "context = EXCLUDED.context, "
    "disallow = EXCLUDED.disallow, "
    "allow = EXCLUDED.allow, "
    "direct_media = EXCLUDED.direct_media, "
    "webrtc = EXCLUDED.webrtc, "
    "rtp_symmetric = EXCLUDED.rtp_symmetric, "
    "force_rport = EXCLUDED.force_rport, "
    "rewrite_contact = EXCLUDED.rewrite_contact, "
    "from_domain = EXCLUDED.from_domain, "
    "dtmf_mode = EXCLUDED.dtmf_mode, "
    "device_state_busy_at = EXCLUDED.device_state_busy_at, "
    "allow_transfer = EXCLUDED.allow_transfer, "
    "callerid = EXCLUDED.callerid"
)

UPDATE_ENDPOINT_AUTH_SQL = "UPDATE ps_endpoints SET auth = %s WHERE id = %s"
DELETE_ENDPOINT_SQL = "DELETE FROM ps_endpoints WHERE id = %s"
DELETE_AOR_SQL = "DELETE FROM ps_aors WHERE id = %s"
DELETE_AUTH_SQL = "DELETE FROM ps_auths WHERE id = %s"
DELETE_ORPHAN_AUTHS_SQL = "DELETE FROM ps_auths WHERE id LIKE %s ESCAPE '\\'"


class PbxStoreError(RuntimeError):
    """A failed pbx-db write. Never includes the DSN, credentials or database error text."""


class PbxStore(Protocol):
    """Storage boundary for Asterisk PJSIP realtime rows."""

    def upsert_extension_session(
        self,
        *,
        extension: str,
        auth_id: str,
        auth_username: str,
        password: str,
        auth_ids: Sequence[str],
        session_seconds: int,
        transport: str,
        context: str,
        from_domain: str,
        drop_auth_ids: Sequence[str] = (),
    ) -> None: ...

    def update_endpoint_auths(
        self,
        *,
        extension: str,
        auth_ids: Sequence[str],
        drop_auth_ids: Sequence[str],
    ) -> None: ...

    def delete_extension(
        self,
        *,
        extension: str,
        auth_ids: Sequence[str],
    ) -> None: ...


def _escape_like_prefix(value: str) -> str:
    """Escape SQL LIKE wildcards in an extension prefix for ``ESCAPE '\\'``."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class PostgresPbxStore:
    """Atomic PostgreSQL writer for ``ps_auths``, ``ps_aors`` and ``ps_endpoints``."""

    def __init__(
        self,
        dsn: str,
        *,
        connect_timeout: int = CONNECT_TIMEOUT_SECONDS,
        connect: Callable[..., Any] | None = None,
    ) -> None:
        self._dsn = dsn
        self._timeout = connect_timeout
        self._connect = connect

    def __repr__(self) -> str:
        """Never expose the DSN or its embedded password."""
        return f"PostgresPbxStore(connect_timeout={self._timeout})"

    def _execute_transaction(self, action: Callable[[Any], None]) -> None:
        error_types: tuple[type[BaseException], ...] = (OSError,)
        connect_fn = self._connect
        try:
            # Lazy import so pure-Python tests run without psycopg installed.
            import psycopg
        except ImportError as exc:
            if connect_fn is None:
                log.warning("pbx database driver unavailable: %s", type(exc).__name__)
                raise PbxStoreError("pbx database write failed") from None
        else:
            error_types = (psycopg.Error, OSError)
            if connect_fn is None:
                connect_fn = psycopg.connect

        try:
            with connect_fn(self._dsn, connect_timeout=self._timeout) as conn, conn.transaction():
                action(conn)
        except error_types as exc:
            # Log only the exception class name; driver messages can carry connection details.
            log.warning("pbx database write failed: %s", type(exc).__name__)
            raise PbxStoreError("pbx database write failed") from None

    def upsert_extension_session(
        self,
        *,
        extension: str,
        auth_id: str,
        auth_username: str,
        password: str,
        auth_ids: Sequence[str],
        session_seconds: int,
        transport: str,
        context: str,
        from_domain: str,
        drop_auth_ids: Sequence[str] = (),
    ) -> None:
        """Atomically upsert ``ps_auths``, ``ps_aors`` and ``ps_endpoints`` and drop any stale auths."""
        auth_csv = ",".join(auth_ids)
        callerid = f"Extension {extension} <{extension}>"

        def write(conn: Any) -> None:
            conn.execute(UPSERT_AUTH_SQL, (auth_id, auth_username, password))
            conn.execute(UPSERT_AOR_SQL, (extension, session_seconds, session_seconds))
            conn.execute(
                UPSERT_ENDPOINT_SQL,
                (extension, transport, extension, auth_csv, context, from_domain, callerid),
            )
            for dropped_id in drop_auth_ids:
                conn.execute(DELETE_AUTH_SQL, (dropped_id,))

        self._execute_transaction(write)

    def update_endpoint_auths(
        self,
        *,
        extension: str,
        auth_ids: Sequence[str],
        drop_auth_ids: Sequence[str],
    ) -> None:
        """Atomically narrow ``ps_endpoints.auth`` and delete expired overlap auth rows."""
        auth_csv = ",".join(auth_ids)

        def write(conn: Any) -> None:
            conn.execute(UPDATE_ENDPOINT_AUTH_SQL, (auth_csv, extension))
            for dropped_id in drop_auth_ids:
                conn.execute(DELETE_AUTH_SQL, (dropped_id,))

        self._execute_transaction(write)

    def delete_extension(
        self,
        *,
        extension: str,
        auth_ids: Sequence[str],
    ) -> None:
        """Atomically delete an extension's endpoint, AOR, known auths and any orphan ``<ext>_%`` auths."""
        orphan_pattern = f"{_escape_like_prefix(extension)}\\_%"

        def write(conn: Any) -> None:
            conn.execute(DELETE_ENDPOINT_SQL, (extension,))
            conn.execute(DELETE_AOR_SQL, (extension,))
            for auth_id in auth_ids:
                conn.execute(DELETE_AUTH_SQL, (auth_id,))
            conn.execute(DELETE_ORPHAN_AUTHS_SQL, (orphan_pattern,))

        self._execute_transaction(write)
