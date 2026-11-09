# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Prune once the log that predates the retention window, so an existing table stops growing unbounded.

    The field itself needs no backfill: it is required with its default and a 1-60 CHECK, so the column
    arrives filled on every existing settings row and the cron enforces the window from the first run.
    """
    if not version:
        return
    api.Environment(cr, SUPERUSER_ID, {})['liwan.crm.view.log']._liwan_prune()
