# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.http import request

EVENTS_USER = 'liwan_telephony.user_telephony_events'


class LiwanTelephonyIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _auth_method_telephony_events(cls):
        """Run the machine route as the inactive events identity, after the route itself verified the caller.

        The identity has no password and cannot sign in; its only authority is its group's ACL rows (write the call,
        insert the event receipt). Nothing here elevates the environment, and the derived key check has already run
        by the time the route asks for it.
        """
        request.update_env(user=request.env['ir.model.data']._xmlid_to_res_id(EVENTS_USER))
