# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    # Resolve eligibility only once all installed addons have registered their service accounts.
    env['liwan.entitlement.service']._liwan_settle_excess()
