# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Make the partners Finance listed before liwan_customers into commercial parties.

    The old Finance filter selected every partner with no user that is no company's partner and no employee work
    contact. ``_liwan_adopt`` marks them, clears their company (the default sharing) and skips a family that holds
    an account or an employee work contact. A partner already a party is not selected again, so a second run adopts
    nothing.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    partners = env['res.partner'].with_context(active_test=False)
    domain = [
        ('liwan_party', '=', False),
        ('user_ids', '=', False),
        ('id', 'not in', list(env['res.company']._liwan_company_partner_ids())),
    ]
    adopted, skipped = env['liwan.customers.service']._liwan_adopt(partners.search(domain))
    _logger.info('liwan_finance: adopted %d partners as customers, skipped %d', len(adopted), len(skipped))
