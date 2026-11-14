# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import iso
from odoo.addons.liwan_api.models.tenant_export import (
    COOLDOWN,
    FAILURE_MESSAGES,
    RETENTION,
    STATE_DONE,
    STATE_EXPIRED,
)


def dump_failure(code):
    """A failure as a fixed code and message; the exception text stays in the server log."""
    if not code:
        return None
    return {'code': code, 'message': FAILURE_MESSAGES[code]}


def dump_export(export):
    """The whitelisted shape of one export run: its state, steps, dates, size and per-dataset row counts."""
    expired = export._liwan_is_expired()
    return {
        'id': export.id,
        'state': STATE_EXPIRED if expired else export.state,
        'requested_at': iso(export.create_date),
        'started_at': iso(export.started_at),
        'finished_at': iso(export.finished_at),
        'expires_at': iso(export.expires_at),
        'failure': dump_failure(export.failure),
        'steps_done': export.steps_done,
        'steps_total': export.steps_total,
        'size_bytes': export.size_bytes,
        'counts': export.counts or None,
        'downloadable': export.state == STATE_DONE and not expired,
    }


def dump_export_list(exports, total, next_request_at):
    return {
        'items': [dump_export(export) for export in exports],
        'total': total,
        'next_request_at': iso(next_request_at),
        'retention_days': RETENTION.days,
        'cooldown_hours': int(COOLDOWN.total_seconds() // 3600),
    }
