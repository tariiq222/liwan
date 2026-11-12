# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import BOOKINGS_WRITE

APPOINTMENTS_FEATURE = 'appointments.enabled'


class LiwanAppointmentsCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_feature_keys(self):
        """The customer routes are open to a tenant with Appointments."""
        return (*super()._liwan_customers_feature_keys(), APPOINTMENTS_FEATURE)

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """Booking picks the requester's customer, or creates one."""
        return (*super()._liwan_customers_pick_capabilities(), BOOKINGS_WRITE)
