# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase

TODO = 'mail.mail_activity_data_todo'
STEPS = '/api/v1/hr/self/onboarding-steps'
EMPLOYEE_ROLE = 'liwan_core.role_employee'
MANAGER_KEYS = ('hr.employees.read', 'hr.employees.manage', 'hr.onboarding.read', 'hr.onboarding.manage')
STEP_KEYS = {'id', 'run_id', 'summary', 'date_deadline', 'state'}


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestOnboardingOwnStepsRoleManaged(LiwanHrCase):
    """The own-steps routes for accounts managed by roles.

    An invited account holds ``base.group_user`` and the groups of its capabilities, never the legacy
    ``liwan_core.group_employee``. Every person here holds the built-in employee role only.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        manager_role = cls.env['liwan.access.role'].create({
            'key': 'managed_steps_hr', 'name_ar': 'x', 'name_en': 'managed_steps_hr', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', MANAGER_KEYS)]).ids)],
        })
        cls.hr = cls._role_managed('managed_steps_hr', [cls.env.ref(EMPLOYEE_ROLE), manager_role])
        cls.boss = cls._role_managed('managed_steps_boss')
        cls.coach = cls._role_managed('managed_steps_coach')
        cls.newcomer_user = cls._role_managed('managed_steps_new')
        cls.colleague = cls._role_managed('managed_steps_colleague')
        Employee = cls.env['hr.employee']
        boss = Employee.create({'name': 'Managed Boss', 'company_id': cls.company.id, 'user_id': cls.boss.id})
        coach = Employee.create({'name': 'Managed Coach', 'company_id': cls.company.id, 'user_id': cls.coach.id})
        Employee.create({'name': 'Managed Colleague', 'company_id': cls.company.id, 'user_id': cls.colleague.id})
        cls.newcomer = Employee.create({
            'name': 'Managed Newcomer', 'company_id': cls.company.id, 'user_id': cls.newcomer_user.id,
            'parent_id': boss.id, 'coach_id': coach.id,
        })
        cls.plan = cls.env['mail.activity.plan'].create({
            'name': 'Managed steps plan', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding', 'company_id': cls.company.id,
        })
        for summary, responsible in (
            ('Sign the contract', 'employee'), ('Prepare the desk', 'manager'), ('Walk the office', 'coach'),
        ):
            cls.env['mail.activity.plan.template'].create({
                'plan_id': cls.plan.id, 'summary': summary, 'activity_type_id': cls.env.ref(TODO).id,
                'responsible_type': responsible, 'delay_count': 0, 'delay_unit': 'days', 'delay_from': 'before_plan_date',
            })

    @classmethod
    def _role_managed(cls, login, roles=None):
        """An account shaped as ``_liwan_create_invitee`` creates it: internal user only, the rest from its roles."""
        user = new_test_user(cls.env, login=login, password=f'{login}_pass_123', name=login, groups='base.group_user')
        roles = roles or [cls.env.ref(EMPLOYEE_ROLE)]
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [
            {'role_id': role.id, 'company_id': cls.env.company.id} for role in roles
        ])
        return user

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _launch(self):
        self._login(self.hr)
        res = self.api('POST', '/api/v1/hr/onboarding/runs', json={'employee_id': self.newcomer.id, 'plan_id': self.plan.id})
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def _step_of(self, user):
        return self.env['mail.activity'].search([
            ('res_model', '=', 'hr.employee'), ('res_id', '=', self.newcomer.id), ('user_id', '=', user.id),
        ])

    def _assert_lists_and_finishes_only(self, user, summary, run, foreign_step):
        self._login(user)
        res = self.api('GET', STEPS)
        self.assertEqual(res.status_code, 200, res.text)
        listed = res.json()
        self.assertEqual([(item['summary'], item['run_id']) for item in listed['items']], [(summary, run['id'])])
        self.assertEqual((listed['total'], set(listed['items'][0])), (1, STEP_KEYS))
        # Nothing else of the file opens: no run detail, no run list, and nobody else's step.
        self.assertEqual(self.api('GET', f"/api/v1/hr/onboarding/runs/{run['id']}").status_code, 403)
        self.assertEqual(self.api('GET', '/api/v1/hr/onboarding/runs').status_code, 403)
        self.assertEqual(self.api('POST', f'{STEPS}/{foreign_step.id}/done', json={}).status_code, 404)
        step_id = listed['items'][0]['id']
        done = self.api('POST', f'{STEPS}/{step_id}/done', json={'feedback': 'done'})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json(), {'id': step_id, 'run_id': run['id'], 'done': True})
        self.assertEqual(self.api('GET', STEPS).json(), {'items': [], 'total': 0})

    def test_the_accounts_hold_no_legacy_employee_group(self):
        for user in (self.hr, self.boss, self.coach, self.newcomer_user, self.colleague):
            self.assertFalse(user.has_group('liwan_core.group_employee'), user.login)
            self.assertTrue(self.env['liwan.access.service']._liwan_identity_management_state(user)[0], user.login)

    def test_the_employee_lists_and_finishes_only_their_own_step(self):
        run = self._launch()
        self._assert_lists_and_finishes_only(self.newcomer_user, 'Sign the contract', run, self._step_of(self.boss))
        self._login(self.hr)
        detail = self.api('GET', f"/api/v1/hr/onboarding/runs/{run['id']}").json()
        states = {step['summary']: step['state'] for step in detail['steps']}
        self.assertEqual(states['Sign the contract'], 'done')
        self.assertNotEqual(states['Prepare the desk'], 'done')

    def test_the_manager_assigned_a_step_lists_and_finishes_only_that_step(self):
        run = self._launch()
        self._assert_lists_and_finishes_only(self.boss, 'Prepare the desk', run, self._step_of(self.newcomer_user))

    def test_the_coach_assigned_a_step_lists_and_finishes_only_that_step(self):
        run = self._launch()
        self._assert_lists_and_finishes_only(self.coach, 'Walk the office', run, self._step_of(self.newcomer_user))

    def test_the_assignee_gets_a_bell_row_and_the_launcher_does_not(self):
        run = self._launch()
        self._login(self.newcomer_user)
        rows = [row for row in self.api('GET', '/api/v1/notifications').json()['items'] if row['kind'] == 'hr.onboarding_step']
        self.assertEqual([(row['run_id'], row['title']) for row in rows], [(run['id'], 'Sign the contract')])
        self._login(self.hr)
        manager_rows = [row for row in self.api('GET', '/api/v1/notifications').json()['items'] if row['kind'] == 'hr.onboarding_step']
        self.assertEqual(manager_rows, [])

    def test_a_colleague_reads_nothing_of_a_run_that_is_not_theirs(self):
        run = self._launch()
        self._login(self.colleague)
        res = self.api('GET', STEPS)
        self.assertEqual((res.status_code, res.json()), (200, {'items': [], 'total': 0}))
        for step in self._step_of(self.newcomer_user) | self._step_of(self.boss) | self._step_of(self.coach):
            self.assertEqual(self.api('POST', f'{STEPS}/{step.id}/done', json={}).status_code, 404)
        # The same holds below the routes: the record rule gives the colleague no run at all.
        Run = self.env['liwan.hr.plan.run'].with_user(self.colleague)
        self.assertFalse(Run.search([]))
        with self.assertRaises(AccessError):
            Run.browse(run['id']).read(['plan_date'])

    def test_the_employee_changes_and_deletes_nothing_of_their_own_run(self):
        run = self._launch()
        own = self.env['liwan.hr.plan.run'].with_user(self.newcomer_user).browse(run['id'])
        self.assertEqual(own.read(['plan_date'])[0]['id'], run['id'])
        with self.assertRaises(AccessError):
            own.write({'plan_date': '2026-02-01'})
        with self.assertRaises(AccessError):
            own.unlink()

    def test_an_assignee_reads_only_the_runs_they_have_a_step_in(self):
        run = self._launch()
        other_user = self._role_managed('managed_steps_other_new')
        other = self.env['hr.employee'].create({
            'name': 'Managed Other Newcomer', 'company_id': self.company.id, 'user_id': other_user.id,
        })
        employee_only = self.env['mail.activity.plan'].create({
            'name': 'Managed employee-only plan', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding',
            'company_id': self.company.id,
        })
        self.env['mail.activity.plan.template'].create({
            'plan_id': employee_only.id, 'summary': 'Read the handbook', 'activity_type_id': self.env.ref(TODO).id,
            'responsible_type': 'employee', 'delay_count': 0, 'delay_unit': 'days', 'delay_from': 'before_plan_date',
        })
        self._login(self.hr)
        res = self.api('POST', '/api/v1/hr/onboarding/runs', json={'employee_id': other.id, 'plan_id': employee_only.id})
        self.assertEqual(res.status_code, 201, res.text)
        foreign = res.json()
        for user in (self.boss, self.coach, self.newcomer_user):
            Run = self.env['liwan.hr.plan.run'].with_user(user)
            self.assertEqual(Run.search([]).ids, [run['id']], user.login)
            with self.assertRaises(AccessError):
                Run.browse(foreign['id']).read(['plan_date'])
        self.assertEqual(self.env['liwan.hr.plan.run'].with_user(other_user).search([]).ids, [foreign['id']])


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestOnboardingRunsAcrossCompanies(LiwanHrCase):
    """A role-managed account reads the runs of each company by its own role in that company.

    Odoo groups are global: the onboarding-read and offboarding-read groups earned in company A are held in
    company B too, so the native rules alone would open every run of B to someone who only reads employees there.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Company = cls.env['res.company'].sudo()
        cls.company_a = Company.create({'name': 'Runs A'})
        cls.company_b = Company.create({'name': 'Runs B'})
        # The built-in roles belong to the root company and a custom role takes the current company, so each
        # company gets its own role: A reads employees, onboarding and offboarding, B reads employees only.
        roles = {
            company: cls.env['liwan.access.role'].with_company(company).create({
                'key': f'cross_runs_{name}', 'name_ar': 'x', 'name_en': f'cross_runs_{name}', 'type': 'custom',
                'assignable': True,
                'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
            })
            for company, name, keys in (
                (cls.company_a, 'a', ('hr.employees.read', 'hr.onboarding.read', 'hr.offboarding.read')),
                (cls.company_b, 'b', ('hr.employees.read',)),
            )
        }
        cls.user = new_test_user(
            cls.env, login='cross_runs_user', password='cross_runs_user_pass_123', name='cross_runs_user',
            groups='base.group_user', company_id=cls.company_a.id,
        )
        cls.user.company_ids = [Command.set((cls.company_a | cls.company_b).ids)]
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.user, [
            {'role_id': roles[cls.company_a].id, 'company_id': cls.company_a.id},
        ])
        # The service assigns inside the home company only; the other membership is a plain assignment row.
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.user.id, 'role_id': roles[cls.company_b].id, 'company_id': cls.company_b.id,
        })
        cls.run_a = cls._run(cls.company_a, 'A')
        cls.run_b_other = cls._run(cls.company_b, 'B other')
        cls.run_b_step = cls._run(cls.company_b, 'B step')
        cls.off_a = cls._run(cls.company_a, 'A off', 'offboarding')
        cls.off_b_step = cls._run(cls.company_b, 'B off step', 'offboarding')
        for run in (cls.run_b_step, cls.off_b_step):
            step = cls.env['mail.activity'].with_context(mail_activity_quick_update=True).create({
                'res_model_id': cls.env['ir.model']._get_id('hr.employee'), 'res_id': run.employee_id.id,
                'activity_type_id': cls.env.ref(TODO).id, 'user_id': cls.user.id, 'summary': 'Cross step',
            })
            run.activity_ids = [Command.link(step.id)]

    @classmethod
    def _run(cls, company, name, purpose='onboarding'):
        employee = cls.env['hr.employee'].create({'name': f'Runs {name}', 'company_id': company.id})
        plan = cls.env['mail.activity.plan'].create({
            'name': f'Runs plan {name}', 'res_model': 'hr.employee', 'hr_purpose': purpose, 'company_id': company.id,
        })
        return cls.env['liwan.hr.plan.run'].create({
            'employee_id': employee.id, 'plan_id': plan.id, 'plan_date': '2026-01-01',
        })

    def _runs(self, company):
        return self.env['liwan.hr.plan.run'].with_user(self.user).with_context(allowed_company_ids=company.ids)

    def test_the_other_company_runs_are_not_read_through_the_roles_of_another_company(self):
        # In B the user only reads employees: the onboarding run with their step is theirs, and nothing else is,
        # neither the other onboarding run nor the offboarding run, a step of theirs on it included.
        runs = self._runs(self.company_b)
        self.assertEqual(runs.search([]).ids, [self.run_b_step.id])
        for run in (self.run_b_other, self.off_b_step):
            with self.assertRaises(AccessError):
                runs.browse(run.id).read(['plan_date'])

    def test_the_area_reader_reads_the_runs_of_their_company(self):
        runs = self._runs(self.company_a)
        self.assertEqual(set(runs.search([]).ids), {self.run_a.id, self.off_a.id})
        for run in (self.run_a, self.off_a):
            self.assertEqual(runs.browse(run.id).read(['plan_date'])[0]['id'], run.id)
