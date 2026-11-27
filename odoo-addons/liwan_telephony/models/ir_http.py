# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.http import request

EVENTS_USER = 'liwan_telephony.user_telephony_events'


class LiwanTelephonyIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _auth_method_telephony_events(cls):
        """Run the machine route as the events identity, whatever session the caller sent.

        The identity is active, has no password and sits in no user type, so nobody signs in as it. Its only authority
        is its group's ACL rows (write the call, insert the event receipt), in every company it is a member of.
        Nothing here elevates the environment: the route verifies the caller with the derived key before it writes.
        """
        request.update_env(user=request.env['ir.model.data']._xmlid_to_res_id(EVENTS_USER))
