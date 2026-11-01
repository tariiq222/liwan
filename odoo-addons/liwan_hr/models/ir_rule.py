# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

# The payslip models fenced per payroll company, with the path from each to its payslip. OCA hr.payslip.line
# copies hr.salary.rule's company_id (payroll/models/hr_salary_rule.py:44-48, the computing environment's
# company), never the payslip's, so a line answers through its slip (payroll/models/hr_payslip_line.py:13-15).
PAYSLIP_PATHS = {'hr.payslip': '', 'hr.payslip.line': 'slip_id.'}


class LiwanHrIrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _liwan_fresh_company_domain(self, model_name, mode):
        domain = super()._liwan_fresh_company_domain(model_name, mode)
        if (model_name == 'hr.version' and mode == 'read' and not self.env.su
                and not self.env.user.has_group('base.group_system')):
            # Native has_access/_filtered_access call _check_access directly;
            # public check_access overrides do not protect attachment targets.
            companies = self.env['hr.version']._liwan_version_read_company_ids()
            domain &= Domain('company_id', 'in', companies)
        if (model_name in {'hr.leave', 'hr.leave.allocation'} and mode == 'read' and not self.env.su
                and not self.env.user.has_group('base.group_system')):
            # Native staff rules use globally unioned groups. Recheck staff rights
            # in each owning company after native caching, including inheritance revocation.
            service = self.env['liwan.access.service']
            staff_ids = set()
            # hr_payroll_rules.xml:162-178 explicitly opens leave data to
            # payroll readers for the existing engine, in their owning companies.
            for key in ('hr.leave.approve', 'hr.leave.manage', 'hr.payroll.read'):
                staff_ids.update(service._liwan_operation_capability_company_ids(key))
            # Stock hr.leave.allocation owns employee_company_id (stored related),
            # not company_id: hr_leave_allocation.py:74-77. Keep own requests inside
            # the declared model/company scope too, including foreign memberships.
            owner_field = 'employee_company_id' if model_name == 'hr.leave.allocation' else 'company_id'
            companies = service._liwan_model_company_ids(model_name, mode)
            # A user's own request follows their stored membership, as in stock
            # hr_holidays: base.group_user grants the read ACL, and the descendant
            # projection never adds that internal baseline to a branch company, so the
            # staff gate alone would hide an inherited branch owner's own leave.
            memberships = service._liwan_membership_company_ids()
            extra = self._liwan_leave_extra_read_domain() if model_name == 'hr.leave' else Domain.FALSE
            domain &= ((Domain('employee_id.user_id', '=', self.env.uid)
                        & Domain(owner_field, 'in', memberships))
                       | (Domain(owner_field, 'in', companies)
                          & Domain(owner_field, 'in', sorted(staff_ids)))
                       | extra)
        if (model_name in PAYSLIP_PATHS and mode == 'read' and not self.env.su
                and not self.env.user.has_group('base.group_system')):
            domain &= self._liwan_payslip_read_fence(PAYSLIP_PATHS[model_name])
        if model_name == 'liwan.hr.warning' and mode == 'read' and not self.env.su \
                and not self.env.user.has_group('base.group_system'):
            domain &= self._liwan_warning_read_fence()
        if model_name == 'liwan.hr.leave.settings' and not self.env.su:
            service = self.env['liwan.access.service']
            companies = set()
            for key in ('hr.leave.read', 'hr.leave.config'):
                companies.update(service._liwan_operation_capability_company_ids(key))
            domain &= Domain('company_id', 'in', sorted(companies))
        if model_name == 'liwan.hr.leave.cancellation' and not self.env.su:
            # Aggregate history requires its own actor grant and the native leave
            # visibility, reevaluated after every policy change outside ir.rule's cache.
            domain &= (self.env['liwan.hr.leave.cancellation']._liwan_visibility_domain()
                       & Domain('leave_id', 'in', self.env['hr.leave']._search([])))
        return domain

    @api.model
    def _liwan_warning_read_fence(self):
        """Warnings are read by the readers of their company, by their subject, and by the manager who drafted them.

        The drafter's right ends with his authority: it needs the company's manager policy now and his being the
        employee's direct manager now, so flipping the policy or moving the employee takes the warning back.
        """
        readers = self.env['liwan.access.service']._liwan_operation_capability_company_ids('hr.warnings.read')
        fence = Domain('company_id', 'in', sorted(readers)) | Domain('employee_user_id', '=', self.env.uid)
        company = self.env.company
        policy = self.env['liwan.hr.warning.settings']._liwan_effective(company)
        if policy['warnings_issued_by'] == 'manager_and_hr':
            fence |= (Domain('create_uid', '=', self.env.uid) & Domain('company_id', '=', company.id)
                      & Domain('employee_id.parent_id.user_id', '=', self.env.uid))
        return fence

    @api.model
    def _liwan_leave_extra_read_domain(self):
        """Leaves readable beyond the actor's own and their staff scope; a bridge may widen it narrowly."""
        return Domain.FALSE

    @api.model
    def _liwan_payslip_read_fence(self, slip):
        """Payroll readers read their payroll companies; an employee reads their own approved payslips.

        The payroll groups and the native (1, '=', 1) payroll read rules are unioned across companies, and the
        employee read ACL opens hr.payslip in every company holding it, so the native rules alone would let a
        payroll reader of one company read every payslip of another company where they only read employees.
        Each branch is rechecked per owning company, after the native cache. ``slip`` is the path to the payslip.
        """
        service = self.env['liwan.access.service']
        payroll = service._liwan_operation_capability_company_ids('hr.payroll.read')
        employee = service._liwan_operation_capability_company_ids('hr.employees.read')
        return (Domain(f'{slip}company_id', 'in', payroll)
                | (Domain(f'{slip}employee_id.user_id', '=', self.env.uid)
                   & Domain(f'{slip}state', '=', 'done')
                   & Domain(f'{slip}company_id', 'in', employee)))
