# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class NasqPlatformResUsers(models.Model):
    _inherit = 'res.users'

    def _login(self, credential, user_agent_env):
        auth_info = super()._login(credential, user_agent_env)
        user = self.browse(auth_info['uid'])
        self.env['nasq.entitlement.service'].sudo()._nasq_assert_login_allowed(user)
        return auth_info
