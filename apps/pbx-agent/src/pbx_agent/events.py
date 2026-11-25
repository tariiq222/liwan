"""The one JSON body Odoo's events route receives (design 4.5).

The stream and reconciliation both build the same envelope, so a recovered call and a live one are described the
same way. Only the fields the spec fixes are promised: ``event_id`` (added by the queue), ``linkedid`` as the call
key and ``uniqueid`` as the channel key. Numbers travel raw: E164 normalization belongs to Odoo, which owns the
contact matching.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pbx_agent.cel import CallLeg

ARI_STATES = {"ChannelCreated": "ringing", "ChannelDestroyed": "ended"}
ARI_TIME = re.compile(r"(.+T\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(\d{2})")


def iso_utc(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def parse_ari_time(raw: object) -> str | None:
    """Asterisk's ``2026-11-25T09:00:00.123+0000`` as ``2026-11-25T09:00:00.123000Z``."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    match = ARI_TIME.fullmatch(text)
    if match:
        text = f"{match.group(1)}{match.group(2)}:{match.group(3)}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_cel_time(raw: str) -> str | None:
    """A CEL ``eventtime`` column; the package runs Asterisk with ``TZ=UTC``, so the wall clock is UTC."""
    try:
        parsed = datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def ari_call_event(event: dict, *, database: str, inbound_context: str, now: float) -> dict | None:
    """The Liwan event for an ARI channel event, or ``None`` for an event that is not a call transition."""
    channel = event.get("channel")
    if not isinstance(channel, dict):
        return None
    kind = event.get("type")
    if kind == "ChannelStateChange":
        if channel.get("state") != "Up":
            return None
        state = "answered"
    else:
        state = ARI_STATES.get(kind) if isinstance(kind, str) else None
        if state is None:
            return None
    uniqueid = channel.get("id") or ""
    if not uniqueid:
        return None
    occurred = parse_ari_time(event.get("timestamp")) or iso_utc(now)
    dialplan = channel.get("dialplan") if isinstance(channel.get("dialplan"), dict) else {}
    return _envelope(
        database=database,
        occurred_at=occurred,
        source="ari",
        reconciled=False,
        linkedid=channel.get("linkedid") or uniqueid,
        uniqueid=uniqueid,
        channel=channel.get("name") or "",
        direction="in" if dialplan.get("context") == inbound_context else "out",
        caller_number=_number(channel.get("caller")),
        connected_number=_number(channel.get("connected")),
        dialed_exten=dialplan.get("exten"),
        state=state,
        started_at=occurred if state == "ringing" else None,
        answered_at=occurred if state == "answered" else None,
        ended_at=occurred if state == "ended" else None,
    )


def cel_call_event(leg: CallLeg, *, database: str, inbound_context: str, now: float) -> dict:
    """One call leg rebuilt from CEL, sent once when the stream never delivered it.

    A leg CEL never closed is ``failed``: its end was guessed from the last row that exists, and Odoo must not keep
    it open. A closed leg is ``ended`` with the times CEL recorded.
    """
    return _envelope(
        database=database,
        occurred_at=leg.ended_at or iso_utc(now),
        source="cel",
        reconciled=True,
        linkedid=leg.linkedid or leg.uniqueid,
        uniqueid=leg.uniqueid,
        channel=leg.channel,
        direction="in" if leg.context == inbound_context else "out",
        caller_number=leg.caller_number,
        connected_number=None,
        dialed_exten=leg.dialed_exten,
        state="failed" if leg.abandoned else "ended",
        started_at=leg.started_at,
        answered_at=leg.answered_at,
        ended_at=leg.ended_at,
    )


def _envelope(
    *,
    database: str,
    occurred_at: str,
    source: str,
    reconciled: bool,
    linkedid: str,
    uniqueid: str,
    channel: str,
    direction: str,
    caller_number: str | None,
    connected_number: str | None,
    dialed_exten: str | None,
    state: str,
    started_at: str | None,
    answered_at: str | None,
    ended_at: str | None,
) -> dict:
    return {
        "database": database,
        "occurred_at": occurred_at,
        "source": source,
        "reconciled": reconciled,
        "call": {
            "linkedid": linkedid,
            "uniqueid": uniqueid,
            "channel": channel,
            "direction": direction,
            "caller_number": caller_number,
            "connected_number": connected_number,
            "dialed_exten": dialed_exten,
            "state": state,
            "started_at": started_at,
            "answered_at": answered_at,
            "ended_at": ended_at,
        },
    }


def _number(party: object) -> str | None:
    if not isinstance(party, dict):
        return None
    number = party.get("number")
    return number if isinstance(number, str) and number else None
