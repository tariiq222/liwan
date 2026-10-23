# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

from .leave_cancellation import PENDING_PROBE_MARKER


class WebVueHrIrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _webvue_fresh_company_domain(self, model_name, mode):
        domain = super()._webvue_fresh_company_domain(model_name, mode)
        if (model_name == 'hr.version' and mode == 'read' and not self.env.su
                and not self.env.user.has_group('base.group_system')):
            # Native has_access/_filtered_access call _check_access directly;
            # public check_access overrides do not protect attachment targets.
            companies = self.env['hr.version']._webvue_version_read_company_ids()
            domain &= Domain('company_id', 'in', companies)
        if (model_name in {'hr.leave', 'hr.leave.allocation'} and mode == 'read' and not self.env.su
                and not self.env.user.has_group('base.group_system')):
            # Native staff rules use globally unioned groups. Recheck staff rights
            # in each owning company after native caching, including inheritance revocation.
            service = self.env['webvue.access.service']
            staff_ids = set()
            # hr_payroll_rules.xml:162-178 explicitly opens leave data to
            # payroll readers for the existing engine, in their owning companies.
            for key in ('hr.leave.approve', 'hr.leave.manage', 'hr.payroll.read'):
                staff_ids.update(service._webvue_operation_capability_company_ids(key))
            # Stock hr.leave.allocation owns employee_company_id (stored related),
            # not company_id: hr_leave_allocation.py:74-77. Keep own requests inside
            # the declared model/company scope too, including foreign memberships.
            owner_field = 'employee_company_id' if model_name == 'hr.leave.allocation' else 'company_id'
            companies = service._webvue_model_company_ids(model_name, mode)
            domain &= (Domain(owner_field, 'in', companies)
                       & (Domain(owner_field, 'in', sorted(staff_ids))
                          | Domain('employee_id.user_id', '=', self.env.uid)))
        return domain

    def _compute_domain_context_values(self):
        yield from super()._compute_domain_context_values()
        # Record-rule domains are cached beyond a cursor marker's lifetime.
        # Keep the private exact-leave boolean probe out of ordinary rule keys;
        # client context cannot create or reuse this cursor-only marker.
        yield tuple(sorted(self.env.cr.precommit.data.get(PENDING_PROBE_MARKER, ())))
