# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestEmployeeAccountInvite(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='employee_invite_admin', password='employee_invite_admin_pass_123',
            groups='liwan_core.group_access_admin,liwan_core.group_employee',
        )
        cls.employee_record = cls.env['hr.employee'].create({
            'name': 'Invite Target', 'work_email': 'invite.target@example.com',
            'company_id': cls.env.company.id,
        })
        cls.role = cls.env.ref('liwan_core.role_employee')

    def setUp(self):
        super().setUp()
        self.sent = []
        self.patch(
            type(self.env['liwan.account.mail']), '_liwan_send',
            lambda model, token, raw: self.sent.append((token.purpose, token.user_id.login, raw)),
        )
        self.authenticate('employee_invite_admin', 'employee_invite_admin_pass_123')

    def _grant(self, **overrides):
        return self.api('POST', '/api/v1/admin/employee-accounts', {
            'employee_id': self.employee_record.id,
            'login': 'invite.target@example.com',
            'assignments': [{'role_id': self.role.id, 'scope': {'kind': 'company', 'id': self.env.company.id}}],
            **overrides,
        })

    def test_employee_grant_sends_invite_and_keeps_work_email(self):
        response = self._grant(login='  Chosen.Login@Example.com ')
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual(created['login'], 'chosen.login@example.com')
        self.assertEqual(created['invitation']['state'], 'pending')
        self.assertEqual(created['employee']['id'], self.employee_record.id)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][0], 'invite')
        self.employee_record.invalidate_recordset()
        self.assertEqual(self.employee_record.work_email, 'invite.target@example.com')
        self.assertEqual(self.employee_record.user_id.id, created['id'])

        edited = self.api('PATCH', f"/api/v1/admin/users/{created['id']}/invitation", {
            'login': 'second.choice@example.com', 'expected_version': created['version'],
        })
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()['login'], 'second.choice@example.com')
        self.employee_record.invalidate_recordset()
        self.employee_record.work_contact_id.invalidate_recordset()
        self.assertEqual(self.employee_record.work_email, 'invite.target@example.com')
        self.assertEqual(self.employee_record.work_contact_id.email, 'invite.target@example.com')
        self.assertEqual(self.sent[-1][1], 'second.choice@example.com')

    def test_employee_grant_rejects_password_key(self):
        response = self._grant(password='twelve-chars-ok')
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))
        self.assertEqual(response.json()['field'], 'password')
        self.employee_record.invalidate_recordset(['user_id'])
        self.assertFalse(self.employee_record.user_id)
        self.assertEqual(self.sent, [])
