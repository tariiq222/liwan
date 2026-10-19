# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

SANDBOX_API_MODE = 'sandbox'


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.constrains('l10n_sa_api_mode')
    def _check_zatca_api_mode_is_sandbox(self):
        """No company leaves the ZATCA sandbox until the simulation and production policy is approved.

        The stock EDI cron sends every pending document in the company's own api mode, so the routes'
        refusal alone cannot confine it; the mode itself is confined here.
        """
        for company in self:
            if company.l10n_sa_api_mode != SANDBOX_API_MODE:
                raise ValidationError(self.env._(
                    'Only the ZATCA sandbox api mode is allowed until the simulation and production policy is approved.',
                ))
