# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

# The mapping keys of the API, each one the stem of an ``<key>_account_id`` field.
ACCOUNT_KEYS = (
    'basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable',
    'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision',
)
# The accounts a payment or a recovery is settled against: they must accept reconciliation.
RECONCILING_KEYS = ('salaries_payable', 'advance')


def account_field(key):
    return f'{key}_account_id'


class WebVueHrPayrollFinanceSettings(models.Model):
    """How one company's payroll is booked: the journal, the accounts of each pay element and the
    detail of the entry. A company without a row reads the defaults until its first save."""

    _name = 'webvue.hr.payroll.finance.settings'
    _description = 'WebVue HR payroll finance settings'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    journal_id = fields.Many2one('account.journal', domain="[('type', '=', 'general')]", ondelete='restrict')
    basic_expense_account_id = fields.Many2one('account.account', ondelete='restrict')
    allowance_expense_account_id = fields.Many2one('account.account', ondelete='restrict')
    variable_expense_account_id = fields.Many2one('account.account', ondelete='restrict')
    gosi_expense_account_id = fields.Many2one('account.account', ondelete='restrict')
    gosi_payable_account_id = fields.Many2one('account.account', ondelete='restrict')
    salaries_payable_account_id = fields.Many2one('account.account', ondelete='restrict')
    deduction_account_id = fields.Many2one('account.account', ondelete='restrict')
    advance_account_id = fields.Many2one('account.account', ondelete='restrict')
    eos_expense_account_id = fields.Many2one('account.account', ondelete='restrict')
    eos_provision_account_id = fields.Many2one('account.account', ondelete='restrict')
    default_analytic_account_id = fields.Many2one('account.analytic.account', ondelete='restrict')
    entry_detail = fields.Selection(
        [('aggregated', 'Aggregated'), ('per_employee', 'Per employee')], required=True, default='aggregated',
    )

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one payroll finance settings record')

    @api.constrains('company_id', 'journal_id', 'default_analytic_account_id', *map(account_field, ACCOUNT_KEYS))
    def _check_company_records(self):
        for settings in self:
            company = settings.company_id
            if settings.journal_id and settings.journal_id.company_id != company:
                raise ValidationError(self.env._('The journal must belong to the company.'))
            currency = settings.journal_id.currency_id
            if currency and currency != company.currency_id:
                raise ValidationError(self.env._('The payroll journal must be in the company currency.'))
            analytic = settings.default_analytic_account_id
            if analytic and analytic.company_id != company:
                raise ValidationError(self.env._('The default cost center must belong to the company.'))
            for key in ACCOUNT_KEYS:
                account = settings[account_field(key)]
                if account and company not in account.company_ids:
                    raise ValidationError(self.env._('Every account must belong to the company.'))
            for key in RECONCILING_KEYS:
                account = settings[account_field(key)]
                if account and not account.reconcile:
                    raise ValidationError(self.env._('The payable and advance accounts must allow reconciliation.'))

    @api.model
    def _webvue_for_company(self, company):
        """The stored record, or an unsaved one holding the defaults: reading never writes."""
        stored = self.search([('company_id', '=', company.id)], limit=1)
        return stored or self.new({'company_id': company.id})

    @api.model
    def _webvue_save(self, company, vals):
        """Write the company's record, creating it on the first save."""
        record = self.search([('company_id', '=', company.id)], limit=1)
        if record:
            record.write(vals)
            return record
        return self.create({**vals, 'company_id': company.id})
