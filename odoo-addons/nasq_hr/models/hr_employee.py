# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError
from odoo.tools import email_normalize

from odoo.addons.nasq_api.controllers.common import (
    MIN_PASSWORD_LENGTH,
    clear_security_caches_after_commit,
)
from odoo.addons.nasq_hr.rules import NasqHrRule

ROLE_XMLIDS = {
    'employee': 'nasq_core.group_employee',
    'admin': 'nasq_core.group_customer_admin',
}
NASQ_ROLE_XMLIDS = tuple(ROLE_XMLIDS.values()) + ('nasq_core.group_vendor_support',)
EMPLOYEE_WRITE_ERROR = 'only a customer administrator can write employees'
EMPLOYEE_SCOPE_ERROR = 'employee is outside the current company'
WEAK_PASSWORD_CODE = 'weak_password'
INVALID_ROLE_CODE = 'invalid_role'
VENDOR_PROTECTED_CODE = 'vendor_protected'
INVALID_FIELD_CODE = 'invalid_field'
SELF_DEACTIVATE_CODE = 'self_deactivate'
ROLE_CONFLICT_CODE = 'role_conflict'
LOGIN_TAKEN_CODE = 'login_taken'
SELF_ROLE_CODE = 'self_role'
EMPLOYEE_ARCHIVED_CODE = 'employee_archived'
EMAIL_REQUIRED_CODE = 'email_required'
ACCESS_EXISTS_CODE = 'access_exists'
ACCESS_MISSING_CODE = 'access_missing'


class NasqHrEmployee(models.Model):
    _inherit = 'hr.employee'

    def _nasq_require_admin(self):
        if not self.env.user.has_group('nasq_core.group_customer_admin'):
            raise AccessError(EMPLOYEE_WRITE_ERROR)

    def _nasq_validate_scope(self):
        if any(employee.company_id not in self.env.companies for employee in self):
            raise AccessError(EMPLOYEE_SCOPE_ERROR)

    def _nasq_validate_mutation(self):
        self._nasq_require_admin()
        self._nasq_validate_scope()

    @staticmethod
    def _nasq_normalize_email(value):
        if not isinstance(value, str):
            return False
        value = value.strip()
        return email_normalize(value) if value else False

    @staticmethod
    def _nasq_password(value):
        if not isinstance(value, str):
            raise NasqHrRule(WEAK_PASSWORD_CODE, 'password must be at least 8 characters', field='password')
        value = value.strip()
        if len(value) < MIN_PASSWORD_LENGTH:
            raise NasqHrRule(WEAK_PASSWORD_CODE, 'password must be at least 8 characters', field='password')
        return value

    def _nasq_validate_role(self, role):
        if role not in ROLE_XMLIDS:
            raise NasqHrRule(INVALID_ROLE_CODE, 'role must be employee or admin', field='role')

    def _nasq_validate_vendor(self):
        if any(employee.user_id and employee.user_id.has_group('nasq_core.group_vendor_support') for employee in self):
            raise NasqHrRule(
                VENDOR_PROTECTED_CODE, 'vendor-linked employees cannot be changed from nasq', status=403,
            )

    def _nasq_create(self, vals):
        self._nasq_require_admin()
        company_id = vals.get('company_id') or self.env.company.id
        company = self.env['res.company'].browse(company_id)
        if not company.exists() or company not in self.env.companies:
            raise AccessError(EMPLOYEE_SCOPE_ERROR)
        vals = dict(vals)
        vals['company_id'] = company.id
        vals.pop('user_id', None)
        with self.env.cr.savepoint():
            return super().create(vals)

    def _nasq_write(self, vals):
        self._nasq_validate_mutation()
        vals = dict(vals)
        if 'user_id' in vals or 'active' in vals:
            raise NasqHrRule(INVALID_FIELD_CODE, 'user access is managed by the access actions', field='user_id')
        with self.env.cr.savepoint():
            return super().write(vals)

    def _nasq_archive(self):
        self._nasq_validate_mutation()
        if any(employee.user_id == self.env.user for employee in self):
            raise NasqHrRule(SELF_DEACTIVATE_CODE, 'an administrator cannot deactivate themselves', status=422)
        self._nasq_validate_vendor()
        with self.env.cr.savepoint():
            self.write({'active': False})
            users = self.mapped('user_id')
            if users:
                users.write({'active': False})
        if users:
            clear_security_caches_after_commit(self.env)
        return True

    def _nasq_unarchive(self):
        self._nasq_require_admin()
        self._nasq_validate_scope()
        with self.env.cr.savepoint():
            self.write({'active': True})
        return True

    def _nasq_existing_role(self, user):
        if user.has_group('nasq_core.group_vendor_support'):
            return 'vendor'
        if user.has_group('nasq_core.group_customer_admin'):
            return 'admin'
        if user.has_group('nasq_core.group_employee'):
            return 'employee'
        return 'employee'

    def _nasq_role_commands(self, user, role):
        desired = self.env.ref(ROLE_XMLIDS[role])
        nasq_groups = self.env['res.groups'].browse([
            self.env.ref(xmlid).id for xmlid in NASQ_ROLE_XMLIDS
        ])
        explicit = user.group_ids
        unrelated = explicit - nasq_groups
        admin_group = self.env.ref('nasq_core.group_customer_admin')
        if role == 'employee' and any(admin_group in group.all_implied_ids for group in unrelated):
            raise NasqHrRule(
                ROLE_CONFLICT_CODE, 'cannot demote while another explicit group still grants administrator access',
                field='role',
            )
        group_ids = (unrelated | desired).ids
        return [(6, 0, group_ids)]

    def _nasq_validate_email_available(self, normalized, current_user=None):
        users = self.env['res.users'].with_context(active_test=False).search([('login', '=', normalized)])
        if users - current_user:
            raise NasqHrRule(LOGIN_TAKEN_CODE, 'this work email is already used as a login', field='work_email')

    def _nasq_grant_access(self, password, role):
        self._nasq_validate_mutation()
        if any(employee.user_id == self.env.user for employee in self):
            raise NasqHrRule(SELF_ROLE_CODE, 'an administrator cannot change their own role', field='role')
        self._nasq_validate_vendor()
        self._nasq_validate_role(role)
        password = self._nasq_password(password)
        for employee in self:
            if not employee.active:
                raise NasqHrRule(EMPLOYEE_ARCHIVED_CODE, 'archived employees cannot receive access')
            normalized = self._nasq_normalize_email(employee.work_email)
            if not normalized:
                raise NasqHrRule(EMAIL_REQUIRED_CODE, 'a work email is required before granting access', field='work_email')
            current = employee.user_id
            self._nasq_validate_email_available(normalized, current)
            if current and current.active:
                raise NasqHrRule(ACCESS_EXISTS_CODE, 'this employee already has active access')
        with self.env.cr.savepoint():
            for employee in self:
                normalized = self._nasq_normalize_email(employee.work_email)
                user = employee.user_id
                if not user:
                    if not employee.work_contact_id:
                        contact = self.env['res.partner'].create({
                            'email': employee.work_email,
                            'phone': employee.work_phone,
                            'name': employee.name,
                            'image_1920': employee.image_1920,
                            'company_id': employee.company_id.id,
                        })
                        employee.write({'work_contact_id': contact.id})
                        employee.invalidate_recordset(['work_contact_id'])
                    user = self.env['res.users'].with_context(no_reset_password=True).create({
                        'login': normalized,
                        'partner_id': employee.work_contact_id.id or False,
                        'password': password,
                        'company_id': employee.company_id.id,
                        'company_ids': [(6, 0, [employee.company_id.id])],
                        'group_ids': self._nasq_role_commands(
                            self.env['res.users'].new({'group_ids': []}), role,
                        ),
                    })
                    employee.write({'user_id': user.id})
                else:
                    user.write({
                        'active': True,
                        'group_ids': self._nasq_role_commands(user, role),
                    })
                    user._change_password(password)
        clear_security_caches_after_commit(self.env)
        return self

    def _nasq_update_access(self, role=None, password=None):
        self._nasq_validate_mutation()
        self._nasq_validate_vendor()
        if role is not None:
            self._nasq_validate_role(role)
        if password is not None:
            password = self._nasq_password(password)
        users = self.mapped('user_id')
        if len(users) != len(self):
            raise NasqHrRule(ACCESS_MISSING_CODE, 'the employee has no linked access')
        if role is not None:
            for employee in self:
                if employee.user_id == self.env.user:
                    raise NasqHrRule(SELF_ROLE_CODE, 'an administrator cannot change their own role', field='role')
                self._nasq_role_commands(employee.user_id, role)
        if role is None and password is None:
            return self
        with self.env.cr.savepoint():
            if role is not None:
                for employee in self:
                    employee.user_id.write({'group_ids': self._nasq_role_commands(employee.user_id, role)})
            if password is not None:
                for user in users:
                    user._change_password(password)
        clear_security_caches_after_commit(self.env)
        return self

    def _nasq_revoke_access(self):
        self._nasq_validate_mutation()
        if any(employee.user_id == self.env.user for employee in self):
            raise NasqHrRule(SELF_DEACTIVATE_CODE, 'an administrator cannot deactivate themselves', status=422)
        self._nasq_validate_vendor()
        users = self.mapped('user_id')
        if len(users) != len(self):
            raise NasqHrRule(ACCESS_MISSING_CODE, 'the employee has no linked access')
        with self.env.cr.savepoint():
            users.write({'active': False})
        clear_security_caches_after_commit(self.env)
        return self
