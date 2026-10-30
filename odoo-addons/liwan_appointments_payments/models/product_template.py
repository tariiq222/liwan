# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    # The OCA link from a product to the booking type it sells; one product per type, so the price of a
    # booking type has a single source.
    _liwan_booking_type_unique = models.Constraint(
        'UNIQUE(resource_booking_type_id)', 'a booking type is sold by one product',
    )
