# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """A recording state the selection no longer offers becomes ``none``.

    ``pending`` left the recording-state ladder, so a database that still stores it would raise a ``KeyError`` in the
    ladder on the next event and be refused by the API contract. Nothing is known to be recording there: the value
    only ever meant "a ready event is expected", which ``none`` states too. The ids are read by SQL because the ORM
    refuses a value outside the field's selection; the write itself is the model's.
    """
    if not version:
        return
    cr.execute("SELECT id FROM liwan_telephony_call WHERE recording_state = 'pending'")
    stale = [row[0] for row in cr.fetchall()]
    if stale:
        api.Environment(cr, SUPERUSER_ID, {})['liwan.telephony.call'].browse(stale).write(
            {'recording_state': 'none'},
        )
