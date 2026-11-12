"""Which database serves a tenant: deployment config only, never a value taken from a request."""
from __future__ import annotations

import json
import os
import re
import stat
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Protocol

# A Postgres database name reaches a conninfo parameter, never SQL: refuse anything outside this shape.
DATABASE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


@dataclass(frozen=True)
class _Snapshot:
    """One parsed registry publication, immutable once built: the file identity it was read under."""

    signature: tuple[int, ...]
    mapping: Mapping[str, str]
    databases: tuple[str, ...]


_NO_TENANTS = _Snapshot((), MappingProxyType({}), ())


class UnknownTenant(Exception):
    """This deployment serves no database for the tenant; the request is refused before any connection."""


class TenantDirectory(Protocol):
    def database_for(self, tenant: str) -> str:
        """The database that holds this tenant's AI state; raises ``UnknownTenant``."""
        ...

    def databases(self) -> list[str]:
        """Every database this deployment serves, sorted and unique."""
        ...


class DedicatedDirectory(TenantDirectory):
    """One tenant per deployment: the caller's tenant must be the deployment's own database."""

    def __init__(self, database: str) -> None:
        if not DATABASE_NAME.fullmatch(database):
            msg = "the dedicated tenant database must match ^[a-z][a-z0-9_]{0,62}$"
            raise ValueError(msg)
        self.database = database

    def database_for(self, tenant: str) -> str:
        if tenant != self.database:
            msg = "tenant not served"
            raise UnknownTenant(msg)
        return self.database

    def databases(self) -> list[str]:
        return [self.database]


class RegistryDirectory(TenantDirectory):
    """Shared SaaS: the read-only tenant registry the edge reads, mapped tenant id -> database.

    Parsed once per publication, like the Nuxt edge: every call stats the file, and a new identity
    ``(dev, ino, size, mtime_ns, ctime_ns)`` is read again, so disabling or removing a tenant applies to
    the next request. A pending publication barrier, an unusable file or a file that changes while it is
    read denies every tenant, because an interrupted publication must never fall back to the previous enable.
    """

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self._barrier = Path(f"{path}.pending")
        self._snapshot: _Snapshot | None = None

    def database_for(self, tenant: str) -> str:
        database = self._current().mapping.get(tenant)
        if database is None:
            msg = "tenant not served"
            raise UnknownTenant(msg)
        return database

    def databases(self) -> list[str]:
        return list(self._current().databases)

    def _current(self) -> _Snapshot:
        if _publication_pending(self._barrier):
            return _NO_TENANTS
        signature = _signature(self.path)
        if signature is None:
            return _NO_TENANTS
        snapshot = self._snapshot
        if snapshot is None or snapshot.signature != signature:
            snapshot = self._read(signature)
            if snapshot is None:
                return _NO_TENANTS
            self._snapshot = snapshot  # one attribute swap: a concurrent reader sees the old or the new snapshot
        # The writer may start a publication while this call is in flight, or finish one and remove its barrier.
        if _publication_pending(self._barrier) or _signature(self.path) != signature:
            return _NO_TENANTS
        return snapshot

    def _read(self, signature: tuple[int, ...]) -> _Snapshot | None:
        try:
            text = self.path.read_text(encoding="utf-8")
        except (OSError, ValueError):  # unreadable or undecodable: serve no tenant, and read it again next call
            return None
        if _signature(self.path) != signature:  # replaced or rewritten during the read: never bind an uncertain snapshot
            return None
        try:
            document = json.loads(text)
        except ValueError:  # invalid JSON: this publication serves no tenant
            document = None
        mapping = _enabled_targets(document)
        return _Snapshot(signature, MappingProxyType(mapping), tuple(sorted(set(mapping.values()))))


class MemoryDirectory(TenantDirectory):
    """Development and tests only: any well-formed tenant maps to a database of the same name."""

    def __init__(self) -> None:
        self._tenants: set[str] = set()

    def database_for(self, tenant: str) -> str:
        if not DATABASE_NAME.fullmatch(tenant):
            msg = "tenant not served"
            raise UnknownTenant(msg)
        self._tenants.add(tenant)
        return tenant

    def databases(self) -> list[str]:
        return sorted(self._tenants)


def tenancy_from_env(environ: Mapping[str, str]) -> tuple[str, str | None, str | None]:
    """``(mode, tenant_database, tenant_registry_path)``; memory state needs none of them."""
    # Without real state every tenant lives in memory, so there is no directory to configure.
    if not _real_state(environ):
        return "dedicated", None, None
    mode = _mode(environ)
    if mode == "dedicated":
        return mode, _dedicated_database(environ), None
    if mode == "shared":
        return mode, None, _registry_path(environ)
    raise _unknown_mode()


def directory_for(database_url: str | None, mode: str, tenant_database: str | None,
                  registry_path: str | None) -> TenantDirectory:
    """The directory of already validated tenancy settings (``tenancy_from_env``): memory without real state."""
    if not database_url:
        return MemoryDirectory()
    if mode == "dedicated" and tenant_database:
        return DedicatedDirectory(tenant_database)
    if mode == "shared" and registry_path:
        return RegistryDirectory(registry_path)
    raise _unknown_mode()


def directory_from_env(environ: Mapping[str, str]) -> TenantDirectory:
    """Build the directory the deployment's own configuration describes."""
    return directory_for(environ.get("AI_DATABASE_URL", "").strip() or None, *tenancy_from_env(environ))


def _real_state(environ: Mapping[str, str]) -> bool:
    return bool(environ.get("AI_DATABASE_URL", "").strip())


def _mode(environ: Mapping[str, str]) -> str:
    return environ.get("LIWAN_TENANCY_MODE") or "dedicated"


def _dedicated_database(environ: Mapping[str, str]) -> str:
    database = environ.get("AI_TENANT_DATABASE", "").strip()
    if not DATABASE_NAME.fullmatch(database):
        msg = "AI_TENANT_DATABASE is required in dedicated tenancy mode and must match ^[a-z][a-z0-9_]{0,62}$"
        raise _settings_error("AI_TENANT_DATABASE", msg)
    return database


def _registry_path(environ: Mapping[str, str]) -> str:
    path = environ.get("LIWAN_TENANT_REGISTRY_PATH", "").strip()
    if not path:
        msg = "LIWAN_TENANT_REGISTRY_PATH is required in shared tenancy mode"
        raise _settings_error("LIWAN_TENANT_REGISTRY_PATH", msg)
    return path


def _unknown_mode() -> Exception:
    msg = "LIWAN_TENANCY_MODE must be dedicated or shared"
    return _settings_error("LIWAN_TENANCY_MODE", msg)


def _settings_error(variable: str, message: str) -> Exception:
    # Local import: settings imports DATABASE_NAME and tenancy_from_env from this module.
    from liwan_ai_service.settings import SettingsError

    return SettingsError(variable, message)


def _publication_pending(barrier: Path) -> bool:
    """The durable writer creates ``<path>.pending`` before it commits authority changes."""
    try:
        barrier.lstat()
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True


def _signature(path: Path) -> tuple[int, ...] | None:
    """The registry file's identity; ``None`` when it is missing, unreadable or not a regular file."""
    try:
        info = os.stat(path)
    except OSError:
        return None
    if not stat.S_ISREG(info.st_mode):
        return None
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _enabled_targets(document: object) -> dict[str, str]:
    """``{tenantId: database}`` for enabled rows; a malformed snapshot or row serves no tenant."""
    if not isinstance(document, dict):
        return {}
    revision = document.get("snapshotRevision")
    targets = document.get("targets")
    if (
        document.get("schemaVersion") != 1
        or not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision < 0
        or not isinstance(targets, list)
    ):
        return {}
    mapping: dict[str, str] = {}
    for target in targets:
        if not isinstance(target, dict) or target.get("enabled") is not True:
            continue
        tenant, database = target.get("tenantId"), target.get("database")
        if isinstance(tenant, str) and isinstance(database, str) and DATABASE_NAME.fullmatch(database):
            mapping[tenant] = database
    return mapping
