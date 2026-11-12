# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, ValidationError

HIRE_FRAME_ATTRIBUTE = '_liwan_hr_native_recruitment_hire'


class LiwanHrApplicant(models.Model):
    _inherit = 'hr.applicant'

    # A commercial party (liwan_customers' ``liwan_party``, present only when that service is installed) has one
    # writer, the customers service. Stock links an applicant to the partner of its email and then writes the
    # applicant's name, email and phone onto that partner, so an applicant never resolves to a party: it gets a
    # contact of its own.

    def _liwan_is_party(self, partner):
        return 'liwan_party' in partner._fields and partner.liwan_party

    def _partner_find_from_emails(self, records_emails, avoid_alias=True, ban_emails=None,
                                  filter_found=None, additional_values=None, no_create=False):
        def not_a_party(partner):
            return not self._liwan_is_party(partner) and (not filter_found or filter_found(partner))

        return super()._partner_find_from_emails(
            records_emails, avoid_alias=avoid_alias, ban_emails=ban_emails, filter_found=not_a_party,
            additional_values=additional_values, no_create=no_create,
        )

    def _inverse_partner_email(self):
        self.filtered(lambda applicant: self._liwan_is_party(applicant.partner_id)).partner_id = False
        return super()._inverse_partner_email()

    def _get_employee_create_vals(self):
        vals = super()._get_employee_create_vals()
        vals['company_id'] = self.company_id.id
        manager = self._liwan_department_manager()
        if manager:
            vals['parent_id'] = manager.id
        return vals

    def _liwan_department_manager(self):
        """The manager of the applicant's department, who becomes the new employee's manager.

        Read only for a recruiter who may read departments: recruitment does not imply that capability.
        """
        service = self.env['liwan.access.service']
        if not service._liwan_has_capability(self.env.user, 'hr.departments.read', record=self):
            return self.env['hr.employee']
        return self.department_id.manager_id

    def _liwan_hire(self):
        """Run the native workflow with owner defaults and the original live policy root."""
        self.ensure_one()
        service = self.env['liwan.access.service']
        self.check_access('write')
        company = self.company_id
        if company.id not in service._liwan_scoped_company_ids() or not all(
            service._liwan_has_capability(self.env.user, key, record=self)
            for key in ('hr.recruitment.manage', 'hr.employees.manage')
        ):
            message = 'recruitment and employee management in the applicant company are required'
            raise AccessError(message)
        existing = service._liwan_native_hire_frame()
        root_id = existing[1] if existing else self.env.company.id
        scopes = self.env.context.get('liwan_capability_scope') or ()
        frame = (self.env.uid, root_id, company.id, self.id, scopes)
        # Native savepoints run and clear precommit callbacks on entry/exit. Keep
        # this lexical frame on the cursor itself until the complete workflow exits.
        previous = getattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, None)
        setattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, frame)
        service._liwan_clear_branch_cache()
        try:
            with self.env.cr.savepoint():
                self.create_employee_from_applicant()
                employee = self.employee_id
                if not employee or employee.company_id != company or self.company_id != company:
                    message = 'the hired employee must belong to the applicant company'
                    raise ValidationError(message)
                # Stock links the employee but leaves the applicant open unless the stage is a
                # hired stage; a hired applicant is closed, which is what `hired` status reads.
                if not self.date_closed:
                    self.date_closed = fields.Datetime.now()
                return employee
        finally:
            if previous is None:
                delattr(self.env.cr, HIRE_FRAME_ATTRIBUTE)
            else:
                setattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, previous)
            service._liwan_clear_branch_cache()
