# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import ForeignKeyViolation

from odoo import fields, models

from odoo.addons.webvue_hr.models.payroll_file import PROFILE_FK
from odoo.addons.webvue_hr.rules import WebVueHrRule

PROFILE_IN_USE_CODE = 'profile_in_use'


def _profile_in_use_refusal(profile, kept_files=0):
    """The 409 ``profile_in_use`` refusal of deleting a profile a kept salary file still names."""
    return WebVueHrRule(
        PROFILE_IN_USE_CODE,
        profile.env._('This salary file profile is kept by a generated salary file, so it cannot be deleted.'),
        status=409,
        details={'file_count': kept_files} if kept_files else None,
    )


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

    def _webvue_delete(self):
        """Delete one own profile, refusing while a kept salary file names it (409 ``profile_in_use``).

        A salary file keeps the layout that rendered it (owner decision D-4), so its profile stays. The count
        below is the ordinary refusal; the database's own foreign key answers a file kept between it and the
        delete, and only that profile key is translated. The delete goes through the public ``unlink``, so a
        refusal raised there keeps its own error and rolls the caller's audit row back.
        """
        self.ensure_one()
        kept = self.env['webvue.hr.payroll.file'].search_count([('profile_id', '=', self.id)])
        if kept:
            raise _profile_in_use_refusal(self, kept)
        try:
            with self.env.cr.savepoint():
                return self.unlink()
        except ForeignKeyViolation as error:
            if error.diag.constraint_name != PROFILE_FK:
                raise
            raise _profile_in_use_refusal(self) from None


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
