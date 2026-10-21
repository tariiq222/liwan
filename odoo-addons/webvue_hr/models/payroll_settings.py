# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

DEFAULT_REFS = {
    'structure_id': 'webvue_hr.structure_saudi',
    'unpaid_leave_type_ids': 'hr_holidays.leave_type_unpaid',
    'annual_leave_type_id': 'hr_holidays.leave_type_paid_time_off',
}


class WebVueHrPayrollSettings(models.Model):
    """The payroll settings of one company: day divisor, salary structure and the leave types
    payroll reads. A company without a row runs on the defaults until its first save."""

    _name = 'webvue.hr.payroll.settings'
    _description = 'WebVue HR payroll settings'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    day_divisor = fields.Integer(default=30)
    structure_id = fields.Many2one('hr.payroll.structure', ondelete='restrict')
    unpaid_leave_type_ids = fields.Many2many(
        'hr.leave.type', 'webvue_hr_payroll_settings_unpaid_leave_type_rel',
        'settings_id', 'leave_type_id',
    )
    annual_leave_type_id = fields.Many2one('hr.leave.type', ondelete='restrict')

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one payroll settings record')
    _day_divisor_valid = models.Constraint(
        'CHECK(day_divisor BETWEEN 28 AND 31)', 'the day divisor must be between 28 and 31',
    )

    @api.model
    def _webvue_defaults(self):
        """The default records of the stock references that exist in this database."""
        records = {field: self.env.ref(xmlid, raise_if_not_found=False) for field, xmlid in DEFAULT_REFS.items()}
        return {field: record for field, record in records.items() if record}

    @api.model
    def _webvue_for_company(self, company):
        """The stored record, or an unsaved one holding the defaults: reading never writes."""
        stored = self.search([('company_id', '=', company.id)], limit=1)
        if stored:
            return stored
        return self.new({'company_id': company.id, 'day_divisor': 30, **self._webvue_defaults()})

    @api.model
    def _webvue_save(self, company, vals):
        """Write the company's record, creating it from the defaults on the first save."""
        record = self.search([('company_id', '=', company.id)], limit=1)
        if record:
            record.write(vals)
            return record
        defaults = self._webvue_for_company(company)
        base = {
            'company_id': company.id,
            'day_divisor': defaults.day_divisor,
            'structure_id': defaults.structure_id.id,
            'unpaid_leave_type_ids': [(6, 0, defaults.unpaid_leave_type_ids.ids)],
            'annual_leave_type_id': defaults.annual_leave_type_id.id,
        }
        return self.create({**base, **vals})
