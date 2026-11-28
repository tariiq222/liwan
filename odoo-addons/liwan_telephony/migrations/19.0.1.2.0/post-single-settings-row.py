# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Exactly one settings row is left: the record ``data/telephony_settings.xml`` installs.

    A per-company row never was a tenant policy — each company answered its own values while the pbx enforced one
    policy for all of them — so the leftover rows are deleted rather than folded into the one row. The installed row
    keeps the declared defaults, as a new install does.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    settings = env['liwan.telephony.settings']
    installed = env.ref('liwan_telephony.telephony_settings')
    (settings.search([]) - installed).unlink()
