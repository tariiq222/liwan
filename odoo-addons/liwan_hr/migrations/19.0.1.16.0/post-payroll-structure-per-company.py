# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Every company gets its own payroll structure and its settings point at it."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    companies = env['res.company'].with_context(active_test=False).search([])
    companies._liwan_ensure_payroll_structure()
    Settings = env['liwan.hr.payroll.settings']
    for settings in Settings.search([]):
        own = Settings._liwan_defaults(settings.company_id).get('structure_id')
        if own and settings.structure_id.company_id != settings.company_id:
            settings.structure_id = own
