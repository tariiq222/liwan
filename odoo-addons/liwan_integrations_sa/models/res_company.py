# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        # A company made after this addon's install (a second company, a branch) gets its default links at
        # once, the same rows module data seeds for the companies that existed then (A9-F11).
        self._liwan_provisioning_env()['liwan.integration.connection']._liwan_ensure_default_connections(companies)
        return companies

    def _liwan_provisioning_env(self):
        """The elevated environment of the per-company seed, which also sees archived rows to stay idempotent.

        The same shape as `liwan_pmo.models.res_company._liwan_provisioning_env`: core `res.company.create`
        admits only a Settings administrator, who need not hold `integrations.manage` (whose ACL row is the only
        create right on `liwan.integration.connection`). The seed writes nothing but the company, kind and
        provider columns of its own default rows.
        """
        return self.sudo().with_context(active_test=False).env
