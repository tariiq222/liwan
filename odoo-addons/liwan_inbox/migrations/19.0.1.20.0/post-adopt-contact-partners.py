# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger('odoo.addons.liwan_inbox.migrations')


def migrate(cr, version):
    """The partners a checkout linked to contacts before liwan_customers become customers (parties).

    ``liwan.customers.service._liwan_adopt`` adopts a partner that is no user's and no company's partner, clears its
    company (customers are shared by default) and normalises its phone; any other stays linked as it is.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    cr.execute('SELECT DISTINCT partner_id FROM liwan_inbox_contact WHERE partner_id IS NOT NULL')
    linked = env['res.partner'].browse([row[0] for row in cr.fetchall()]).with_context(active_test=False)
    adopted, skipped = env['liwan.customers.service']._liwan_adopt(linked.filtered(lambda partner: not partner.liwan_party))
    _logger.info('liwan_inbox: partners linked to contacts adopted %d, skipped %d', len(adopted), len(skipped))
