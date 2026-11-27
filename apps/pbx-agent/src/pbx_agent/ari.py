"""The only Asterisk client (design 2, 4.1, 4.4-4.6): the event stream and the few calls the agent needs.

Two seams keep Asterisk out of the tests: ``AriClient`` takes a ``request(method, path, params, body)`` callable
and ``AriListener`` takes a ``connect(url)`` factory. The api key travels only in a query string, so no URL and no
transport error message is ever logged; only the exception class name is.
"""

from __future__ import annotations

import http.client
import json
import logging
import threading
import urllib.error
import urllib.request
from typing import TYPE_CHECKING
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

if TYPE_CHECKING:
    from collections.abc import Callable

log = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 10
RECEIVE_TIMEOUT_SECONDS = 1.0
RECONNECT_MIN_SECONDS = 1
RECONNECT_MAX_SECONDS = 30
PJSIP = "PJSIP"
# ARI asks for a Stasis application even when every event is subscribed; the agent registers none of its own.
EVENTS_APPLICATION = "pbx-agent"


class AriError(RuntimeError):
    """A failed ARI call. The message names the method, the path and the status or the exception class, never the api key."""


class AriTransport:
    """HTTP against ``PBX_ARI_URL``. Parameters, including the api key, go in the query string; a body goes as JSON."""

    def __init__(self, base_url: str, username: str, password: str, timeout: float = REQUEST_TIMEOUT_SECONDS) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = f"{username}:{password}"
        self._timeout = timeout

    def __call__(self, method: str, path: str, params: dict | None = None, body: dict | None = None) -> tuple[int, object]:
        query = dict(params or {})
        query["api_key"] = self._api_key
        request = urllib.request.Request(
            f"{self._base_url}{path}?{urlencode(query)}",
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={} if body is None else {"Content-Type": "application/json"},
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
                status = int(response.status)
        except urllib.error.HTTPError as exc:
            return int(exc.code), None
        except (OSError, http.client.HTTPException) as exc:
            # A refused connection, a timeout or a broken response is a failed call, never a healthy one.
            msg = f"ARI {method} {path} failed: {type(exc).__name__}"
            raise AriError(msg) from None
        if not raw:
            return status, None
        try:
            return status, json.loads(raw)
        except ValueError:
            return status, None


class AriClient:
    """The ARI surface the agent uses: the health probe, one endpoint's state, and the write that gives an extension a new password."""

    def __init__(self, request: Callable[[str, str, dict | None, dict | None], tuple[int, object]]) -> None:
        self._request = request

    def reachable(self) -> bool:
        """``GET /ari/asterisk/info``: the probe behind the health endpoint. A failed call is a no."""
        try:
            status, _payload = self._request("GET", "/asterisk/info", None, None)
        except AriError:
            return False
        return status == 200

    def endpoint_state(self, endpoint: str) -> str | None:
        """A PJSIP endpoint's ``online``/``offline``/``unknown``, or ``None`` when ARI cannot say."""
        try:
            status, payload = self._request("GET", f"/endpoints/{PJSIP}/{quote(endpoint, safe='')}", None, None)
        except AriError:
            return None
        if status != 200 or not isinstance(payload, dict):
            return None
        state = payload.get("state")
        return state if isinstance(state, str) else None

    def upsert_endpoint(self, extension: str, password: str, transport: str, context: str) -> None:
        """Give one extension a fresh password in the Asterisk realtime database (design 4.1).

        ARI writes the three objects PJSIP needs (auth, aor, endpoint) through its ``realtime`` interface; writing the
        same names again replaces the previous session's password, which is what makes a session password temporary.
        """
        objects = (
            ("auth", extension, {"auth_type": "userpass", "username": extension, "password": password}),
            ("aor", extension, {"max_contacts": "1", "remove_existing": "yes", "maximum_expiration": "120"}),
            ("endpoint", extension, {
                "aors": extension,
                "auth": extension,
                "transport": transport,
                "context": context,
                "webrtc": "yes",
                "direct_media": "no",
                "rtp_symmetric": "yes",
                "force_rport": "yes",
                "rewrite_contact": "yes",
            }),
        )
        for kind, name, fields in objects:
            body = {"fields": [{"attribute": key, "value": value} for key, value in fields.items()]}
            path = f"/asterisk/config/dynamic/res_pjsip/{kind}/{quote(name, safe='')}"
            status, _payload = self._request("PUT", path, None, body)
            if status not in (200, 201, 204):
                msg = f"ARI PUT {path} answered {status}"
                raise AriError(msg)


def events_url(base_url: str, username: str, password: str) -> str:
    """``ari/events?api_key=...&app=pbx-agent&subscribeAll=true`` on the transport that matches the base URL."""
    parts = urlsplit(base_url)
    scheme = "wss" if parts.scheme == "https" else "ws"
    path = parts.path.rstrip("/") + "/events"
    query = urlencode({"api_key": f"{username}:{password}", "app": EVENTS_APPLICATION, "subscribeAll": "true"})
    return urlunsplit((scheme, parts.netloc, path, query, ""))


class ConnectionState:
    """Thread-safe view of the event stream for the health endpoint."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connected = False

    @property
    def connected(self) -> bool:
        with self._lock:
            return self._connected

    def set(self, connected: bool) -> None:
        with self._lock:
            self._connected = connected


class AriListener:
    """The ARI event WebSocket: parsed events out, reconnecting with backoff, until the stop event is set."""

    def __init__(
        self,
        *,
        url: str,
        on_event: Callable[[dict], None],
        state: ConnectionState,
        connect: Callable[[str], object] | None = None,
    ) -> None:
        self._url = url
        self._on_event = on_event
        self._state = state
        self._connect = connect or _default_connect

    def run_forever(self, stop: threading.Event) -> None:
        delay = RECONNECT_MIN_SECONDS
        while not stop.is_set():
            try:
                self._session(stop)
                delay = RECONNECT_MIN_SECONDS
            except Exception as exc:  # noqa: BLE001 — any transport failure restarts the stream
                self._state.set(False)
                log.warning("ARI event stream lost: %s", type(exc).__name__)
            if stop.wait(delay):
                return
            delay = min(delay * 2, RECONNECT_MAX_SECONDS)

    def _session(self, stop: threading.Event) -> None:
        with self._connect(self._url) as socket:
            self._state.set(True)
            while not stop.is_set():
                try:
                    message = socket.recv(timeout=RECEIVE_TIMEOUT_SECONDS)
                except TimeoutError:
                    continue
                self._dispatch(message)
        self._state.set(False)

    def _dispatch(self, message: object) -> None:
        if isinstance(message, bytes):
            message = message.decode("utf-8", "replace")
        try:
            event = json.loads(message)
        except (TypeError, ValueError):
            return
        if not isinstance(event, dict) or event.get("type") == "Ping":
            return
        try:
            self._on_event(event)
        except Exception as exc:  # noqa: BLE001 — one unreadable event must not end the stream
            log.warning("ARI event dropped: %s", type(exc).__name__)


def _default_connect(url: str) -> object:
    # Imported here so the socket library never loads in tests, which inject their own factory.
    from websockets.sync.client import connect  # noqa: PLC0415

    # ARI is on the package's private network: an environment proxy must never be used for it.
    return connect(url, open_timeout=REQUEST_TIMEOUT_SECONDS, proxy=None)
