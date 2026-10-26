# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from .payroll_math import EOS_CASES

EOS_CASE_SELECTION = [(case, case.replace('_', ' ').capitalize()) for case in EOS_CASES]


class WebVueHrPayrollEosCase(models.Model):
    """Which end-of-service case a departure reason means. The shared seed rows carry no company; a
    company row for the same reason wins over the shared one."""

    _name = 'webvue.hr.payroll.eos.case'
    _description = 'WebVue HR end-of-service case'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', index=True, ondelete='cascade')
    departure_reason_id = fields.Many2one('hr.departure.reason', required=True, ondelete='cascade')
    case = fields.Selection(EOS_CASE_SELECTION, required=True)

    _reason_unique = models.Constraint(
        'UNIQUE(company_id, departure_reason_id)', 'a departure reason maps to one case per company',
    )

    @api.model
    def _webvue_case_for(self, reason, company):
        """The case of a departure reason for a company: its own row first, else the shared one, else False."""
        rows = self.search([
            ('departure_reason_id', '=', reason.id), ('company_id', 'in', [company.id, False]),
        ])
        return (rows.filtered('company_id') or rows)[:1].case or False

    @api.model
    def _webvue_company_row(self, reason, company):
        """The company's own mapping row of a reason (empty when the company has none)."""
        return self.search([('departure_reason_id', '=', reason.id), ('company_id', '=', company.id)], limit=1)

    @api.model
    def _webvue_set_case(self, reason, company, case):
        """Write the company's own mapping of a reason, creating it on the first save."""
        row = self._webvue_company_row(reason, company)
        if row:
            row.case = case
            return row
        return self.create({'departure_reason_id': reason.id, 'company_id': company.id, 'case': case})
