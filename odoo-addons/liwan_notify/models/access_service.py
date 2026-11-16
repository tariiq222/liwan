# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Changing the sending domain changes the identity of every outgoing email (spec 6.1): no other capability implies it
# and no built-in role holds it, system_admin included; a system admin gives it to a role.
MAIL_DOMAIN_MANAGE = 'mail.domain.manage'


class LiwanNotifyAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + ({'key': MAIL_DOMAIN_MANAGE, 'owner': 'liwan_notify'},)
