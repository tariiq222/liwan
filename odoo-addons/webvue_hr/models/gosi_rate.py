# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import Decimal

from odoo import api, fields, models

from .payroll_math import GosiRate


class WebVueHrGosiRate(models.Model):
    """One GOSI contribution rate (percent) of one branch and nationality class from a date on.

    The rates are data, never code: the shared seed rows carry no company, a company adds
    its own rows (for instance the GCC classes) and a company row wins over a shared row
    that starts on the same day.
    """

    _name = 'webvue.hr.gosi.rate'
    _description = 'WebVue HR GOSI rate'
    _order = 'nationality_class, branch, date_from desc, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', index=True, ondelete='cascade')
    currency_id = fields.Many2one('res.currency', compute='_compute_currency_id')
    branch = fields.Selection([
        ('annuities', 'Annuities'),
        ('saned', 'SANED'),
        ('hazards', 'Occupational hazards'),
    ], required=True)
    nationality_class = fields.Selection([
        ('saudi_before_2024', 'Saudi registered before 3 July 2024'),
        ('saudi_from_2024', 'Saudi registered from 3 July 2024'),
        ('non_saudi', 'Non-Saudi'),
        ('gcc', 'GCC national'),
    ], required=True)
    date_from = fields.Date(required=True)
    employee_rate = fields.Float(digits=(6, 4))
    employer_rate = fields.Float(digits=(6, 4))
    wage_min = fields.Monetary(currency_field='currency_id')
    wage_max = fields.Monetary(currency_field='currency_id')

    _rate_unique = models.Constraint(
        'UNIQUE(company_id, branch, nationality_class, date_from)',
        'a rate already starts on that date for this branch and class',
    )
    _rate_valid = models.Constraint(
        'CHECK(employee_rate >= 0 AND employer_rate >= 0 AND wage_max >= wage_min)',
        'rates must not be negative and the maximum wage must reach the minimum',
    )

    @api.depends('company_id')
    def _compute_currency_id(self):
        for rate in self:
            rate.currency_id = (rate.company_id or self.env.company).currency_id

    @api.model
    def _webvue_rates_for(self, nationality_class, day):
        """Per branch the rate in force on ``day``: the latest start date, company row before shared row."""
        candidates = self.search([
            ('nationality_class', '=', nationality_class),
            ('date_from', '<=', day),
            ('company_id', 'in', [False, self.env.company.id]),
        ])
        rates = {}
        for rate in candidates.sorted(lambda row: (row.date_from, bool(row.company_id))):
            rates[rate.branch] = rate
        return rates

    def _webvue_as_rate(self):
        """The pure-arithmetic view of this row for ``payroll_math``."""
        self.ensure_one()
        return GosiRate(
            Decimal(str(self.employee_rate)), Decimal(str(self.employer_rate)),
            Decimal(str(self.wage_min)), Decimal(str(self.wage_max)),
        )
