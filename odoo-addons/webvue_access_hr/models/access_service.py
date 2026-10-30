# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.tools import SQL, email_normalize

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule


class WebVueAccessHrService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_hr_readable(self):
        """Whether the tenant may read HR data; the account routes expose none of it otherwise."""
        try:
            return self.env['webvue.entitlement.service'].require_read('hr.enabled')
        except WebVueAccessRule:
            return False

    @api.model
    def _webvue_account_filter_keys(self):
        keys = super()._webvue_account_filter_keys()
        return keys | {'department_id'} if self._webvue_hr_readable() else keys

    @api.model
    def _webvue_account_user_domain(self, filters):
        domain = super()._webvue_account_user_domain(filters)
        department = filters.get('department_id')
        if not department:
            return domain
        if not self._webvue_has_capability(self.env.user, 'hr.departments.read'):
            msg = 'forbidden'
            raise WebVueAccessRule(msg, status=403)
        if not (department.isascii() and department.isdecimal() and int(department) > 0):
            msg = 'invalid'
            raise WebVueAccessRule(
                msg, 'department_id must be a positive integer', field='department_id',
            )
        self.env.cr.execute(
            """
            SELECT employee.user_id
              FROM hr_employee employee
              JOIN hr_version version ON version.id = employee.current_version_id
             WHERE employee.company_id = %s
               AND employee.user_id IS NOT NULL
               AND version.department_id = %s
            """,
            [self.env.company.id, int(department)],
        )
        return [*domain, ('id', 'in', [user_id for (user_id,) in self.env.cr.fetchall()])]

    @api.model
    def _webvue_account_extra_fields(self, user_ids):
        extra = super()._webvue_account_extra_fields(user_ids)
        if not self._webvue_hr_readable():
            return extra
        linked = self._webvue_linked_employees(user_ids)
        for user_id in user_ids:
            employee = linked.get(user_id)
            extra[user_id]['employee'] = (
                {key: employee[key] for key in ('id', 'name', 'department')}
                if employee
                else None
            )
        return extra

    @api.model
    def _webvue_assert_account_reactivation(self, user):
        super()._webvue_assert_account_reactivation(user)
        employee = self._webvue_linked_employees([user.id]).get(user.id)
        if employee and not employee['active']:
            msg = 'employee_archived'
            raise WebVueAccessRule(msg, status=409)

    @api.model
    def _webvue_linked_employees(self, user_ids):
        """User id -> the HR employee linked to it in the current company (read below the HR ACLs)."""
        self._webvue_require_capability('access.users.read')
        if not user_ids:
            return {}
        self.env.cr.execute(
            """
            SELECT e.user_id, e.id, e.name, d.id, d.name, e.active
              FROM hr_employee e
              LEFT JOIN hr_version v ON v.id = e.current_version_id
              LEFT JOIN hr_department d ON d.id = v.department_id
             WHERE e.user_id = ANY(%s) AND e.company_id = %s
            """,
            [list(user_ids), self.env.company.id],
        )
        return {
            user_id: {
                'id': employee_id,
                'name': self._webvue_hr_text(name),
                'department': (
                    {'id': department_id, 'name': self._webvue_hr_text(department_name)}
                    if department_id
                    else None
                ),
                'active': bool(active),
            }
            for user_id, employee_id, name, department_id, department_name, active
            in self.env.cr.fetchall()
        }

    @api.model
    def _webvue_employee_row(self, employee_id):
        self.env.cr.execute(
            """
            SELECT e.id, e.name, e.work_email, e.work_contact_id, e.user_id, e.active
              FROM hr_employee e
             WHERE e.id = %s AND e.company_id = %s
             LIMIT 1
            """,
            [employee_id, self.env.company.id],
        )
        return self.env.cr.fetchone()

    @api.model
    def _webvue_employee_account_candidates(self, filters, limit, offset):
        self._webvue_require_capability('access.users.grant')
        conditions = [SQL('e.company_id = %s', self.env.company.id)]
        if filters.get('q'):
            needle = f"%{filters['q']}%"
            conditions.append(SQL('(e.name ILIKE %s OR e.work_email ILIKE %s)', needle, needle))
        if filters.get('department_id'):
            conditions.append(SQL('v.department_id = %s', filters['department_id']))
        if filters.get('employee_id'):
            conditions.append(SQL('e.id = %s', filters['employee_id']))
        if filters.get('status'):
            conditions.append(SQL('e.active IS %s', filters['status'] == 'active'))
        clause = SQL(' AND ').join(conditions)
        self.env.cr.execute(SQL(
            """
            SELECT e.id, e.name, d.id, d.name, e.work_email,
                   e.active, e.user_id, u.active
              FROM hr_employee e
              LEFT JOIN hr_version v ON v.id = e.current_version_id
              LEFT JOIN hr_department d ON d.id = v.department_id
              LEFT JOIN res_users u ON u.id = e.user_id
             WHERE %s
             ORDER BY e.name, e.id
             LIMIT %s OFFSET %s
            """,
            clause, limit, offset,
        ))
        rows = self.env.cr.fetchall()
        self.env.cr.execute(SQL(
            """SELECT COUNT(*)
                  FROM hr_employee e
                  LEFT JOIN hr_version v ON v.id = e.current_version_id
                 WHERE %s""",
            clause,
        ))
        return {
            'items': [
                {
                    'id': employee_id,
                    'name': self._webvue_hr_text(name),
                    'department': (
                        {
                            'id': department_id,
                            'name': self._webvue_hr_text(department_name),
                        }
                        if department_id
                        else None
                    ),
                    'work_email': email_normalize(work_email) or None,
                    'active': bool(employee_active),
                    'user_id': user_id or None,
                    'access_active': bool(user_active) if user_id else None,
                }
                for (
                    employee_id,
                    name,
                    department_id,
                    department_name,
                    work_email,
                    employee_active,
                    user_id,
                    user_active,
                ) in rows
            ],
            'total': self.env.cr.fetchone()[0],
        }

    @api.model
    def _webvue_grant_employee_account(self, employee_id, password, assignments):
        self._webvue_require_capability('access.users.grant')
        row = self._webvue_employee_row(employee_id)
        if not row:
            msg = 'not_found'
            raise WebVueAccessRule(msg, 'employee is not available', status=404)
        _id, name, work_email, partner_id, user_id, active = row
        if not active:
            msg = 'employee_archived'
            raise WebVueAccessRule(msg, field='employee_id')
        if user_id:
            msg = 'account_exists'
            raise WebVueAccessRule(msg, field='employee_id', status=409)
        login = email_normalize((work_email or '').strip())
        if not login:
            msg = 'work_email_required'
            raise WebVueAccessRule(msg, field='employee_id')
        if not partner_id:
            msg = 'employee_contact_required'
            raise WebVueAccessRule(msg, field='employee_id')
        user = self._webvue_create_account(
            name, login, password, assignments, partner_id=partner_id,
        )
        self._webvue_link_employee(employee_id, user.id)
        self.env['webvue.access.audit']._webvue_log(
            'user.employee_linked', user, before=None, after={'employee_id': employee_id},
        )
        return user

    @api.model
    def _webvue_link_employee(self, employee_id, user_id):
        # ``hr.employee.user_id`` is a stored related field whose source is
        # ``resource.resource.user_id``. Update both columns so the private
        # bridge preserves the stock HR relation and its search index.
        company_id = self.env.company.id
        self.env.cr.execute(
            """
            UPDATE resource_resource
               SET user_id = %s
             WHERE id = (SELECT resource_id FROM hr_employee WHERE id = %s AND company_id = %s)
               AND company_id = %s
            """,
            [user_id, employee_id, company_id, company_id],
        )
        self.env.cr.execute(
            'UPDATE hr_employee SET user_id = %s WHERE id = %s AND company_id = %s',
            [user_id, employee_id, company_id],
        )
        if self.env.cr.rowcount != 1:
            msg = 'not_found'
            raise WebVueAccessRule(msg, 'employee is not available', status=404)
        employee = self.env['hr.employee'].browse(employee_id)
        employee.invalidate_recordset(['user_id'])
        employee.modified(['user_id'])

    @api.model
    def _webvue_disable_employee_account(
        self, employee_id, user_id, expected_user_version,
    ):
        self._webvue_require_capability('hr.employees.archive')
        user = self.env['res.users'].browse(user_id).exists()
        if not user:
            msg = 'not_found'
            raise WebVueAccessRule(msg, status=404)
        self._webvue_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise WebVueAccessRule(msg)
        if user.has_group('webvue_core.group_vendor_support'):
            msg = 'protected_user'
            raise WebVueAccessRule(msg, status=403)
        self._webvue_lock_company(user.company_id)
        self.env.invalidate_all()
        self._webvue_require_capability('hr.employees.archive')
        user = (
            self.env['res.users']
            .with_context(active_test=False)
            .browse(user.id)
            .exists()
        )
        self._webvue_assert_user_scope(user)
        self._webvue_check_user_version(user, expected_user_version)
        self._webvue_assert_user_scope(user)
        if not user.active:
            # Archiving must still succeed for an account already disabled elsewhere;
            # nothing changed, so there is no second audit event.
            return
        if self._webvue_has_capability(
            user,
            'access.users.assign_roles',
            company=user.company_id,
        ):
            self._webvue_assert_admin_survives(user.company_id, excluding_user=user)
        user._webvue_access_write({'active': False}, 'hr.employees.archive')
        self.env['webvue.access.audit']._webvue_log(
            'employee.archived_access_disabled',
            user,
            before={'active': True, 'employee_id': employee_id},
            after={'active': False, 'employee_id': employee_id},
        )
        self._webvue_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)
