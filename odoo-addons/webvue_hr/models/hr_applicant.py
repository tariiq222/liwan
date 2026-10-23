# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError, ValidationError

HIRE_FRAME_ATTRIBUTE = '_webvue_hr_native_recruitment_hire'


class WebVueHrApplicant(models.Model):
    _inherit = 'hr.applicant'

    def _get_employee_create_vals(self):
        vals = super()._get_employee_create_vals()
        vals['company_id'] = self.company_id.id
        return vals

    def _webvue_hire(self):
        """Run the native workflow with owner defaults and the original live policy root."""
        self.ensure_one()
        service = self.env['webvue.access.service']
        self.check_access('write')
        company = self.company_id
        if company.id not in service._webvue_scoped_company_ids() or not all(
            service._webvue_has_capability(self.env.user, key, record=self)
            for key in ('hr.recruitment.manage', 'hr.employees.manage')
        ):
            message = 'recruitment and employee management in the applicant company are required'
            raise AccessError(message)
        existing = service._webvue_native_hire_frame()
        root_id = existing[1] if existing else self.env.company.id
        scopes = self.env.context.get('webvue_capability_scope') or ()
        frame = (self.env.uid, root_id, company.id, self.id, scopes)
        # Native savepoints run and clear precommit callbacks on entry/exit. Keep
        # this lexical frame on the cursor itself until the complete workflow exits.
        previous = getattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, None)
        setattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, frame)
        service._webvue_clear_branch_cache()
        try:
            with self.env.cr.savepoint():
                self.create_employee_from_applicant()
                employee = self.employee_id
                if not employee or employee.company_id != company or self.company_id != company:
                    message = 'the hired employee must belong to the applicant company'
                    raise ValidationError(message)
                return employee
        finally:
            if previous is None:
                delattr(self.env.cr, HIRE_FRAME_ATTRIBUTE)
            else:
                setattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, previous)
            service._webvue_clear_branch_cache()
