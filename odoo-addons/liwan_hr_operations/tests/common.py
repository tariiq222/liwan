# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo.tests import new_test_user

from odoo.addons.liwan_hr.tests.common import LiwanHrCase, set_hr_feature
from odoo.addons.liwan_hr_operations.models.common import APPROVER, KIND, OFFICERS

LEAVES = '/api/v1/hr/leave/requests'
PROCESS = '/api/v1/hr/leave/approval-process'


def next_monday(weeks):
    start = date.today() + timedelta(days=14 + 7 * weeks)
    return start + timedelta(days=(0 - start.weekday()) % 7)


class LeaveApprovalCase(LiwanHrCase):
    """A requester whose time-off approver holds no HR capability, an HR officer and an operations admin."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_hr_feature(cls, 'operations.enabled', True)
        company = cls.env.company
        company.country_id = cls.env.ref('base.sa')
        cls.service = cls.env['liwan.access.service']
        cls.manager_user = cls._user('lao_mgr', 'Direct Manager', ['liwan_core.role_employee'])
        cls.officer = cls._user('lao_hr', 'HR Officer', ['liwan_core.role_employee', 'liwan_hr.role_hr_manager'])
        cls.officer_two = cls._user('lao_hr2', 'HR Officer Two', ['liwan_core.role_employee', 'liwan_hr.role_hr_manager'])
        cls.ops_admin = cls._user('lao_ops', 'Operations Admin', ['liwan_core.role_employee', 'liwan_operations.role_operations_manager'])
        cls.bystander = cls._user('lao_by', 'Bystander', ['liwan_core.role_employee'])
        cls.service._liwan_replace_assignments(cls.employee, [{'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': company.id}])
        Employee = cls.env['hr.employee']
        cls.manager_employee = Employee.create({'name': 'Direct Manager', 'user_id': cls.manager_user.id, 'company_id': company.id})
        cls.officer_employee = Employee.create({'name': 'HR Officer', 'user_id': cls.officer.id, 'company_id': company.id})
        cls.bystander_employee = Employee.create({'name': 'Bystander', 'user_id': cls.bystander.id, 'company_id': company.id})
        cls.staff = Employee.search([('user_id', '=', cls.employee.id)], limit=1) or Employee.create({
            'name': 'Sara', 'user_id': cls.employee.id, 'company_id': company.id,
        })
        cls.staff.leave_manager_id = cls.manager_user
        cls.annual = cls.env.ref('hr_holidays.leave_type_paid_time_off')
        cls.annual.leave_validation_type = 'both'
        cls.unbalanced = cls.env.ref('hr_holidays.l10n_sa_leave_type_sick_leave_0')
        cls.unbalanced.leave_validation_type = 'both'
        cls.env['hr.leave.allocation'].create({
            'employee_id': cls.staff.id, 'holiday_status_id': cls.annual.id, 'number_of_days': 30,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()
        company._hr_leave_seed_default_process()

    @classmethod
    def _user(cls, login, name, roles):
        user = new_test_user(cls.env, login=login, password=f'{login}_pass_123', name=name, groups='liwan_core.group_employee')
        cls.service._liwan_replace_assignments(user, [{'role_id': cls.env.ref(role).id, 'company_id': cls.env.company.id} for role in roles])
        return user

    @property
    def process(self):
        return self.env['liwan.operation.process']._hr_leave_governing_process(self.env.company)

    def login_as(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def file_leave(self, user=None, weeks=0, days=2, **extra):
        """File a leave through the HR route as ``user`` (default: the requester) and return its record."""
        self.login_as(user or self.employee)
        start = next_monday(weeks)
        payload = {'leave_type_id': self.annual.id, 'date_from': start.isoformat(), 'date_to': (start + timedelta(days=days - 1)).isoformat(), 'notes': 'Family trip', **extra}
        response = self.api('POST', LEAVES, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return self.env['hr.leave'].browse(response.json()['id'])

    def approval_request(self, leave):
        leave.invalidate_recordset()
        return leave.liwan_approval_request_ids[:1]

    def approve(self, record, user, comment=''):
        record = record.with_user(user)
        record.invalidate_recordset()
        return record.action_approve(record.revision, comment)

    def reject(self, record, user, comment='Not now'):
        record = record.with_user(user)
        record.invalidate_recordset()
        return record.action_reject(record.revision, comment)

    def archive_process(self):
        process = self.process.with_user(self.ops_admin)
        process.action_archive(process.revision)

    def publish_process(self, steps, name='Custom leave approval', purpose='employee'):
        process = self.env['liwan.operation.process'].with_user(self.ops_admin).create({'name': name})
        process.action_configure(0, name, '', KIND, steps, purpose=purpose)
        process.action_publish(process.revision)
        return process


STAGE_MANAGER = {'name': 'Direct manager', 'reviewer_ids': [], 'resolver': APPROVER}
STAGE_OFFICERS = {'name': 'HR', 'reviewer_ids': [], 'resolver': OFFICERS}
