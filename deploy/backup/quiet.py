# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restart safety: the intent written before a service stop, and the reconcile that undoes it.

A capture may stop Odoo to copy a quiet database. If the process dies between the stop and
the start, the service stays down, so the intent file is written *before* the stop and
names the run that may need it started again: the tenant and the attempt. :func:`reconcile`
starts the service only for the intent of the attempt that asks, so a refused or unrelated
job can never start a service another attempt stopped on purpose.

States: ``quiescing`` -> ``captured`` -> ``resumed`` -> ``done``. The states that may have
left the service stopped are ``quiescing`` and ``captured``; a run that resumed or finished
is left alone, and an intent that cannot be attributed to the asking attempt is never acted
on. The host path stops no service and writes no intent.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from deploy.backup.errors import require

INTENT_SCHEMA_VERSION = 1
STATE_QUIESCING = 'quiescing'
STATE_CAPTURED = 'captured'
STATE_RESUMED = 'resumed'
STATE_DONE = 'done'
STATES = (STATE_QUIESCING, STATE_CAPTURED, STATE_RESUMED, STATE_DONE)


class ServiceControl(Protocol):
    """The service a capture stops and a reconcile starts."""

    def stop(self) -> None: ...

    def start(self) -> None: ...


@dataclass(frozen=True)
class Intent:
    """The file that records what one run did to the service it depends on."""

    path: Path
    tenant: str
    kind: str
    attempt: str


def record_state(intent: Intent, state: str) -> str:
    """Write the intent atomically: a sibling temporary file, then ``os.replace``.

    A reader never sees half an intent and a crash leaves the previous one intact, so a
    state is either the old one or the new one, never a truncated file.
    """
    require(state in STATES, f'unknown intent state: {state!r}')
    require(bool(intent.attempt), 'an intent must name the attempt that wrote it')
    require(intent.path.is_absolute(), 'the intent file must be an absolute path')
    payload = {
        'schema_version': INTENT_SCHEMA_VERSION,
        'tenant': intent.tenant,
        'kind': intent.kind,
        'attempt': intent.attempt,
        'state': state,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    intent.path.parent.mkdir(parents=True, exist_ok=True)
    temporary = intent.path.with_name(f'.{intent.path.name}.tmp')
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(temporary, intent.path)
    return state


def read_intent(intent: Intent) -> dict[str, str] | None:
    """The recorded state, tenant and attempt, or ``None`` when there is no readable intent.

    An intent without a state this module writes, or without the attempt that wrote it, is
    unreadable: nothing can be proven about the service it describes, so no one acts on it.
    """
    if not intent.path.is_file():
        return None
    try:
        payload = json.loads(intent.path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    state, tenant, attempt = payload.get('state'), payload.get('tenant'), payload.get('attempt')
    if (state not in STATES or not isinstance(tenant, str) or not tenant
            or not isinstance(attempt, str) or not attempt):
        return None
    return {'state': state, 'tenant': tenant, 'attempt': attempt}


def quiesce(intent: Intent | None, control: ServiceControl | None) -> None:
    """Record the intent, then stop the service.

    ``control is None`` is the host path: nothing is stopped, no intent is written. A stop
    that raises leaves the intent in ``quiescing`` on purpose, so the caller's reconcile
    still starts the service.
    """
    if control is None:
        return
    require(intent is not None, 'stopping the service needs an intent file to recover from')
    record_state(intent, STATE_QUIESCING)
    control.stop()


def reconcile(intent: Intent | None, control: ServiceControl | None, *, attempt: str) -> str:
    """Start the service this attempt's intent may have left stopped; return the state now recorded.

    Nothing is started for a host capture (no control), for an absent or unreadable intent,
    for a run that already resumed or finished, or for an intent that names another attempt
    or another tenant: that intent describes work someone else owns, and starting the
    service would resume writers mid-capture.
    """
    if control is None or intent is None:
        return STATE_DONE
    recorded = read_intent(intent)
    if recorded is None:
        return STATE_DONE
    if recorded['state'] in (STATE_RESUMED, STATE_DONE):
        return recorded['state']
    if (recorded['attempt'], recorded['tenant']) != (attempt, intent.tenant):
        return STATE_DONE
    control.start()
    return record_state(intent, STATE_RESUMED)
