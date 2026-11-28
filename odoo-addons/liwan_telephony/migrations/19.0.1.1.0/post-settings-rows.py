# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Every company gets its telephony settings row at the declared defaults, as a new install does.

    The read routes already answer those defaults for a company without a row; the row makes the retention cron and
    the settings page read one saved record instead of a fallback.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    settings = env['liwan.telephony.settings']
    for company in env['res.company'].with_context(active_test=False).search([]):
        if not settings.search([('company_id', '=', company.id)], limit=1):
            settings.create({'company_id': company.id})
