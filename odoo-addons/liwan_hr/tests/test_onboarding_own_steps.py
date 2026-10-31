# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase

TODO = 'mail.mail_activity_data_todo'
STEPS = '/api/v1/hr/self/onboarding-steps'
MANAGER_KEYS = ('hr.employees.read', 'hr.employees.manage', 'hr.onboarding.read', 'hr.onboarding.manage')


@tagged('post_install', '-at_install', 'liwan')
class TestOnboardingOwnSteps(LiwanHrCase):
    """An employee sees the onboarding steps assigned to them, finishes them, and gets a bell row for them."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.hr = new_test_user(
            cls.env, login='own_steps_hr', password='own_steps_hr_pass_123', name='Steps HR', groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': 'own_steps_hr', 'name_ar': 'x', 'name_en': 'own_steps_hr', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', MANAGER_KEYS)]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.hr, [{'role_id': role.id, 'company_id': company.id}])
        cls.lead = cls.env['hr.employee'].create({'name': 'Steps Lead', 'company_id': company.id, 'user_id': cls.hr.id})
        cls.newcomer = cls.env['hr.employee'].create({
            'name': 'Steps Newcomer', 'company_id': company.id, 'user_id': cls.employee.id, 'parent_id': cls.lead.id,
        })
        cls.plan = cls.env['mail.activity.plan'].create({
            'name': 'Steps plan', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding', 'company_id': company.id,
        })
        for summary, responsible in (('Sign the contract', 'employee'), ('Prepare the desk', 'manager')):
            cls.env['mail.activity.plan.template'].create({
                'plan_id': cls.plan.id, 'summary': summary, 'activity_type_id': cls.env.ref(TODO).id,
                'responsible_type': responsible, 'delay_count': 0, 'delay_unit': 'days', 'delay_from': 'before_plan_date',
            })

    def _login(self, login):
        self.authenticate(login, f'{login}_pass_123')

    def _launch(self):
        self._login('own_steps_hr')
        res = self.api('POST', '/api/v1/hr/onboarding/runs', json={'employee_id': self.newcomer.id, 'plan_id': self.plan.id})
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def test_the_employee_lists_only_the_steps_assigned_to_them(self):
        run = self._launch()
        self._login(self.employee.login)
        res = self.api('GET', STEPS)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual([item['summary'] for item in body['items']], ['Sign the contract'])
        self.assertEqual(set(body['items'][0]), {'id', 'run_id', 'summary', 'date_deadline', 'state'})
        self.assertEqual((body['total'], body['items'][0]['run_id']), (1, run['id']))

    def test_the_employee_finishes_their_step_and_not_the_managers(self):
        self._launch()
        self._login(self.employee.login)
        mine = self.api('GET', STEPS).json()['items'][0]
        manager_step = self.env['mail.activity'].search([
            ('res_model', '=', 'hr.employee'), ('res_id', '=', self.newcomer.id), ('user_id', '=', self.hr.id),
        ])
        self.assertEqual(self.api('POST', f"{STEPS}/{manager_step.id}/done", json={}).status_code, 404)
        done = self.api('POST', f"{STEPS}/{mine['id']}/done", json={'feedback': 'signed'})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json(), {'id': mine['id'], 'run_id': mine['run_id'], 'done': True})
        self.assertEqual(self.api('GET', STEPS).json()['items'], [])
        self._login('own_steps_hr')
        detail = self.api('GET', f"/api/v1/hr/onboarding/runs/{mine['run_id']}").json()
        self.assertEqual({step['summary']: step['state'] for step in detail['steps']}['Sign the contract'], 'done')

    def test_a_colleague_sees_nothing_of_it(self):
        self._launch()
        colleague = new_test_user(
            self.env, login='own_steps_colleague', password='own_steps_colleague_pass_123', name='Colleague',
            groups='liwan_core.group_employee',
        )
        self.env['hr.employee'].create({'name': 'Colleague', 'company_id': self.env.company.id, 'user_id': colleague.id})
        self._login(colleague.login)
        self.assertEqual(self.api('GET', STEPS).json(), {'items': [], 'total': 0})

    def test_the_assignee_gets_a_bell_row_and_the_launcher_does_not(self):
        run = self._launch()
        self._login(self.employee.login)
        rows = [row for row in self.api('GET', '/api/v1/notifications').json()['items'] if row['kind'] == 'hr.onboarding_step']
        self.assertEqual([(row['run_id'], row['title']) for row in rows], [(run['id'], 'Sign the contract')])
        self._login('own_steps_hr')
        manager_rows = [row for row in self.api('GET', '/api/v1/notifications').json()['items'] if row['kind'] == 'hr.onboarding_step']
        self.assertEqual(manager_rows, [])
