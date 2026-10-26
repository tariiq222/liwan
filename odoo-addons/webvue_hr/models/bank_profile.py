# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueHrPayrollBankProfile(models.Model):
    """The layout of one salary file: delimiter, encoding and the ordered columns.

    Bank and WPS layouts are data, never code: the shared seed rows carry no company, a company
    adds its own for a bank that wants another layout. A shared row is read-only for everyone.
    """

    _name = 'webvue.hr.payroll.bank.profile'
    _description = 'WebVue HR salary file profile'
    _order = 'kind, name, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', index=True, ondelete='cascade')
    name = fields.Char(required=True)
    kind = fields.Selection([('bank', 'Bank salary file'), ('wps', 'WPS file')], required=True, default='bank')
    delimiter = fields.Selection([(',', 'Comma'), (';', 'Semicolon'), ('\t', 'Tab'), ('|', 'Pipe')], required=True, default=',')
    encoding = fields.Selection([('utf-8', 'UTF-8'), ('utf-8-sig', 'UTF-8 with BOM')], required=True, default='utf-8')
    include_header = fields.Boolean(default=True)
    footer = fields.Selection([('none', 'None'), ('totals', 'Totals')], required=True, default='none')
    column_ids = fields.One2many('webvue.hr.payroll.bank.profile.column', 'profile_id', copy=True)
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')


class WebVueHrPayrollBankProfileColumn(models.Model):
    """One ordered column of a salary file profile; it carries no company of its own."""

    _name = 'webvue.hr.payroll.bank.profile.column'
    _description = 'WebVue HR salary file profile column'
    _order = 'profile_id, sequence, id'
    _webvue_scope = 'global'

    profile_id = fields.Many2one('webvue.hr.payroll.bank.profile', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    source = fields.Selection([
        ('employee_ref', 'Employee reference'),
        ('identification', 'Identification number'),
        ('name', 'Employee name'),
        ('iban', 'IBAN'),
        ('bank_code', 'Bank code'),
        ('basic', 'Basic wage'),
        ('housing', 'Housing allowance'),
        ('other_allowances', 'Other allowances'),
        ('deductions', 'Deductions'),
        ('net', 'Net pay'),
        ('value_date', 'Value date'),
        ('constant', 'Constant'),
    ], required=True)
    label = fields.Char(required=True)
    constant_value = fields.Char()
