# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, values):
        companies = super().create(values)
        # The trusted branch provisioner runs as the actual operator. A company
        # created after installation needs the same structural library/fence as
        # companies present during post-init; no customer receives DMS config ACLs.
        if self.env.user._is_superuser():
            self.env['webvue.document']._webvue_bootstrap_libraries()
        return companies
