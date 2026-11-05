# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of the TikTok history import (the shortcut dump joins them in E7.2)."""
from odoo.addons.liwan_api.serializers.common import iso


def dump_sync(job):
    """One history import: its state, its phase and its counters (the final contract is E7.2's)."""
    return {
        'id': job.id,
        'state': job.state,
        'phase': job.phase,
        'conversations_count': job.conversations_count,
        'messages_count': job.messages_count,
        'error': job.error or None,
        'started_at': iso(job.started_at),
        'finished_at': iso(job.finished_at),
        'created_at': iso(job.create_date),
    }
