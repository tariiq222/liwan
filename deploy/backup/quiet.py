# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restart safety: the intent written before a service stop, and the reconcile that undoes it.

A capture may stop Odoo to copy a quiet database. If the process dies between the stop and
the start, the service stays down, so the intent file is written *before* the stop and
names the service to start again. :func:`reconcile` reads that file and starts the service
a stopped state may have left behind; a run that finished its resume is left alone.

States: ``reserved`` -> ``quiescing`` -> ``captured`` -> ``resumed`` -> ``done``. A run
that fails in-process records ``failed``; the states that may have left the service
stopped are ``quiescing``, ``captured``, ``failed`` and an unreadable intent. A capture on
the host stops no service, so it records ``quiesce='not_required'`` and writes no intent.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from deploy.backup.errors import require

if TYPE_CHECKING:
    from collections.abc import Mapping

QUIESCE_FIELD = 'quiesce'
QUIESCE_NOT_REQUIRED = 'not_required'
QUIESCE_STOPPED = 'stopped'

INTENT_SCHEMA_VERSION = 1
STATE_RESERVED = 'reserved'
STATE_QUIESCING = 'quiescing'
STATE_CAPTURED = 'captured'
STATE_RESUMED = 'resumed'
STATE_DONE = 'done'
STATE_FAILED = 'failed'
STATES = (
    STATE_RESERVED,
    STATE_QUIESCING,
    STATE_CAPTURED,
    STATE_RESUMED,
    STATE_DONE,
    STATE_FAILED,
)
# The states in which the service may still be stopped, so a reconcile must start it.
STOPPED_STATES = frozenset({STATE_QUIESCING, STATE_CAPTURED, STATE_FAILED})


class ServiceControl(Protocol):
    """The service a capture stops and a reconcile starts."""

    def stop(self) -> None: ...

    def start(self) -> None: ...


@dataclass(frozen=True)
class Intent:
    """The file that records what one capture did to the service it depends on."""

    path: Path
    tenant: str
    kind: str


def record_state(intent: Intent, state: str) -> str:
    """Write the intent atomically: a sibling temporary file, then ``os.replace``.

    A reader never sees half an intent and a crash leaves the previous one intact, so a
    state is either the old one or the new one, never a truncated file.
    """
    require(state in STATES, f'unknown intent state: {state!r}')
    require(intent.path.is_absolute(), 'the intent file must be an absolute path')
    payload = {
        'schema_version': INTENT_SCHEMA_VERSION,
        'tenant': intent.tenant,
        'kind': intent.kind,
        'state': state,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    intent.path.parent.mkdir(parents=True, exist_ok=True)
    temporary = intent.path.with_name(f'.{intent.path.name}.tmp')
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(temporary, intent.path)
    return state


def read_state(intent: Intent) -> str | None:
    """The recorded state, or ``None`` when there is no readable intent."""
    if not intent.path.is_file():
        return None
    try:
        payload = json.loads(intent.path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    state = payload.get('state') if isinstance(payload, dict) else None
    return state if state in STATES else None


def quiesce(intent: Intent | None, control: ServiceControl | None) -> dict[str, str]:
    """Record the intent, then stop the service; return the quiesce outcome a manifest keeps.

    ``control is None`` is the host path: nothing is stopped, no intent is written, and the
    record says quiescence was not required. A stop that raises leaves the intent in
    ``quiescing`` on purpose, so the caller's reconcile still starts the service.
    """
    if control is None:
        return {QUIESCE_FIELD: QUIESCE_NOT_REQUIRED}
    require(intent is not None, 'stopping the service needs an intent file to recover from')
    record_state(intent, STATE_QUIESCING)
    control.stop()
    return {QUIESCE_FIELD: QUIESCE_STOPPED}


def reconcile(intent: Intent | None, control: ServiceControl | None) -> str:
    """Start the service a previous run may have left stopped; return the state now recorded.

    Nothing is started for a host capture (no control), for a run that already resumed or
    finished, or when there is no intent at all. An unreadable intent is treated as a
    stopped service: availability wins over a clean record, so it is started and the file
    is rewritten with the state that run verified.
    """
    if control is None:
        return QUIESCE_NOT_REQUIRED
    if intent is None:
        return STATE_DONE
    state = read_state(intent)
    if state in (STATE_RESUMED, STATE_DONE):
        return state
    if state is None and not intent.path.exists():
        return STATE_DONE
    control.start()
    return record_state(intent, STATE_RESUMED)


def quiesce_outcome(record: Mapping[str, str] | None) -> str:
    """The word an artifact keeps: what the quiesce record says, or that none was needed."""
    if not record:
        return QUIESCE_NOT_REQUIRED
    return record.get(QUIESCE_FIELD, QUIESCE_NOT_REQUIRED)
