# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import BOOKINGS_MANAGE

APPOINTMENTS_FEATURE = 'appointments.enabled'


class LiwanAppointmentsProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_feature_keys(self):
        """The product routes are open to a tenant with Appointments."""
        return (*super()._liwan_products_feature_keys(), APPOINTMENTS_FEATURE)

    @api.model
    def _liwan_products_pick_capabilities(self):
        """A booking type's manager picks the service product that sells the type."""
        return (*super()._liwan_products_pick_capabilities(), BOOKINGS_MANAGE)
