# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanHrPayslipPayment(models.Model):
    """Where the salary of one approved payslip is paid: IBAN, bank code and identification number at approval.

    The salary files read this row and never the live compensation or employee version (owner decision D-4). It is
    payroll data of the payslip's own company. Field ``groups`` on ``hr.payslip`` cannot say that: Odoo checks field
    groups against the user's global groups, so a payroll reader of one company who only reads employees in another
    would read the snapshot of their own approved payslip there. As a model of its own the row answers the payroll
    ACL (read for ``hr.payroll.read``, create for ``hr.payroll.approve``, no write or unlink for anyone), which the
    native company fence projects per company, like ``liwan.hr.compensation``; an employee reading their own
    payslip has no access to it at all.

    Every payslip of an approved run has exactly one row, an empty one when the employee had nothing on file: the
    row itself records that the payment data was fixed, so nothing ever fills it from live data afterwards.
    """

    _name = 'liwan.hr.payslip.payment'
    _description = 'LiwanOS HR payslip payment snapshot'
    _liwan_scope = 'company'

    payslip_id = fields.Many2one('hr.payslip', required=True, index=True, ondelete='cascade', readonly=True)
    company_id = fields.Many2one(related='payslip_id.company_id', store=True, index=True)
    iban = fields.Char(string='Paid IBAN', readonly=True)
    bank_code = fields.Char(string='Paid bank code', readonly=True)
    identification = fields.Char(string='Paid identification number', readonly=True)

    _payslip_unique = models.Constraint('UNIQUE(payslip_id)', 'a payslip has one payment snapshot')

    @api.model
    def _liwan_by_payslip(self, payslips):
        """``{payslip_id: snapshot}`` of ``payslips``; a payslip without a snapshot is absent."""
        return {row.payslip_id.id: row for row in self.search([('payslip_id', 'in', payslips.ids)])}

    @api.model
    def _liwan_snapshot(self, payslips):
        """Store, for each of ``payslips``, the IBAN, bank code and identification number it is paid to now."""
        compensations = self.env['liwan.hr.compensation'].search([('employee_id', 'in', payslips.employee_id.ids)])
        by_employee = {record.employee_id.id: record for record in compensations}
        empty = self.env['liwan.hr.compensation']
        return self.create([{
            'payslip_id': payslip.id,
            'iban': by_employee.get(payslip.employee_id.id, empty).iban,
            'bank_code': by_employee.get(payslip.employee_id.id, empty).bank_id.bic,
            'identification': payslip.employee_id.current_version_id.identification_id,
        } for payslip in payslips])
