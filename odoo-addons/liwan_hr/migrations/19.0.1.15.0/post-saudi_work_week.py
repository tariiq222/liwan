# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Saudi companies that predate the schedule get the Sunday to Thursday default (once per company)."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['res.company'].with_context(active_test=False).search([])._liwan_ensure_saudi_schedule()
