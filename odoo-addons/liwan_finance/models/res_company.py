# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

SANDBOX_API_MODE = 'sandbox'
SAUDI_COUNTRY_CODE = 'SA'
GLOBAL_TAX_ROUNDING = 'round_globally'
# A branch shares the chart of accounts of its root and owns its journals: one of each of these kinds, like the root's first.
BRANCH_JOURNAL_TYPES = ('sale', 'purchase', 'general', 'bank', 'cash')
# Stock names the outstanding receipts and payments accounts of a chart by these xml ids, prefixed by the root company id.
OUTSTANDING_RECEIPTS = 'account_journal_payment_debit_account_id'
OUTSTANDING_PAYMENTS = 'account_journal_payment_credit_account_id'


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
        companies = super().create(vals_list)
        companies._liwan_provision_branch_journals()
        return companies

    def _liwan_provision_branch_journals(self):
        """Give each branch without journals its own, modelled on its root's, over the root's shared chart.

        Stock loads only the company record into a branch and leaves it to use its parent's journals, which the
        branch's own finance staff cannot read, so a branch-only user could not invoice or pay. The sale and purchase
        journals keep the root's default account; bank and cash journals get a liquidity account of their own, as
        stock makes for any new bank journal, and their payment method lines point at the root's outstanding accounts.
        """
        Journal = self.env['account.journal']
        for branch in self.filtered('parent_id'):
            root = branch.root_id
            if Journal.with_context(active_test=False).search_count([('company_id', '=', branch.id)], limit=1):
                continue
            receipts = self.env.ref(f'account.{root.id}_{OUTSTANDING_RECEIPTS}', raise_if_not_found=False)
            payments = self.env.ref(f'account.{root.id}_{OUTSTANDING_PAYMENTS}', raise_if_not_found=False)
            for journal_type in BRANCH_JOURNAL_TYPES:
                source = Journal.search([('company_id', '=', root.id), ('type', '=', journal_type)], order='sequence, id', limit=1)
                if not source:
                    continue
                values = {'name': source.name, 'code': source.code, 'type': journal_type, 'company_id': branch.id}
                if journal_type in ('sale', 'purchase'):
                    values['default_account_id'] = source.default_account_id.id
                journal = Journal.with_company(branch).create(values)
                for line in journal.inbound_payment_method_line_ids.filtered(lambda line: not line.payment_account_id and receipts):
                    line.payment_account_id = receipts
                for line in journal.outbound_payment_method_line_ids.filtered(lambda line: not line.payment_account_id and payments):
                    line.payment_account_id = payments

    @api.model
    def _liwan_company_profile_extensions(self):
        """The Saudi e-invoicing identity (stock ``l10n_sa_edi`` fields) joins the company profile."""
        return [
            *super()._liwan_company_profile_extensions(),
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
