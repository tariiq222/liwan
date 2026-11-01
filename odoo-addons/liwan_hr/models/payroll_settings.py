# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

SAUDI_STRUCTURE_CODE = 'SA_MONTHLY'
DEFAULT_REFS = {
    'unpaid_leave_type_ids': 'hr_holidays.leave_type_unpaid',
    'annual_leave_type_id': 'hr_holidays.leave_type_paid_time_off',
}


class LiwanHrPayrollSettings(models.Model):
    """The payroll settings of one company: day divisor, salary structure and the leave types
    payroll reads. A company without a row runs on the defaults until its first save."""

    _name = 'liwan.hr.payroll.settings'
    _description = 'LiwanOS HR payroll settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    day_divisor = fields.Integer(default=30)
    structure_id = fields.Many2one('hr.payroll.structure', ondelete='restrict')
    unpaid_leave_type_ids = fields.Many2many(
        'hr.leave.type', 'liwan_hr_payroll_settings_unpaid_leave_type_rel',
        'settings_id', 'leave_type_id',
    )
    annual_leave_type_id = fields.Many2one('hr.leave.type', ondelete='restrict')
    revision = fields.Integer(required=True, default=1)

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one payroll settings record')
    _day_divisor_valid = models.Constraint(
        'CHECK(day_divisor BETWEEN 28 AND 31)', 'the day divisor must be between 28 and 31',
    )
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.model
    def _liwan_defaults(self, company):
        """The default records of the stock references that exist in this database. The structure is the
        company's own copy of the shipped one (see ``res.company._liwan_ensure_payroll_structure``)."""
        records = {field: self.env.ref(xmlid, raise_if_not_found=False) for field, xmlid in DEFAULT_REFS.items()}
        records['structure_id'] = self.env['hr.payroll.structure'].search([
            ('company_id', '=', company.id), ('code', '=', SAUDI_STRUCTURE_CODE),
        ], limit=1)
        return {field: record for field, record in records.items() if record}

    @api.model
    def _liwan_for_company(self, company):
        """The stored record, or an unsaved one holding the defaults: reading never writes."""
        stored = self.search([('company_id', '=', company.id)], limit=1)
        if stored:
            return stored
        return self.new({'company_id': company.id, 'day_divisor': 30, **self._liwan_defaults(company)})

    @api.model
    def _liwan_save(self, company, vals):
        """Write the company's record and advance its revision, creating it from the defaults on the first save."""
        record = self.search([('company_id', '=', company.id)], limit=1)
        if record:
            record.write({**vals, 'revision': record.revision + 1})
            return record
        defaults = self._liwan_for_company(company)
        base = {
            'company_id': company.id,
            'day_divisor': defaults.day_divisor,
            'structure_id': defaults.structure_id.id,
            'unpaid_leave_type_ids': [(6, 0, defaults.unpaid_leave_type_ids.ids)],
            'annual_leave_type_id': defaults.annual_leave_type_id.id,
        }
        return self.create({**base, **vals})
