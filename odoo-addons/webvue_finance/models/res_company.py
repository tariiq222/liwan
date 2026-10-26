# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

SANDBOX_API_MODE = 'sandbox'
SAUDI_COUNTRY_CODE = 'SA'
GLOBAL_TAX_ROUNDING = 'round_globally'


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if 'tax_calculation_rounding_method' in vals:
                continue
            country = self.env['res.country'].browse(
                vals.get('account_fiscal_country_id') or vals.get('country_id'),
            )
            if country.code == SAUDI_COUNTRY_CODE:
                vals['tax_calculation_rounding_method'] = GLOBAL_TAX_ROUNDING
        return super().create(vals_list)

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

    @api.constrains('tax_calculation_rounding_method', 'account_fiscal_country_id', 'country_id')
    def _check_saudi_tax_calculation_rounding(self):
        """Saudi VAT is rounded per invoice, never per line."""
        for company in self:
            fiscal_country = company.account_fiscal_country_id or company.country_id
            if (
                fiscal_country.code == SAUDI_COUNTRY_CODE
                and company.tax_calculation_rounding_method != GLOBAL_TAX_ROUNDING
            ):
                raise ValidationError(self.env._(
                    'Saudi companies must calculate taxes globally at invoice level.',
                ))

    @api.constrains('l10n_sa_api_mode')
    def _check_zatca_api_mode_is_sandbox(self):
        """No company leaves the ZATCA sandbox until the simulation and production policy is approved.

        Stock EDI cron sends every pending document in the company's own api mode, so the routes'
        refusal alone cannot confine it; the mode itself is confined here.
        """
        for company in self:
            if company.l10n_sa_api_mode != SANDBOX_API_MODE:
                raise ValidationError(self.env._(
                    'Only the ZATCA sandbox api mode is allowed until the simulation and production policy is approved.',
                ))
