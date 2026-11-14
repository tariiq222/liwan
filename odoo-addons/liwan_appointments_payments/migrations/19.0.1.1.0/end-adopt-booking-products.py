# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger('odoo.addons.liwan_appointments_payments.migrations')


def migrate(cr, version):
    """The products that sell booking types before liwan_products become service products.

    ``liwan.products.service._liwan_adopt`` marks each one and clears its company (shared, the sharing default); every
    booking type keeps its product link, archived products included. From now on a type's product is written only
    through the service.

    An ``end-`` script, so the tax bridge (``liwan_products_account``, auto-installed with the service and ``account``),
    whose ``_liwan_adopt`` normalises the taxes, is loaded whichever order the modules were updated in.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    linked = env['product.template'].with_context(active_test=False).search([('resource_booking_type_id', '!=', False)])
    adopted = env['liwan.products.service']._liwan_adopt(linked.filtered(lambda product: not product.liwan_product))
    _logger.info('liwan_appointments_payments: booking-type products adopted %d', len(adopted))
