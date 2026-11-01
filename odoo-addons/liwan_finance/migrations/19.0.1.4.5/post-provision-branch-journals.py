# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Give every existing branch that has no journal its own journals (see ``res.company._liwan_provision_branch_journals``)."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    env['res.company'].with_context(active_test=False).search([('parent_id', '!=', False)])._liwan_provision_branch_journals()
