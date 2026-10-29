# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature

PLAN_KEYS = {'id', 'name', 'department', 'active', 'steps'}
STEP_KEYS = {'id', 'summary', 'responsible_type', 'responsible', 'delay_count', 'delay_unit', 'delay_from'}
RUN_KEYS = {'id', 'employee', 'plan', 'plan_date', 'launched_by', 'done', 'total', 'state', 'cancellation'}
RUN_STEP_KEYS = {'id', 'summary', 'assignee', 'date_deadline', 'state', 'date_done', 'can_complete'}
# Launching a plan posts a message on the employee, so the launcher also needs
# the employee management capability the engine's follower write requires.
MANAGER_KEYS = (
    'hr.employees.read', 'hr.employees.manage',
    'hr.onboarding.read', 'hr.onboarding.manage',
)
READER_KEYS = ('hr.employees.read', 'hr.onboarding.read')
TODO = 'mail.mail_activity_data_todo'


def _step(summary, responsible_type='manager', **extra):
    return {
        'summary': summary, 'responsible_type': responsible_type, 'delay_count': 0,
        'delay_unit': 'days', 'delay_from': 'before_plan_date', **extra,
    }


@tagged('post_install', '-at_install', 'webvue')
class TestHrOnboarding(WebVueHrCase):
    """The onboarding area over stock employee activity plans."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.manager = cls._make_user('hr_onboarding_mgr', 'Onboarding Manager', MANAGER_KEYS)
        cls.reader = cls._make_user('hr_onboarding_reader', 'Onboarding Reader', READER_KEYS)
        cls.lead = cls.env['hr.employee'].create({
            'name': 'Onboarding Lead', 'company_id': cls.company.id, 'user_id': cls.manager.id,
        })
        cls.employee_record = cls.env['hr.employee'].create({
            'name': 'Onboarding Employee', 'company_id': cls.company.id,
            'parent_id': cls.lead.id,
        })
        cls.plan = cls.env['mail.activity.plan'].create({
            'name': 'Onboarding plan',
            'res_model': 'hr.employee',
            'hr_purpose': 'onboarding',
            'company_id': cls.company.id,
        })
        cls.env['mail.activity.plan.template'].create({
            'plan_id': cls.plan.id,
            'summary': 'Prepare the desk',
            'activity_type_id': cls.env.ref(TODO).id,
            'responsible_type': 'manager',
            'delay_count': 0,
            'delay_unit': 'days',
            'delay_from': 'before_plan_date',
        })

    @classmethod
    def _make_user(cls, login, name, capability_keys):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        role = cls.env['webvue.access.role'].create({
            'key': login, 'name_ar': name, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                ('key', 'in', capability_keys),
            ]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.env.company.id,
        }])
        return user

    def _as_manager(self):
        self.authenticate('hr_onboarding_mgr', 'hr_onboarding_mgr_pass_123')

    def _as_reader(self):
        self.authenticate('hr_onboarding_reader', 'hr_onboarding_reader_pass_123')

    def _launch(self, plan=None):
        response = self.api('POST', '/api/v1/hr/onboarding/runs', json={
            'employee_id': self.employee_record.id,
            'plan_id': (plan or self.plan).id,
            'plan_date': '2026-11-02',
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_launch_without_a_date_starts_today(self):
        self._as_manager()
        response = self.api('POST', '/api/v1/hr/onboarding/runs', json={
            'employee_id': self.employee_record.id, 'plan_id': self.plan.id,
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['plan_date'], fields.Date.to_string(fields.Date.context_today(self.manager)))

    def test_an_inactive_plan_cannot_be_launched(self):
        self._as_manager()
        self.plan.sudo().active = False
        response = self.api('POST', '/api/v1/hr/onboarding/runs', json={
            'employee_id': self.employee_record.id, 'plan_id': self.plan.id,
        })
        self.assertEqual((response.status_code, response.json()['field']), (422, 'plan_id'))

    def test_plan_create_list_get_patch(self):
        self._as_manager()
        response = self.api('POST', '/api/v1/hr/onboarding/plans', json={
            'name': '  تهيئة  ',
            'steps': [
                _step('تجهيز المكتب'),
                _step('تسليم العهدة', 'other', responsible_user_id=self.reader.id),
            ],
        })
        self.assertEqual(response.status_code, 201, response.text)
        plan = response.json()
        self.assertEqual(set(plan), PLAN_KEYS)
        self.assertEqual(plan['name'], 'تهيئة')
        self.assertEqual(set(plan['steps'][0]), STEP_KEYS)
        self.assertEqual(plan['steps'][1]['responsible'], {'id': self.reader.id, 'name': self.reader.name})
        self.assertEqual(plan['steps'][0]['responsible'], None)
        # The engine holds one template per step, all with the stock todo type.
        templates = self.env['mail.activity.plan'].browse(plan['id']).template_ids
        self.assertEqual(len(templates), 2)
        self.assertEqual(set(templates.mapped('activity_type_id.id')), {self.env.ref(TODO).id})

        listing = self.api('GET', '/api/v1/hr/onboarding/plans')
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(set(listing.json()), {'items', 'total'})
        self.assertIn(plan['id'], {item['id'] for item in listing.json()['items']})
        self.assertIn(self.plan.id, {item['id'] for item in listing.json()['items']})

        one = self.api('GET', f"/api/v1/hr/onboarding/plans/{plan['id']}")
        self.assertEqual(one.status_code, 200, one.text)
        self.assertEqual(set(one.json()), PLAN_KEYS)

        patched = self.api('PATCH', f"/api/v1/hr/onboarding/plans/{plan['id']}", json={
            'name': 'تهيئة ثانية', 'active': False, 'steps': [_step('خطوة واحدة')],
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['name'], 'تهيئة ثانية')
        self.assertEqual([item['summary'] for item in patched.json()['steps']], ['خطوة واحدة'])
        self.assertFalse(patched.json()['active'])
        # An inactive plan leaves the default listing.
        default = self.api('GET', '/api/v1/hr/onboarding/plans').json()
        self.assertNotIn(plan['id'], {item['id'] for item in default['items']})
        every = self.api('GET', '/api/v1/hr/onboarding/plans?active=all').json()
        self.assertIn(plan['id'], {item['id'] for item in every['items']})

    def test_plan_payload_is_strict(self):
        self._as_manager()
        cases = (
            ({'name': 'خطة', 'steps': [_step('خطوة')], 'hr_purpose': 'offboarding'}, 'hr_purpose'),
            ({'steps': [_step('خطوة')]}, 'name'),
            ({'name': 'خطة'}, 'steps'),
            ({'name': 'خطة', 'steps': []}, 'steps'),
            ({'name': 'خطة', 'steps': [_step('خطوة', 'other')]}, 'responsible_user_id'),
            ({'name': 'خطة', 'steps': [_step('خطوة', 'coach', responsible_user_id=7)]}, 'responsible_user_id'),
            ({'name': 'خطة', 'steps': [dict(_step('خطوة'), delay_count=-1)]}, 'delay_count'),
            ({'name': 'خطة', 'steps': [dict(_step('خطوة'), delay_unit='hours')]}, 'delay_unit'),
            ({'name': 'خطة', 'steps': [_step('خطوة', 'other', responsible_user_id=9999999)]}, 'responsible_user_id'),
            ({'name': 'خطة', 'steps': [_step('خطوة')], 'department_id': 9999999}, 'department_id'),
        )
        for payload, field in cases:
            response = self.api('POST', '/api/v1/hr/onboarding/plans', json=payload)
            self.assertEqual(response.status_code, 422, (payload, response.text))
            self.assertEqual(response.json()['field'], field, payload)
        response = self.api('PATCH', f'/api/v1/hr/onboarding/plans/{self.plan.id}', json={})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))

    def test_launch_records_the_run_and_the_checklist(self):
        self._as_manager()
        run = self._launch()
        self.assertEqual(set(run), RUN_KEYS | {'steps', 'can_cancel'})
        self.assertEqual((run['done'], run['total'], run['state']), (0, 1, 'open'))
        self.assertEqual(run['plan_date'], '2026-11-02')
        self.assertEqual(run['employee'], {'id': self.employee_record.id, 'name': self.employee_record.name})
        self.assertEqual(run['launched_by']['id'], self.manager.id)
        self.assertEqual(set(run['steps'][0]), RUN_STEP_KEYS)
        self.assertTrue(run['steps'][0]['can_complete'])
        # The engine created the plan's activities on the employee.
        self.assertEqual(len(self.env['webvue.hr.plan.run'].browse(run['id']).activity_ids), 1)
        self.assertTrue(self.employee_record.activity_ids)

        detail = self.api('GET', f"/api/v1/hr/onboarding/runs/{run['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(set(detail.json()), RUN_KEYS | {'steps', 'can_cancel'})
        self.assertEqual(detail.json()['steps'][0]['id'], run['steps'][0]['id'])

        listing = self.api('GET', '/api/v1/hr/onboarding/runs?state=open')
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(set(listing.json()), {'items', 'total'})
        self.assertIn(run['id'], {item['id'] for item in listing.json()['items']})
        self.assertEqual(self.api('GET', '/api/v1/hr/onboarding/runs?state=done').json()['items'], [])

        step_id = run['steps'][0]['id']
        done = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/{step_id}/done", json={'feedback': 'تم'})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual((done.json()['done'], done.json()['total'], done.json()['state']), (1, 1, 'done'))
        self.assertEqual(done.json()['steps'][0]['state'], 'done')
        self.assertFalse(done.json()['steps'][0]['can_complete'])
        self.assertIn(run['id'], {item['id'] for item in self.api('GET', '/api/v1/hr/onboarding/runs?state=done').json()['items']})
        again = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/{step_id}/done", json={})
        self.assertEqual((again.status_code, again.json()['code']), (422, 'invalid'))

    def test_assignee_completes_their_own_step_without_manage(self):
        plan = self.env['mail.activity.plan'].create({
            'name': 'Reader plan', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding',
            'company_id': self.company.id,
        })
        self.env['mail.activity.plan.template'].create({
            'plan_id': plan.id, 'summary': 'Sign the policy',
            'activity_type_id': self.env.ref(TODO).id, 'responsible_type': 'other',
            'responsible_id': self.reader.id, 'delay_count': 0, 'delay_unit': 'days',
            'delay_from': 'before_plan_date',
        })
        self._as_manager()
        run = self._launch(plan)
        self.assertEqual(run['steps'][0]['assignee'], {'id': self.reader.id, 'name': self.reader.name})

        self._as_reader()
        step_id = run['steps'][0]['id']
        done = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/{step_id}/done", json={})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()['steps'][0]['state'], 'done')
        self.assertFalse(done.json()['steps'][0]['can_complete'])

    def test_a_reader_who_is_not_the_assignee_cannot_complete_a_step(self):
        self._as_manager()
        run = self._launch()
        self._as_reader()
        step_id = run['steps'][0]['id']
        response = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/{step_id}/done", json={})
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        # A step of another run (or another purpose) is not found for this area.
        missing = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/9999999/done", json={})
        self.assertEqual((missing.status_code, missing.json()['code']), (404, 'not_found'))

    def test_write_routes_need_the_manage_capability(self):
        self._as_reader()
        for method, path, payload in (
            ('POST', '/api/v1/hr/onboarding/plans', {'name': 'خطة', 'steps': [_step('خطوة')]}),
            ('PATCH', f'/api/v1/hr/onboarding/plans/{self.plan.id}', {'name': 'خطة'}),
            ('POST', '/api/v1/hr/onboarding/runs', {'employee_id': self.employee_record.id, 'plan_id': self.plan.id}),
        ):
            response = self.api(method, path, json=payload)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), (method, path))
        # Reading stays available to the read capability.
        self.assertEqual(self.api('GET', '/api/v1/hr/onboarding/plans').status_code, 200)

    def test_feature_gate_hides_the_area(self):
        self._as_manager()
        set_hr_feature(self, 'hr.onboarding', False)
        response = self.api('GET', '/api/v1/hr/onboarding/plans')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
        set_hr_feature(self, 'hr.onboarding', True)
        set_hr_feature(self, 'hr.enabled', False)
        response = self.api('GET', '/api/v1/hr/onboarding/runs')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))

    def test_another_company_is_a_404(self):
        other_company = self.env['res.company'].create({'name': 'Onboarding Other Co'})
        foreign_employee = self.env['hr.employee'].create({
            'name': 'Foreign Onboarding', 'company_id': other_company.id,
        })
        foreign_plan = self.env['mail.activity.plan'].create({
            'name': 'Foreign plan', 'res_model': 'hr.employee',
            'hr_purpose': 'onboarding', 'company_id': other_company.id,
        })
        foreign_run = self.env['webvue.hr.plan.run'].create({
            'employee_id': foreign_employee.id, 'plan_id': foreign_plan.id, 'plan_date': '2026-11-02',
        })
        self._as_manager()
        for method, path, payload in (
            ('GET', f'/api/v1/hr/onboarding/plans/{foreign_plan.id}', None),
            ('GET', f'/api/v1/hr/onboarding/runs/{foreign_run.id}', None),
            ('POST', '/api/v1/hr/onboarding/runs', {
                'employee_id': foreign_employee.id, 'plan_id': self.plan.id,
            }),
            ('POST', '/api/v1/hr/onboarding/runs', {
                'employee_id': self.employee_record.id, 'plan_id': foreign_plan.id,
            }),
        ):
            response = self.api(method, path, json=payload)
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), (method, path))

    def test_a_plan_and_its_department_stay_in_one_company(self):
        other_company = self.env['res.company'].create({'name': 'Onboarding Pair Other Co'})
        own = self.env['hr.department'].create({'name': 'Onb Own', 'company_id': self.company.id})
        foreign = self.env['hr.department'].create({'name': 'Onb Foreign', 'company_id': other_company.id})
        plan = self.plan.copy({'name': 'Onboarding pair plan'})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            plan.write({'department_id': foreign.id})
        plan.department_id = own
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            plan.write({'company_id': other_company.id})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.env['mail.activity.plan'].create({
                'name': 'Mismatch', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding',
                'company_id': self.company.id, 'department_id': foreign.id,
            })
        self.assertEqual((plan.company_id, plan.department_id), (self.company, own))
        # A companyless side stays allowed.
        plan.department_id = False
        plan.company_id = False
        plan.company_id = self.company
        companyless = self.env['hr.department'].create({'name': 'Onb Companyless', 'company_id': False})
        plan.department_id = companyless
        self.assertEqual(plan.department_id, companyless)

    def test_a_department_linked_to_a_plan_cannot_move_to_another_company(self):
        department = self.env['hr.department'].create({'name': 'Onb Pinned', 'company_id': self.company.id})
        other_company = self.env['res.company'].create({'name': 'Onboarding Move Other Co'})
        bound = self.plan.copy({'name': 'Onboarding pinned plan'})
        bound.department_id = department
        bound.active = False
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            department.company_id = other_company
        self.assertEqual(department.company_id, self.company)
        bound.active = True
        self._as_reader()
        expected = {'id': department.id, 'name': 'Onb Pinned'}
        listing = self.api('GET', '/api/v1/hr/onboarding/plans')
        self.assertEqual({i['id']: i['department'] for i in listing.json()['items']}[bound.id], expected)
        one = self.api('GET', f'/api/v1/hr/onboarding/plans/{bound.id}')
        self.assertEqual(one.json()['department'], expected)

    def test_reader_without_department_access_sees_the_plan_department_reference(self):
        department = self.env['hr.department'].create({'name': 'Onb Parent', 'company_id': self.company.id})
        child = self.env['hr.department'].create({
            'name': 'Onb Child', 'company_id': self.company.id, 'parent_id': department.id,
        })
        bound = self.plan.copy({'name': 'Onboarding dept plan'})
        bound.department_id = department
        nested = self.plan.copy({'name': 'Onboarding sub dept plan'})
        nested.department_id = child
        other_company = self.env['res.company'].create({'name': 'Onboarding Dept Other Co'})
        foreign_department = self.env['hr.department'].create({
            'name': 'Foreign Onb Dept', 'company_id': other_company.id,
        })
        foreign_plan = self.plan.copy({'name': 'Foreign onboarding plan', 'company_id': other_company.id})
        self._as_reader()
        listing = self.api('GET', '/api/v1/hr/onboarding/plans')
        self.assertEqual(listing.status_code, 200, listing.text)
        by_id = {item['id']: item for item in listing.json()['items']}
        self.assertEqual(by_id[bound.id]['department'], {'id': department.id, 'name': 'Onb Parent'})
        self.assertEqual(by_id[nested.id]['department'], {'id': child.id, 'name': 'Onb Child'})
        self.assertIsNone(by_id[self.plan.id]['department'])
        self.assertNotIn(foreign_plan.id, by_id)
        one = self.api('GET', f'/api/v1/hr/onboarding/plans/{bound.id}')
        self.assertEqual(one.status_code, 200, one.text)
        self.assertEqual(one.json()['department'], {'id': department.id, 'name': 'Onb Parent'})
        foreign = self.api('GET', f'/api/v1/hr/onboarding/plans/{foreign_plan.id}')
        self.assertEqual((foreign.status_code, foreign.json()['code']), (404, 'not_found'))
        for path in ('/api/v1/hr/departments', f'/api/v1/hr/departments/{department.id}'):
            denied = self.api('GET', path)
            self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'), path)
        # Linking another company's department is refused (needs the department read to resolve it).
        self._as_manager()
        refused = self.api('POST', '/api/v1/hr/onboarding/plans', json={
            'name': 'خطة', 'steps': [_step('خطوة')], 'department_id': foreign_department.id,
        })
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'department_id'))

    def test_a_shared_plan_stays_free_of_company_departments(self):
        shared = self.plan.copy({'name': 'Onboarding shared plan', 'company_id': False})
        department = self.env['hr.department'].create({'name': 'Onb Shared Dept', 'company_id': self.company.id})
        # The ORM refuses a company department on a shared plan, from either side.
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            shared.write({'department_id': department.id})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.env['mail.activity.plan'].create({
                'name': 'Shared mismatch', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding',
                'company_id': False, 'department_id': department.id,
            })
        pinned = self.plan.copy({'name': 'Onboarding pinned shared check'})
        pinned.department_id = department
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            pinned.company_id = False
        self.assertEqual((shared.department_id, pinned.company_id), (self.env['hr.department'], self.company))
        # The department gaining a company while a shared plan targets it is refused.
        free = self.env['hr.department'].create({'name': 'Onb Free', 'company_id': False})
        shared.department_id = free
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            free.company_id = self.company
        self.assertFalse(free.company_id)
        # The route answers 422 department_id and leaves the plan unchanged.
        shared.department_id = False
        self._as_manager()
        refused = self.api('PATCH', f'/api/v1/hr/onboarding/plans/{shared.id}', json={'department_id': department.id})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'department_id'))
        self.assertFalse(shared.department_id)
        # A companyless department stays allowed on a shared plan; readers see only that one.
        shared.department_id = free
        self._as_reader()
        listed = {i['id']: i['department'] for i in self.api('GET', '/api/v1/hr/onboarding/plans').json()['items']}
        self.assertEqual(listed[shared.id], {'id': free.id, 'name': 'Onb Free'})
        one = self.api('GET', f'/api/v1/hr/onboarding/plans/{shared.id}').json()
        self.assertEqual(one['department'], {'id': free.id, 'name': 'Onb Free'})

    # --- cancelling a run launched by mistake ------------------------------------------

    def _two_step_run(self):
        """A run whose first step is done and whose second is still open."""
        plan = self.env['mail.activity.plan'].create({
            'name': 'Two steps', 'res_model': 'hr.employee', 'hr_purpose': 'onboarding',
            'company_id': self.company.id,
        })
        for summary in ('Issue the badge', 'Open the mailbox'):
            self.env['mail.activity.plan.template'].create({
                'plan_id': plan.id, 'summary': summary, 'activity_type_id': self.env.ref(TODO).id,
                'responsible_type': 'manager', 'delay_count': 0, 'delay_unit': 'days',
                'delay_from': 'before_plan_date',
            })
        self._as_manager()
        run = self._launch(plan)
        first = run['steps'][0]['id']
        done = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/{first}/done", json={})
        self.assertEqual(done.status_code, 200, done.text)
        return run, first

    def test_manager_cancels_a_run_and_keeps_its_done_steps(self):
        run, done_step = self._two_step_run()
        open_step = next(step['id'] for step in run['steps'] if step['id'] != done_step)
        record = self.env['webvue.hr.plan.run'].browse(run['id'])
        notes_before = len(self.employee_record.message_ids)
        self.assertTrue(run['can_cancel'])

        cancelled = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/cancel", json={'reason': ' wrong employee '})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        body = cancelled.json()
        self.assertEqual(set(body), RUN_KEYS | {'steps', 'can_cancel'})
        self.assertEqual(body['state'], 'cancelled')
        self.assertFalse(body['can_cancel'])
        self.assertEqual(body['cancellation']['by'], {'id': self.manager.id, 'name': self.manager.name})
        self.assertEqual(body['cancellation']['reason'], 'wrong employee')
        self.assertTrue(body['cancellation']['on'].endswith('Z'))
        # The open step is gone from the assignees' lists; the done one stays as history.
        self.assertEqual([step['id'] for step in body['steps']], [done_step])
        self.assertFalse(record.env['mail.activity'].with_context(active_test=False).browse(open_step).exists())
        self.assertEqual((body['done'], body['total']), (1, 1))
        self.assertEqual(len(self.employee_record.message_ids), notes_before + 1)
        self.assertIn('wrong employee', self.employee_record.message_ids[0].body)

        listed = self.api('GET', '/api/v1/hr/onboarding/runs?state=cancelled').json()
        self.assertIn(run['id'], {item['id'] for item in listed['items']})
        self.assertNotIn(run['id'], {item['id'] for item in self.api('GET', '/api/v1/hr/onboarding/runs?state=done').json()['items']})
        again = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/cancel", json={'reason': 'again'})
        self.assertEqual((again.status_code, again.json()['code']), (422, 'invalid'))

    def test_a_done_run_is_not_cancelled_and_a_reason_is_required(self):
        self._as_manager()
        run = self._launch()
        missing = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/cancel", json={'reason': '  '})
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'reason'))
        unknown = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/cancel", json={'reason': 'x', 'state': 'open'})
        self.assertEqual((unknown.status_code, unknown.json()['field']), (422, 'state'))
        step_id = run['steps'][0]['id']
        self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/steps/{step_id}/done", json={})
        done = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/cancel", json={'reason': 'late'})
        self.assertEqual((done.status_code, done.json()['code']), (422, 'invalid'))
        self.assertEqual(self.env['webvue.hr.plan.run'].browse(run['id']).state, 'open')

    def test_cancel_needs_the_manage_capability(self):
        self._as_manager()
        run = self._launch()
        self._as_reader()
        detail = self.api('GET', f"/api/v1/hr/onboarding/runs/{run['id']}")
        self.assertFalse(detail.json()['can_cancel'])
        denied = self.api('POST', f"/api/v1/hr/onboarding/runs/{run['id']}/cancel", json={'reason': 'mine'})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.env['webvue.hr.plan.run'].browse(run['id']).state, 'open')
