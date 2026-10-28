# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.http import request

HOOK_USER = 'webvue_inbox.user_inbox_hook'


class WebVueInboxIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _auth_method_inbox_hook(cls):
        """Run a webhook request as the inactive hook identity, whatever session the caller sent.

        The identity has no password and cannot sign in; its only authority is its group's ACL
        rows (read channels, create events). Nothing here elevates the environment.
        """
        request.update_env(user=request.env['ir.model.data']._xmlid_to_res_id(HOOK_USER))
