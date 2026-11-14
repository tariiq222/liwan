# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import iso
from odoo.addons.liwan_api.models.tenant_export import RETENTION, STATE_DONE


def dump_export(export):
    """The whitelisted shape of one export run: its state, dates, size and per-dataset row counts."""
    return {
        'id': export.id,
        'state': export.state,
        'requested_at': iso(export.create_date),
        'started_at': iso(export.started_at),
        'finished_at': iso(export.finished_at),
        'expires_at': iso(export.expires_at),
        'failure': export.failure or None,
        'size_bytes': export.size_bytes,
        'counts': export.counts or None,
        'downloadable': export.state == STATE_DONE,
    }


def dump_export_list(exports):
    return {
        'items': [dump_export(export) for export in exports],
        'total': len(exports),
        'retention_days': RETENTION.days,
    }
