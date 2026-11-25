"""Delivery of queued events to Odoo (design 4.5, 4.6).

Each attempt signs the stored bytes with its own timestamp, so a retry keeps the same ``event_id`` while Odoo's
replay window sees a current request. Only a 2xx acknowledges a row; every other answer and every transport error
backs off and retries, and no row is ever dropped on error. A failure of one row, of any kind, never ends the pass.
"""

from __future__ import annotations

import logging
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING

from pbx_agent.signing import event_headers

if TYPE_CHECKING:
    from collections.abc import Callable

    from pbx_agent.queue import EventQueue

log = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 5
BACKOFF_BASE_SECONDS = 2
BACKOFF_MAX_SECONDS = 300
BATCH_SIZE = 20
# A pass can spend BATCH_SIZE attempts of REQUEST_TIMEOUT_SECONDS each; the worker is called gone only after that
# plus a margin, so a live worker never looks stale in the middle of a slow batch.
WORKER_STALE_SECONDS = BATCH_SIZE * REQUEST_TIMEOUT_SECONDS + 60


def post_json(url: str, body: bytes, headers: dict[str, str], timeout: float) -> int:
    """One request; an HTTP error is a status, any other transport failure is an exception for the caller to retry."""
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)


def backoff_seconds(attempts: int) -> int:
    """Exponential, capped: 2, 4, 8, ... 300 seconds after the first failure."""
    if attempts <= 0:
        return 0
    return min(BACKOFF_BASE_SECONDS * 2 ** (attempts - 1), BACKOFF_MAX_SECONDS)


class Delivery:
    """One pass over the due rows; the caller decides how often to run it."""

    def __init__(
        self,
        queue: EventQueue,
        *,
        url: str,
        key: bytes,
        post: Callable[[str, bytes, dict[str, str], float], int] = post_json,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._queue = queue
        self._url = url
        self._key = key
        self._post = post
        self._clock = clock
        self.last_success_at: float | None = None

    def run_once(self) -> int:
        delivered = 0
        for event in self._queue.due(now=int(self._clock()), limit=BATCH_SIZE):
            sent_at = int(self._clock())
            headers = event_headers(self._key, event.body, sent_at)
            try:
                status = self._post(self._url, event.body, headers, REQUEST_TIMEOUT_SECONDS)
            except Exception as exc:  # noqa: BLE001 — any transport failure retries the same row
                status = None
                log.warning("event delivery failed, retrying: %s", type(exc).__name__)
            if status is not None and 200 <= status < 300:
                self._queue.acknowledge(event.event_id, now=sent_at)
                self.last_success_at = sent_at
                delivered += 1
                continue
            attempts = event.attempts + 1
            next_attempt_at = sent_at + backoff_seconds(attempts)
            self._queue.retry(event.event_id, attempts=attempts, next_attempt_at=next_attempt_at)
            if status is not None:
                log.warning("event delivery answered %d, retry %d scheduled", status, attempts)
        return delivered
