"""``GET /health`` as a pure payload (design 4.6): the operator's monitor reads it for every company package."""

from __future__ import annotations

import time

from pbx_agent.events import iso_utc

# A backlog with no successful send for this long means Odoo is not taking events; the backoff cap is 300 s.
DELIVERY_STALE_SECONDS = 900


class Liveness:
    """The last beat of one background worker, so a stopped thread shows up in the report instead of silence."""

    def __init__(self, stale_after: float) -> None:
        self._stale_after = stale_after
        self._last = time.time()

    def beat(self, now: float) -> None:
        self._last = now

    def report(self, now: float) -> dict:
        age = max(0.0, now - self._last)
        return {"last_beat_seconds": round(age, 1), "stale": age > self._stale_after}


def snapshot(
    *,
    ari_reachable: bool,
    ari_connected: bool,
    line_endpoint: str | None,
    line_state: str | None,
    recordings_free_bytes: int | None,
    recordings_min_free_bytes: int,
    queue_depth: int | None,
    delivery_last_success_at: float | None,
    workers: dict[str, dict],
    now: float,
) -> dict:
    """A report, not a verdict: the process answers 200 while it serves, and the fields say what is wrong."""
    storage_ok = recordings_free_bytes is None or recordings_free_bytes >= recordings_min_free_bytes
    backlog = queue_depth is None or queue_depth > 0
    sent_recently = delivery_last_success_at is not None and now - delivery_last_success_at <= DELIVERY_STALE_SECONDS
    delivery_ok = queue_depth is not None and not (backlog and not sent_recently)
    workers_ok = all(not report["stale"] for report in workers.values())
    healthy = ari_reachable and ari_connected and storage_ok and delivery_ok and workers_ok
    return {
        "status": "ok" if healthy else "degraded",
        "ari": {"reachable": ari_reachable, "connected": ari_connected},
        "line": None if line_endpoint is None else {"endpoint": line_endpoint, "state": line_state},
        "recordings": {
            "free_bytes": recordings_free_bytes,
            "min_free_bytes": recordings_min_free_bytes,
        },
        "queue": {"pending": queue_depth},
        "delivery": {
            "last_success_at": None if delivery_last_success_at is None else iso_utc(delivery_last_success_at),
            "stale_seconds": DELIVERY_STALE_SECONDS,
            "stale": not delivery_ok,
        },
        "workers": workers,
    }
