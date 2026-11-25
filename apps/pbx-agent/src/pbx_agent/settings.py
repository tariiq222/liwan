"""Configuration read once from the environment and validated at start; a bad value stops the boot.

The two telephony keys arrive here already derived (telephony design 12.6): the root ``LIWAN_TELEPHONY_KEY``
never exists on a PBX host. No message in this module repeats a value, only the variable name, so a boot
failure cannot leak a key or a password through the container log.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from collections.abc import Mapping

HEX_KEY = re.compile(r"[0-9a-f]{64}")
DATABASE_NAME = re.compile(r"[a-z][a-z0-9_]{0,62}")
PUBLIC_HOST = re.compile(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?")
KEYS_FILE_NAMES = ("events", "reverse")


class SettingsError(ValueError):
    """A missing or malformed variable. ``variable`` is the only part safe to report outside the logs."""

    def __init__(self, variable: str, message: str) -> None:
        super().__init__(message)
        self.variable = variable


@dataclass(frozen=True)
class Settings:
    """Everything the agent needs, and nothing read again after startup."""

    ari_url: str
    ari_username: str
    ari_password: str
    database: str
    events_key: bytes
    reverse_key: bytes
    recordings_dir: Path
    recordings_min_free_bytes: int
    odoo_events_url: str
    listen_host: str
    listen_port: int
    queue_path: Path
    reconcile_seconds: int
    public_host: str
    cel_path: Path
    inbound_context: str
    line_endpoint: str | None

    def __repr__(self) -> str:
        """Never show a password or a key, including from an unexpected traceback."""
        return (
            f"Settings(database={self.database!r}, ari_url={self.ari_url!r}, "
            f"queue_path={str(self.queue_path)!r}, listen_port={self.listen_port})"
        )

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> Settings:
        keys_file = environ.get("PBX_KEYS_FILE", "").strip()
        direct = [name for name in ("PBX_EVENTS_KEY", "PBX_REVERSE_KEY") if environ.get(name, "").strip()]
        if keys_file and direct:
            msg = "PBX_KEYS_FILE cannot be combined with PBX_EVENTS_KEY or PBX_REVERSE_KEY"
            raise SettingsError("PBX_KEYS_FILE", msg)
        if keys_file:
            events_key, reverse_key = _keys_from_file(_read_path(environ, "PBX_KEYS_FILE"))
        elif len(direct) == 2:
            events_key = _key(environ, "PBX_EVENTS_KEY")
            reverse_key = _key(environ, "PBX_REVERSE_KEY")
        elif direct:
            missing = "PBX_REVERSE_KEY" if direct[0] == "PBX_EVENTS_KEY" else "PBX_EVENTS_KEY"
            msg = f"{missing} is required when the other derived key is set"
            raise SettingsError(missing, msg)
        else:
            msg = "the two derived keys are required: PBX_EVENTS_KEY and PBX_REVERSE_KEY, or PBX_KEYS_FILE"
            raise SettingsError("PBX_KEYS_FILE", msg)

        ari_url = _url(environ, "PBX_ARI_URL")
        ari_username = _required(environ, "PBX_ARI_USERNAME")
        ari_password = _required(environ, "PBX_ARI_PASSWORD")
        database = _required(environ, "PBX_DATABASE")
        if not DATABASE_NAME.fullmatch(database):
            msg = "PBX_DATABASE must be a database name: a letter, then lowercase letters, digits or underscore"
            raise SettingsError("PBX_DATABASE", msg)

        # Read for streaming, and its free space is reported by /health. Nothing writes or deletes there yet:
        # retention deletion is phase 4, so write access is not required of this container today.
        recordings_dir = _read_path(environ, "PBX_RECORDINGS_DIR")
        if not recordings_dir.is_dir():
            msg = "PBX_RECORDINGS_DIR must be an existing directory"
            raise SettingsError("PBX_RECORDINGS_DIR", msg)

        queue_path = _read_path(environ, "PBX_QUEUE_PATH")
        if not queue_path.parent.is_dir():
            msg = "PBX_QUEUE_PATH must name a file in an existing directory"
            raise SettingsError("PBX_QUEUE_PATH", msg)

        public_host = _required(environ, "PBX_PUBLIC_HOST").lower()
        if not PUBLIC_HOST.fullmatch(public_host):
            msg = "PBX_PUBLIC_HOST must be a bare hostname: no scheme, port or path"
            raise SettingsError("PBX_PUBLIC_HOST", msg)

        return cls(
            ari_url=ari_url,
            ari_username=ari_username,
            ari_password=ari_password,
            database=database,
            events_key=events_key,
            reverse_key=reverse_key,
            recordings_dir=recordings_dir,
            recordings_min_free_bytes=_integer(environ, "PBX_RECORDINGS_MIN_FREE_BYTES", 536870912, 0, 1 << 50),
            odoo_events_url=_url(environ, "PBX_ODOO_EVENTS_URL"),
            listen_host=environ.get("PBX_LISTEN_HOST", "").strip() or "0.0.0.0",
            listen_port=_integer(environ, "PBX_LISTEN_PORT", 8601, 1, 65535),
            queue_path=queue_path,
            reconcile_seconds=_integer(environ, "PBX_RECONCILE_SECONDS", 300, 30, 86400),
            public_host=public_host,
            cel_path=_read_path(environ, "PBX_CEL_PATH"),
            inbound_context=environ.get("PBX_INBOUND_CONTEXT", "").strip() or "from-trunk",
            line_endpoint=environ.get("PBX_LINE_ENDPOINT", "").strip() or None,
        )


def _required(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name, "").strip()
    if not value:
        msg = f"{name} is required"
        raise SettingsError(name, msg)
    return value


def _key(environ: Mapping[str, str], name: str) -> bytes:
    value = _required(environ, name)
    if not HEX_KEY.fullmatch(value):
        msg = f"{name} must be 64 hex characters (the derived telephony key)"
        raise SettingsError(name, msg)
    return bytes.fromhex(value)


def _integer(environ: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = low - 1
    if not low <= value <= high:
        msg = f"{name} must be an integer from {low} to {high}"
        raise SettingsError(name, msg)
    return value


def _read_path(environ: Mapping[str, str], name: str) -> Path:
    path = Path(_required(environ, name))
    if not path.is_absolute():
        msg = f"{name} must be an absolute path"
        raise SettingsError(name, msg)
    return path


def _url(environ: Mapping[str, str], name: str) -> str:
    value = _required(environ, name)
    parts = urlsplit(value)
    if (
        parts.scheme not in ("http", "https")
        or not parts.netloc
        or not parts.path
        or parts.query
        or parts.fragment
        or parts.username is not None
        or "@" in parts.netloc
    ):
        msg = f"{name} must be an http(s) URL with a path, no credentials, query or fragment"
        raise SettingsError(name, msg)
    return value.rstrip("/")


def _keys_from_file(path: Path) -> tuple[bytes, bytes]:
    """A two-line secret file: ``events=<64 hex>`` and ``reverse=<64 hex>``. On the PBX host only these exist."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        msg = "PBX_KEYS_FILE cannot be read"
        raise SettingsError("PBX_KEYS_FILE", msg) from None
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        name = name.strip()
        if not separator or name not in KEYS_FILE_NAMES:
            msg = "PBX_KEYS_FILE lines must be events=<key> or reverse=<key>"
            raise SettingsError("PBX_KEYS_FILE", msg)
        values[name] = value.strip()
    missing = [name for name in KEYS_FILE_NAMES if name not in values]
    if missing:
        msg = "PBX_KEYS_FILE is missing the " + " and ".join(missing) + " key"
        raise SettingsError("PBX_KEYS_FILE", msg)
    for name in KEYS_FILE_NAMES:
        if not HEX_KEY.fullmatch(values[name]):
            msg = f"PBX_KEYS_FILE {name} key must be 64 hex characters"
            raise SettingsError("PBX_KEYS_FILE", msg)
    return bytes.fromhex(values["events"]), bytes.fromhex(values["reverse"])
