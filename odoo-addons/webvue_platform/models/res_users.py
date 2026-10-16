# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePlatformResUsers(models.Model):
    _inherit = 'res.users'

    def _webvue_user_quota_delta(self, vals_list=None, records=None, write_vals=None):
        service = self.env['webvue.entitlement.service'].sudo()
        excluded = set(service._webvue_excluded_user_ids())
        delta = 0
        if vals_list:
            for vals in vals_list:
                active = vals.get('active', True)
                share = vals.get('share', False)
                if active and not share:
                    delta += 1
        if records is not None and write_vals:
            if write_vals.get('active') is True:
                delta += len(records.filtered(lambda user: not user.active and user.id not in excluded and not user.share))
            if write_vals.get('active') is False:
                delta -= len(records.filtered(lambda user: user.active and user.id not in excluded and not user.share))
            if write_vals.get('share') is True:
                delta -= len(records.filtered(lambda user: user.active and not user.share and user.id not in excluded))
        if delta:
            service._webvue_claim_users(delta)
        return delta

    @api.model_create_multi
    def create(self, vals_list):
        self._webvue_user_quota_delta(vals_list=vals_list)
        return super().create(vals_list)

    def write(self, vals):
        self._webvue_user_quota_delta(records=self, write_vals=vals)
        return super().write(vals)

    def _webvue_access_create(self, vals, capability='access.users.grant'):
        self._webvue_user_quota_delta(vals_list=[vals])
        return super()._webvue_access_create(vals, capability=capability)

    def _webvue_access_write(self, vals, capability):
        self._webvue_user_quota_delta(records=self, write_vals=vals)
        return super()._webvue_access_write(vals, capability=capability)

    def _login(self, credential, user_agent_env):
        auth_info = super()._login(credential, user_agent_env)
        user = self.browse(auth_info['uid'])
        self.env['webvue.entitlement.service'].sudo()._webvue_assert_login_allowed(user)
        return auth_info
