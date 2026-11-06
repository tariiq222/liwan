"""Which host a tenant's own key may reach, and how the egress proxy learns of it (spec 2026-11-04 §6.8 and §6.11).

The ``ai`` container has no route of its own: every provider call leaves through ``ai-egress``. A tenant on the generic
``openai_compatible`` provider names its own endpoint, so this module does two things:

* ``check_base_url`` refuses a base URL that could never be a public provider endpoint, when the key is saved;
* ``TenantEgress`` writes the host a tenant's key needs into a directory shared with ``ai-egress`` (one file per tenant
  database, ``<database>.hosts``, one hostname per line), whenever a key is saved or removed and once at startup.

``ai-egress`` allows CONNECT to port 443 for those hosts only while they resolve to public addresses, so the proxy stays
the authority at connect time (DNS rebinding included); the check here is the early, readable refusal. Inside an
internal Docker network a public name does not resolve, so a host this process cannot resolve is left to the proxy.
"""
from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import logging
import os
import re
import socket
import tempfile
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.tenant_state import TenantStates

log = logging.getLogger(__name__)

# The hostname rule of deploy/ai-egress/render.sh (``is_host``): a lowercase name the proxy accepts in a host list.
HOST = re.compile(r"[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?")
PRINTABLE_ASCII = re.compile(r"[\x21-\x7e]+")
TLD = re.compile(r"[a-z][a-z0-9-]*")  # a name whose last label has a letter cannot be written as an IPv4 address
HTTPS_PORT = 443
RESOLVE_TIMEOUT_SECONDS = 5
# Globally routable by the IANA registry, yet they embed or tunnel an IPv4 address of any kind: 6to4 and both NAT64 prefixes.
EMBEDDING = tuple(ipaddress.ip_network(prefix) for prefix in ("2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"))
INVALID = "invalid"
NOT_PUBLIC = "ai_base_url_not_public"


class BaseUrlRefusedError(ValueError):
    """The base URL cannot be a tenant's provider endpoint; ``code`` is ``invalid`` (its shape) or ``ai_base_url_not_public``."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def base_url_host(base_url: str) -> str:
    """The hostname of a base URL that has the shape of a public provider endpoint, lowercase; ``BaseUrlRefusedError(invalid)`` otherwise.

    https on the default port only (the proxy opens nothing else for a tenant host), no credentials, query or fragment,
    and a registered-looking name: a raw IP address, a single-label name or an internal suffix is never a public endpoint.
    """
    if not PRINTABLE_ASCII.fullmatch(base_url):  # also keeps the parser from silently dropping tabs and newlines
        raise BaseUrlRefusedError(INVALID)
    try:  # a malformed URL (an unclosed IPv6 bracket, a bad port) is a shape refusal, never a server error
        parts = urlsplit(base_url)
        port = parts.port
    except ValueError:
        raise BaseUrlRefusedError(INVALID) from None
    host = parts.hostname
    if (
        parts.scheme != "https" or "@" in parts.netloc or parts.query or parts.fragment or port not in (None, HTTPS_PORT)
        or host is None or not HOST.fullmatch(host) or "." not in host or not TLD.fullmatch(host.rpartition(".")[2])
    ):
        raise BaseUrlRefusedError(INVALID)
    return host


def is_public(address: str) -> bool:
    """Whether a resolved address is globally routable unicast: not private, loopback, link-local, CGNAT, multicast or reserved."""
    ip = ipaddress.ip_address(address.partition("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast and not any(ip in network for network in EMBEDDING)


async def resolve(host: str) -> list[str]:
    """Every address ``host`` resolves to from here; empty when it does not resolve at all (see the module docstring)."""
    try:
        infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, HTTPS_PORT, type=socket.SOCK_STREAM), RESOLVE_TIMEOUT_SECONDS)
    except (OSError, TimeoutError):
        return []
    return sorted({info[4][0] for info in infos})


async def check_base_url(base_url: str) -> str:
    """The host of a tenant's base URL, once its shape is sound and every address it resolves to is public."""
    host = base_url_host(base_url)
    if not all(is_public(address) for address in await resolve(host)):
        raise BaseUrlRefusedError(NOT_PUBLIC)
    return host


def key_host(provider: str, base_url: str | None) -> str | None:
    """The host a tenant key on ``provider`` reaches: its own endpoint's, or the host of the tenant's base URL."""
    spec = REGISTRY[provider]
    return base_url_host(base_url) if spec.needs_base_url and base_url else spec.host


class TenantEgress:
    """The hosts tenants' keys need, published for ``ai-egress`` (read-only there) as one file per tenant database.

    Every write is atomic (a temporary file in the same directory, then a rename), so the proxy never reads half a file.
    Without a directory nothing is published: development and tests, where no proxy runs.
    """

    def __init__(self, directory: str | None) -> None:
        self.directory = Path(directory) if directory else None
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def serialized(self, database: str) -> asyncio.Lock:
        """Held while a tenant's key and its published host change together, so two saves cannot cross."""
        return self._locks[database]

    async def publish(self, database: str, host: str | None) -> None:
        """Make ``host`` the one host ``database``'s key needs; None withdraws it (the key was removed)."""
        if self.directory is not None:
            await asyncio.to_thread(self._write, database, host)

    def _write(self, database: str, host: str | None) -> None:
        target = self.directory / f"{database}.hosts"
        if host is None:
            target.unlink(missing_ok=True)
            return
        # A dot-prefixed name no ``*.hosts`` glob matches, unique per write.
        handle, staged = tempfile.mkstemp(dir=self.directory, prefix=f".{database}.", suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="ascii") as file:
                file.write(f"{host}\n")
            os.chmod(staged, 0o644)  # ai-egress runs as another user
            os.replace(staged, target)
        except BaseException:
            Path(staged).unlink(missing_ok=True)
            raise

    def _remove_orphans(self, served: set[str]) -> None:
        for path in self.directory.glob("*.hosts"):
            if path.name.removesuffix(".hosts") not in served:
                path.unlink(missing_ok=True)

    async def sync(self, states: TenantStates) -> None:
        """Publish the host of every served tenant's saved key, so the proxy is right after a restart of either side.

        A tenant that cannot be read or published is logged and skipped; its previous file stays as it was. The file of
        a database that is no longer served is deleted, unless the directory serves none at all (an unreadable or
        pending registry is not a reason to cut every tenant off). Without a directory it opens nothing: tenant states
        otherwise stay unopened until a request needs them.
        """
        if self.directory is None:
            return

        def skipped(database: str, error: Exception) -> None:
            log.warning("tenant egress hosts of %s not synced: %s", database, type(error).__name__)

        served = states.directory.databases()
        async with contextlib.aclosing(states.each(on_unavailable=skipped)) as sweep:
            async for state in sweep:
                try:
                    async with self.serialized(state.database):
                        key = (await state.config.get()).key
                        await self.publish(state.database, key_host(key.provider, key.base_url) if key.configured else None)
                except Exception as error:  # noqa: BLE001 - one tenant's failure must not stop the others; the next save or restart retries
                    skipped(state.database, error)
        if served:
            await asyncio.to_thread(self._remove_orphans, set(served))
