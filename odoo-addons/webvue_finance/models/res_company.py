# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

SANDBOX_API_MODE = 'sandbox'


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model
    def _webvue_company_profile_extensions(self):
        """The Saudi e-invoicing identity (stock ``l10n_sa_edi`` fields) joins the company profile."""
        return [
            *super()._webvue_company_profile_extensions(),
            {
                'name': 'l10n_sa_edi_building_number', 'section': 'address', 'kind': 'text',
                'label': self.env._('Building number'), 'inputmode': 'numeric',
            },
            {
                'name': 'l10n_sa_edi_plot_identification', 'section': 'address', 'kind': 'text',
                'label': self.env._('Additional number'), 'inputmode': 'numeric',
            },
            {
                'name': 'l10n_sa_edi_additional_identification_scheme', 'section': 'identity', 'kind': 'selection',
                'label': self.env._('Additional identifier type'),
            },
            {
                'name': 'l10n_sa_edi_additional_identification_number', 'section': 'identity', 'kind': 'text',
                'label': self.env._('Additional identifier number'),
            },
        ]

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
