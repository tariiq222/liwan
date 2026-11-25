"""Turning one live ARI event into a queued row (design 4.5).

A call leg is remembered as delivered only when the call ends. Marking it at the first event would make
reconciliation treat the call as finished, and a call whose end event was lost would stay open in Odoo forever;
with the mark at the end, CEL still rebuilds it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pbx_agent.events import ari_call_event

if TYPE_CHECKING:
    from pbx_agent.queue import EventQueue


def handle_ari_event(queue: EventQueue, event: dict, *, database: str, inbound_context: str, now: float) -> dict | None:
    """Store the call event of an ARI event; returns the stored payload, or ``None`` when it is not a transition."""
    payload = ari_call_event(event, database=database, inbound_context=inbound_context, now=now)
    if payload is None:
        return None
    moment = int(now)
    queue.enqueue(payload, now=moment)
    call = payload["call"]
    if call["state"] == "ended" and call["uniqueid"]:
        queue.mark_leg(call["uniqueid"], now=moment)
    return payload
