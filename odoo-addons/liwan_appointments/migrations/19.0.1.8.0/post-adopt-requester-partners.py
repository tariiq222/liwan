# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger('odoo.addons.liwan_appointments.migrations')


def migrate(cr, version):
    """The partners attached to bookings before liwan_customers become customers (parties).

    ``liwan.customers.service._liwan_adopt`` adopts a partner that is no user's and no company's partner, clears its
    company (customers are shared by default) and normalises its phone; any other stays attached as it is.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    linked = env['resource.booking'].with_context(active_test=False).search([]).partner_ids.with_context(active_test=False)
    adopted, skipped = env['liwan.customers.service']._liwan_adopt(linked.filtered(lambda partner: not partner.liwan_party))
    _logger.info('liwan_appointments: partners attached to bookings adopted %d, skipped %d', len(adopted), len(skipped))
