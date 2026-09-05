# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.tools import email_normalize

from odoo.addons.nasq_core.models.access_service import NasqAccessRule


class NasqHrAccessService(models.AbstractModel):
    _inherit = 'nasq.access.service'

    @api.model
    def _nasq_configure_hr_record_rules(self):
        rule = self.env.ref('nasq_hr.nasq_hr_document_company_rule')
        rule.write({'domain_force': "[('company_id', '=', company_id)]"})
        return True

    def _nasq_hr_text(self, value):
        if not isinstance(value, dict):
            return value
        return (
            value.get(self.env.lang)
            or value.get('en_US')
            or next(iter(value.values()), '')
        )

    def _nasq_hr_company_ids(self):
        return [self.env.company.id]

    def _nasq_hr_employee_row(self, employee_id):
        self.env.cr.execute(
            """
            SELECT e.id, e.company_id, e.name, e.work_email,
                   e.work_contact_id, e.user_id, e.active,
                   d.id, d.name, u.active
              FROM hr_employee e
              LEFT JOIN hr_version v ON v.id = e.current_version_id
              LEFT JOIN hr_department d ON d.id = v.department_id
              LEFT JOIN res_users u ON u.id = e.user_id
             WHERE e.id = %s AND e.company_id = ANY(%s)
             LIMIT 1
            """,
            [employee_id, self._nasq_hr_company_ids()],
        )
        return self.env.cr.fetchone()

    def _nasq_hr_prepare_account(self, employee_id: int, operation: str) -> dict:
        required = 'access.users.grant' if operation == 'grant' else 'access.users.disable'
        if operation not in ('grant', 'reactivate'):
            msg = 'invalid'
            raise NasqAccessRule(msg, 'unsupported account operation')
        if not self._nasq_has_capability(self.env.user, required):
            msg = 'forbidden'
            raise NasqAccessRule(msg, f'{required} capability is required', status=403)
        row = self._nasq_hr_employee_row(employee_id)
        if not row:
            msg = 'not_found'
            raise NasqAccessRule(msg, 'employee is not available', status=404)
        employee_id, company_id, name, work_email, partner_id, user_id, active, *_ = row
        return {
            'employee_id': employee_id,
            'company_id': company_id,
            'name': name,
            'login': email_normalize((work_email or '').strip()) or '',
            'partner_id': partner_id or False,
            'existing_user_id': user_id or False,
            'employee_active': bool(active),
        }

    def _nasq_hr_link_account(self, employee_id: int, user_id: int) -> None:
        if not self._nasq_has_capability(self.env.user, 'access.users.grant'):
            msg = 'forbidden'
            raise NasqAccessRule(
                msg, 'access.users.grant capability is required', status=403,
            )
        employee = self._nasq_hr_employee_row(employee_id)
        if not employee:
            msg = 'not_found'
            raise NasqAccessRule(msg, 'employee or user is not available', status=404)
        self.env.cr.execute(
            "SELECT id, company_id FROM res_users WHERE id = %s LIMIT 1",
            [user_id],
        )
        user = self.env.cr.fetchone()
        if not user or user[1] != employee[1]:
            msg = 'not_found'
            raise NasqAccessRule(msg, 'employee or user is not available', status=404)
        # ``hr.employee.user_id`` is a stored related field whose source is
        # ``resource.resource.user_id``. Update both columns so the private
        # bridge preserves the stock HR relation and its search index.
        self.env.cr.execute(
            """
            UPDATE resource_resource
               SET user_id = %s
             WHERE id = (SELECT resource_id FROM hr_employee WHERE id = %s)
            """,
            [user_id, employee_id],
        )
        self.env.cr.execute(
            'UPDATE hr_employee SET user_id = %s WHERE id = %s',
            [user_id, employee_id],
        )
        employee_record = self.env['hr.employee'].browse(employee_id)
        employee_record.invalidate_recordset(['user_id'])
        employee_record.modified(['user_id'])

    def _nasq_hr_user_domain(self, filters: dict):
        department_id = filters.get('department_id') or None
        employee_id = filters.get('employee_id') or None
        self.env.cr.execute(
            '''
                SELECT employee.user_id
                  FROM hr_employee employee
                  JOIN hr_version version ON version.id = employee.current_version_id
                 WHERE employee.company_id = %s
                   AND employee.user_id IS NOT NULL
                   AND (%s OR version.department_id = %s)
                   AND (%s OR employee.id = %s)
            ''',
            [
                self.env.company.id,
                department_id is None, department_id or 0,
                employee_id is None, employee_id or 0,
            ],
        )
        return fields.Domain('id', 'in', [user_id for user_id, in self.env.cr.fetchall()])

    def _nasq_hr_employee_refs(self, user_ids: list[int]) -> dict[int, dict | None]:
        if not self._nasq_has_capability(self.env.user, 'access.users.read'):
            msg = 'forbidden'
            raise NasqAccessRule(
                msg, 'access.users.read capability is required', status=403,
            )
        if not user_ids:
            return {}
        self.env.cr.execute(
            """
            SELECT e.user_id, e.id, e.name, d.id, d.name
              FROM hr_employee e
              LEFT JOIN hr_version v ON v.id = e.current_version_id
              LEFT JOIN hr_department d ON d.id = v.department_id
             WHERE e.user_id = ANY(%s) AND e.company_id = ANY(%s)
            """,
            [user_ids, self._nasq_hr_company_ids()],
        )
        refs = {user_id: None for user_id in user_ids}
        for user_id, employee_id, name, department_id, department_name in self.env.cr.fetchall():
            refs[user_id] = {
                'id': employee_id,
                'name': self._nasq_hr_text(name),
                'department': (
                    {'id': department_id, 'name': self._nasq_hr_text(department_name)}
                    if department_id else None
                ),
            }
        return refs

    def _nasq_hr_account_candidates(self, filters: dict, limit: int, offset: int) -> dict:
        if not self._nasq_has_capability(self.env.user, 'access.users.grant'):
            msg = 'forbidden'
            raise NasqAccessRule(
                msg, 'access.users.grant capability is required', status=403,
            )
        company_ids = self._nasq_hr_company_ids()
        where = ['e.company_id = ANY(%s)']
        params = [company_ids]
        query = filters.get('q')
        if query:
            where.append('(e.name ILIKE %s OR e.work_email ILIKE %s)')
            needle = f'%{query}%'
            params.extend([needle, needle])
        if filters.get('department_id'):
            where.append('v.department_id = %s')
            params.append(filters['department_id'])
        if filters.get('employee_id'):
            where.append('e.id = %s')
            params.append(filters['employee_id'])
        if filters.get('status') == 'active':
            where.append('e.active IS TRUE')
        elif filters.get('status') == 'archived':
            where.append('e.active IS FALSE')
        clause = ' AND '.join(where)
        self.env.cr.execute(
            f"""
            SELECT e.id, e.name, d.id, d.name, e.work_email,
                   e.active, e.user_id, u.active
              FROM hr_employee e
              LEFT JOIN hr_version v ON v.id = e.current_version_id
              LEFT JOIN hr_department d ON d.id = v.department_id
              LEFT JOIN res_users u ON u.id = e.user_id
             WHERE {clause}
             ORDER BY e.name, e.id
             LIMIT %s OFFSET %s
            """,
            [*params, limit, offset],
        )
        rows = self.env.cr.fetchall()
        self.env.cr.execute(
            f'''SELECT COUNT(*)
                  FROM hr_employee e
                  LEFT JOIN hr_version v ON v.id = e.current_version_id
                 WHERE {clause}''', params,
        )
        return {
            'items': [{
                'id': employee_id,
                'name': self._nasq_hr_text(name),
                'department': (
                    {'id': department_id, 'name': self._nasq_hr_text(department_name)}
                    if department_id else None
                ),
                'work_email': work_email or None,
                'active': bool(employee_active),
                'user_id': user_id or None,
                'access_active': bool(user_active) if user_id else None,
            } for (
                employee_id, name, department_id, department_name, work_email,
                employee_active, user_id, user_active,
            ) in rows],
            'total': self.env.cr.fetchone()[0],
        }
