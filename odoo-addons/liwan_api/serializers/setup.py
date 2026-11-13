# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso, ref


def dump_setup_progress(steps, closed_at):
    """The wizard's five steps in order, each with its outcome (``null`` while open), who and when, plus the closed state.

    ``complete`` is derived: every step has an outcome, ``skipped`` counting as handled.
    """
    return {
        'steps': [{
            'key': key,
            'outcome': row.outcome or None,
            'recorded_by': ref(row.user_id),
            'recorded_at': iso(row.recorded_at),
        } for key, row in steps],
        'closed_at': iso(closed_at),
        'complete': all(row for _key, row in steps),
    }
