# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase, set_hr_feature
from .test_hr_offboarding import MANAGER_KEYS, READER_KEYS, RUN_KEYS
from .test_hr_onboarding import PLAN_KEYS, RUN_STEP_KEYS, STEP_KEYS

PLANS = '/api/v1/hr/offboarding/plans'
RUNS = '/api/v1/hr/offboarding/runs'
TODO = 'mail.mail_activity_data_todo'
ONBOARDING_MANAGER_KEYS = (
    'hr.employees.read', 'hr.employees.manage', 'hr.onboarding.read', 'hr.onboarding.manage',
)


def _step(summary, responsible_type='manager', **extra):
    return {
        'summary': summary, 'responsible_type': responsible_type, 'delay_count': 0,
        'delay_unit': 'days', 'delay_from': 'before_plan_date', **extra,
    }


@tagged('post_install', '-at_install', 'liwan')
class TestHrOffboardingPlans(LiwanHrCase):
    """The offboarding plan routes and the run launch over stock employee activity plans."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.manager = cls._make_user(
            'hr_ofbplan_mgr', 'Offboarding Plan Manager', (*MANAGER_KEYS, 'hr.departments.read'),
        )
        cls.reader = cls._make_user('hr_ofbplan_reader', 'Offboarding Plan Reader', READER_KEYS)
        cls.onboarding_only = cls._make_user('hr_ofbplan_onb', 'Onboarding Only', ONBOARDING_MANAGER_KEYS)
        cls.no_capability = cls._make_user('hr_ofbplan_none', 'No Capability', ('hr.employees.read',))
        # The stock launch resolves a `manager` step from the employee's manager user.
        cls.lead_user = new_test_user(
            cls.env, login='hr_ofbplan_lead', password='hr_ofbplan_lead_pass_123',
            name='Offboarding Plan Lead', groups='liwan_core.group_employee',
        )
        cls.lead = cls.env['hr.employee'].create({
            'name': 'Offboarding Plan Lead', 'company_id': cls.company.id, 'user_id': cls.lead_user.id,
        })
        cls.employee_record = cls.env['hr.employee'].create({
            'name': 'Plan Leaving Employee', 'company_id': cls.company.id, 'parent_id': cls.lead.id,
        })
        cls.own_employee = cls.env['hr.employee'].create({
            'name': 'Plan Manager Employee', 'company_id': cls.company.id,
            'user_id': cls.manager.id, 'parent_id': cls.lead.id,
        })
        cls.department = cls.env['hr.department'].create({'name': 'Plan Dept', 'company_id': cls.company.id})
        cls.plan = cls._make_plan('Own offboarding plan', 'offboarding', cls.company, 'Collect the laptop')
        cls.onboarding_plan = cls._make_plan('Own onboarding plan', 'onboarding', cls.company, 'Prepare the desk')
        cls.onboarding_run = cls.env['liwan.hr.plan.run'].create({
            'employee_id': cls.employee_record.id, 'plan_id': cls.onboarding_plan.id,
            'plan_date': '2026-11-02',
        })
        cls.other_company = cls.env['res.company'].create({'name': 'Offboarding Plans Other Co'})
        cls.foreign_employee = cls.env['hr.employee'].create({
            'name': 'Foreign Plan Employee', 'company_id': cls.other_company.id,
        })
        cls.foreign_department = cls.env['hr.department'].create({
            'name': 'Foreign Plan Dept', 'company_id': cls.other_company.id,
        })
        cls.foreign_plan = cls._make_plan('Foreign offboarding plan', 'offboarding', cls.other_company, 'Foreign step')
        cls.foreign_run = cls.env['liwan.hr.plan.run'].create({
            'employee_id': cls.foreign_employee.id, 'plan_id': cls.foreign_plan.id, 'plan_date': '2026-11-02',
        })

    @classmethod
    def _make_user(cls, login, name, capability_keys):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': name, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', capability_keys),
            ]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.env.company.id,
        }])
        return user

    @classmethod
    def _make_plan(cls, name, purpose, company, summary):
        plan = cls.env['mail.activity.plan'].create({
            'name': name, 'res_model': 'hr.employee', 'hr_purpose': purpose, 'company_id': company.id,
        })
        cls.env['mail.activity.plan.template'].create({
            'plan_id': plan.id, 'summary': summary, 'activity_type_id': cls.env.ref(TODO).id,
            'responsible_type': 'manager', 'delay_count': 0, 'delay_unit': 'days',
            'delay_from': 'before_plan_date',
        })
        return plan

    def _as(self, login):
        self.authenticate(login, f'{login}_pass_123')

    def _as_manager(self):
        self._as('hr_ofbplan_mgr')

    def _as_reader(self):
        self._as('hr_ofbplan_reader')

    def _plans(self):
        return self.env['mail.activity.plan'].with_context(active_test=False).search([
            ('hr_purpose', '=', 'offboarding'),
        ])

    def _runs(self):
        return self.env['liwan.hr.plan.run'].search([])

    def _listed_ids(self, query=''):
        response = self.api('GET', f'{PLANS}{query}')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(body['total'], len(body['items']))
        return {item['id'] for item in body['items']}

    def _launch(self, plan=None, employee=None, **extra):
        return self.api('POST', RUNS, json={
            'employee_id': (employee or self.employee_record).id,
            'plan_id': (plan or self.plan).id,
            **extra,
        })

    # --- plans -------------------------------------------------------------------

    def test_plan_create_returns_the_full_detail_and_stores_the_engine_records(self):
        self._as_manager()
        response = self.api('POST', PLANS, json={
            'name': '  مغادرة  ',
            'department_id': self.department.id,
            'steps': [
                _step('  استلام الجهاز  ', delay_count=3, delay_unit='weeks', delay_from='after_plan_date'),
                _step('تسليم العهدة', 'other', responsible_user_id=self.reader.id),
            ],
        })
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(set(body), PLAN_KEYS)
        self.assertEqual(body['name'], 'مغادرة')
        self.assertEqual(body['department'], {'id': self.department.id, 'name': self.department.name})
        self.assertIs(body['active'], True)
        self.assertEqual([set(step) for step in body['steps']], [STEP_KEYS, STEP_KEYS])
        first, second = body['steps']
        self.assertEqual(
            {key: first[key] for key in STEP_KEYS - {'id'}},
            {
                'summary': 'استلام الجهاز', 'responsible_type': 'manager', 'responsible': None,
                'delay_count': 3, 'delay_unit': 'weeks', 'delay_from': 'after_plan_date',
            },
        )
        self.assertEqual(second['responsible_type'], 'other')
        self.assertEqual(second['responsible'], {'id': self.reader.id, 'name': self.reader.name})
        plan = self.env['mail.activity.plan'].browse(body['id'])
        self.assertEqual(
            (plan.hr_purpose, plan.res_model, plan.company_id, plan.department_id, plan.active),
            ('offboarding', 'hr.employee', self.company, self.department, True),
        )
        self.assertEqual(plan.template_ids.sorted('id').mapped('summary'), ['استلام الجهاز', 'تسليم العهدة'])
        self.assertEqual(set(plan.template_ids.mapped('activity_type_id.id')), {self.env.ref(TODO).id})

    def test_plan_list_and_get_are_scoped_to_the_offboarding_plans_of_the_company(self):
        self._as_manager()
        created = self.api('POST', PLANS, json={'name': 'خطة مضافة', 'steps': [_step('خطوة')]}).json()
        listed = self._listed_ids()
        self.assertTrue({self.plan.id, created['id']} <= listed)
        self.assertNotIn(self.onboarding_plan.id, listed)
        self.assertNotIn(self.foreign_plan.id, listed)

        one = self.api('GET', f"{PLANS}/{self.plan.id}")
        self.assertEqual(one.status_code, 200, one.text)
        self.assertEqual(set(one.json()), PLAN_KEYS)
        self.assertEqual(one.json()['id'], self.plan.id)
        self.assertEqual(one.json()['name'], self.plan.name)
        self.assertEqual([step['summary'] for step in one.json()['steps']], ['Collect the laptop'])

        # Another purpose's plan is not an offboarding plan.
        wrong_area = self.api('GET', f'{PLANS}/{self.onboarding_plan.id}')
        self.assertEqual((wrong_area.status_code, wrong_area.json()['code']), (404, 'not_found'))
        missing = self.api('GET', f'{PLANS}/999999999')
        self.assertEqual((missing.status_code, missing.json()['code']), (404, 'not_found'))
        # The paging window is honoured and total still counts every match.
        page = self.api('GET', f'{PLANS}?limit=1').json()
        self.assertEqual(len(page['items']), 1)
        self.assertGreaterEqual(page['total'], 2)
        bad = self.api('GET', f'{PLANS}?active=maybe')
        self.assertEqual((bad.status_code, bad.json()['code'], bad.json()['field']), (422, 'invalid', 'active'))

    def test_plan_patch_replaces_the_steps_and_deactivates_the_plan(self):
        self._as_manager()
        plan_id = self.api('POST', PLANS, json={
            'name': 'للتعديل', 'department_id': self.department.id,
            'steps': [_step('أولى'), _step('ثانية'), _step('ثالثة')],
        }).json()['id']
        plan = self.env['mail.activity.plan'].browse(plan_id)
        old_templates = plan.template_ids

        # A name-only patch leaves the steps and the department untouched.
        renamed = self.api('PATCH', f'{PLANS}/{plan_id}', json={'name': ' اسم جديد '})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual(set(renamed.json()), PLAN_KEYS)
        self.assertEqual(renamed.json()['name'], 'اسم جديد')
        self.assertEqual([step['summary'] for step in renamed.json()['steps']], ['أولى', 'ثانية', 'ثالثة'])
        self.assertEqual(renamed.json()['department']['id'], self.department.id)
        self.assertEqual(plan.template_ids, old_templates)

        # A steps patch replaces every template and clears the department on null.
        replaced = self.api('PATCH', f'{PLANS}/{plan_id}', json={
            'department_id': None,
            'steps': [_step('وحيدة', 'other', responsible_user_id=self.reader.id, delay_count=2)],
        })
        self.assertEqual(replaced.status_code, 200, replaced.text)
        self.assertIsNone(replaced.json()['department'])
        self.assertEqual(len(replaced.json()['steps']), 1)
        step = replaced.json()['steps'][0]
        self.assertEqual((step['summary'], step['delay_count']), ('وحيدة', 2))
        self.assertEqual(step['responsible'], {'id': self.reader.id, 'name': self.reader.name})
        self.assertFalse(old_templates.exists())
        self.assertEqual(plan.template_ids.mapped('summary'), ['وحيدة'])
        self.assertFalse(plan.department_id)

        # Deactivating hides the plan from the default list but not from the others or the detail.
        deactivated = self.api('PATCH', f'{PLANS}/{plan_id}', json={'active': False})
        self.assertEqual(deactivated.status_code, 200, deactivated.text)
        self.assertIs(deactivated.json()['active'], False)
        self.assertFalse(plan.active)
        self.assertNotIn(plan_id, self._listed_ids())
        self.assertIn(plan_id, self._listed_ids('?active=false'))
        self.assertIn(plan_id, self._listed_ids('?active=all'))
        self.assertIs(self.api('GET', f'{PLANS}/{plan_id}').json()['active'], False)

        reactivated = self.api('PATCH', f'{PLANS}/{plan_id}', json={'active': True})
        self.assertEqual(reactivated.status_code, 200, reactivated.text)
        self.assertIn(plan_id, self._listed_ids())
        self.assertNotIn(plan_id, self._listed_ids('?active=false'))

    def test_plan_payload_is_strict_and_a_refused_write_leaves_no_record(self):
        self._as_manager()
        before = self._plans()
        cases = (
            ({'name': 'خطة', 'steps': [_step('خطوة')], 'hr_purpose': 'onboarding'}, 'hr_purpose'),
            ({'name': 'خطة', 'steps': [_step('خطوة')], 'active': False}, 'active'),
            ({'steps': [_step('خطوة')]}, 'name'),
            ({'name': '  ', 'steps': [_step('خطوة')]}, 'name'),
            ({'name': 'خطة'}, 'steps'),
            ({'name': 'خطة', 'steps': []}, 'steps'),
            ({'name': 'خطة', 'steps': [_step('خطوة', 'other')]}, 'responsible_user_id'),
            ({'name': 'خطة', 'steps': [_step('خطوة', 'coach', responsible_user_id=7)]}, 'responsible_user_id'),
            ({'name': 'خطة', 'steps': [_step('خطوة', 'other', responsible_user_id=999999999)]}, 'responsible_user_id'),
            ({'name': 'خطة', 'steps': [dict(_step('خطوة'), delay_count=-1)]}, 'delay_count'),
            ({'name': 'خطة', 'steps': [dict(_step('خطوة'), delay_unit='hours')]}, 'delay_unit'),
            ({'name': 'خطة', 'steps': [dict(_step('خطوة'), delay_from='during')]}, 'delay_from'),
            ({'name': 'خطة', 'steps': [dict(_step('خطوة'), summary=' ')]}, 'summary'),
            ({'name': 'خطة', 'steps': [_step('خطوة')], 'department_id': 999999999}, 'department_id'),
            # A department of another company is not available to the caller.
            ({'name': 'خطة', 'steps': [_step('خطوة')], 'department_id': self.foreign_department.id}, 'department_id'),
        )
        for payload, field in cases:
            response = self.api('POST', PLANS, json=payload)
            self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), (payload, response.text))
            self.assertEqual(response.json()['field'], field, payload)
        self.assertEqual(self._plans(), before)

        snapshot = (self.plan.name, self.plan.template_ids.ids, self.plan.active)
        for payload, field in (
            ({'hr_purpose': 'onboarding'}, 'hr_purpose'),
            ({'active': 'false'}, 'active'),
            ({'name': ''}, 'name'),
            ({'steps': []}, 'steps'),
            ({'department_id': self.foreign_department.id}, 'department_id'),
        ):
            response = self.api('PATCH', f'{PLANS}/{self.plan.id}', json=payload)
            self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), payload)
            self.assertEqual(response.json()['field'], field, payload)
        empty = self.api('PATCH', f'{PLANS}/{self.plan.id}', json={})
        self.assertEqual((empty.status_code, empty.json()['code']), (422, 'invalid'))
        self.assertEqual((self.plan.name, self.plan.template_ids.ids, self.plan.active), snapshot)
        self.assertEqual(self.plan.hr_purpose, 'offboarding')

    def test_reader_reads_the_plans_but_cannot_write_them(self):
        self._as_reader()
        self.assertIn(self.plan.id, self._listed_ids())
        one = self.api('GET', f'{PLANS}/{self.plan.id}')
        self.assertEqual(one.status_code, 200, one.text)
        self.assertEqual(set(one.json()), PLAN_KEYS)
        before = self._plans()
        snapshot = (self.plan.name, self.plan.template_ids.ids, self.plan.active)
        created = self.api('POST', PLANS, json={'name': 'ممنوعة', 'steps': [_step('خطوة')]})
        self.assertEqual((created.status_code, created.json()['code']), (403, 'forbidden'))
        patched = self.api('PATCH', f'{PLANS}/{self.plan.id}', json={'name': 'ممنوعة', 'active': False})
        self.assertEqual((patched.status_code, patched.json()['code']), (403, 'forbidden'))
        self.assertEqual(self._plans(), before)
        self.assertEqual((self.plan.name, self.plan.template_ids.ids, self.plan.active), snapshot)

    def test_reader_without_department_access_sees_the_plan_department_reference(self):
        parent = self.env['hr.department'].create({'name': 'Plan Parent', 'company_id': self.company.id})
        child = self.env['hr.department'].create({
            'name': 'Plan Child', 'company_id': self.company.id, 'parent_id': parent.id,
        })
        bound = self._make_plan('Dept bound plan', 'offboarding', self.company, 'Bound step')
        bound.department_id = self.department
        nested = self._make_plan('Sub dept plan', 'offboarding', self.company, 'Nested step')
        nested.department_id = child
        self._as_reader()
        listing = self.api('GET', PLANS)
        self.assertEqual(listing.status_code, 200, listing.text)
        by_id = {item['id']: item for item in listing.json()['items']}
        self.assertEqual(by_id[bound.id]['department'], {'id': self.department.id, 'name': 'Plan Dept'})
        self.assertEqual(by_id[nested.id]['department'], {'id': child.id, 'name': 'Plan Child'})
        self.assertIsNone(by_id[self.plan.id]['department'])
        self.assertNotIn(self.foreign_plan.id, by_id)
        one = self.api('GET', f'{PLANS}/{bound.id}')
        self.assertEqual(one.status_code, 200, one.text)
        self.assertEqual(one.json()['department'], {'id': self.department.id, 'name': 'Plan Dept'})
        self.assertIsNone(self.api('GET', f'{PLANS}/{self.plan.id}').json()['department'])
        foreign = self.api('GET', f'{PLANS}/{self.foreign_plan.id}')
        self.assertEqual((foreign.status_code, foreign.json()['code']), (404, 'not_found'))
        # The plan read does not widen the department routes.
        for path in ('/api/v1/hr/departments', f'/api/v1/hr/departments/{self.department.id}'):
            denied = self.api('GET', path)
            self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'), path)

    def test_a_plan_and_its_department_stay_in_one_company(self):
        plans = self.env['mail.activity.plan']
        plan = self._make_plan('Same company plan', 'offboarding', self.company, 'Same step')
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            plan.write({'department_id': self.foreign_department.id})
        plan.department_id = self.department
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            plan.write({'company_id': self.other_company.id})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            plans.create({
                'name': 'Mismatch', 'res_model': 'hr.employee', 'hr_purpose': 'offboarding',
                'company_id': self.company.id, 'department_id': self.foreign_department.id,
            })
        self.assertEqual((plan.company_id, plan.department_id), (self.company, self.department))
        # A companyless side stays allowed.
        plan.department_id = False
        plan.company_id = False
        plan.company_id = self.company
        companyless = self.env['hr.department'].create({'name': 'Companyless Dept', 'company_id': False})
        plan.department_id = companyless
        self.assertEqual(plan.department_id, companyless)

    def test_a_department_linked_to_a_plan_cannot_move_to_another_company(self):
        bound = self._make_plan('Pinned dept plan', 'offboarding', self.company, 'Pinned step')
        bound.department_id = self.department
        bound.active = False
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.department.company_id = self.other_company
        self.assertEqual(self.department.company_id, self.company)
        bound.active = True
        self._as_reader()
        expected = {'id': self.department.id, 'name': 'Plan Dept'}
        listing = self.api('GET', PLANS)
        self.assertEqual({i['id']: i['department'] for i in listing.json()['items']}[bound.id], expected)
        self.assertEqual(self.api('GET', f'{PLANS}/{bound.id}').json()['department'], expected)

    def test_a_department_of_another_company_cannot_be_linked_to_a_plan(self):
        self._as_manager()
        created = self.api('POST', PLANS, json={
            'name': 'خطة', 'steps': [_step('خطوة')], 'department_id': self.foreign_department.id,
        })
        self.assertEqual((created.status_code, created.json()['field']), (422, 'department_id'))
        patched = self.api('PATCH', f'{PLANS}/{self.plan.id}', json={'department_id': self.foreign_department.id})
        self.assertEqual((patched.status_code, patched.json()['field']), (422, 'department_id'))
        self.assertFalse(self.plan.department_id)

    def test_a_caller_without_the_offboarding_capabilities_is_forbidden(self):
        before = self._plans()
        for login in ('hr_ofbplan_none', 'hr_ofbplan_onb'):
            self._as(login)
            for method, path, payload in (
                ('GET', PLANS, None),
                ('GET', f'{PLANS}/{self.plan.id}', None),
                ('POST', PLANS, {'name': 'ممنوعة', 'steps': [_step('خطوة')]}),
                ('PATCH', f'{PLANS}/{self.plan.id}', {'name': 'ممنوعة'}),
            ):
                response = self.api(method, path, json=payload)
                self.assertEqual(
                    (response.status_code, response.json()['code']), (403, 'forbidden'), (login, method, path),
                )
        self.assertEqual(self._plans(), before)
        self.assertEqual(self.plan.name, 'Own offboarding plan')

    def test_feature_gate_closes_the_plan_routes(self):
        self._as_manager()
        before = self._plans()
        for feature in ('hr.offboarding', 'hr.enabled'):
            set_hr_feature(self, feature, False)
            for method, path, payload in (
                ('GET', PLANS, None),
                ('GET', f'{PLANS}/{self.plan.id}', None),
                ('POST', PLANS, {'name': 'مغلقة', 'steps': [_step('خطوة')]}),
                ('PATCH', f'{PLANS}/{self.plan.id}', {'name': 'مغلقة'}),
            ):
                response = self.api(method, path, json=payload)
                self.assertEqual(
                    (response.status_code, response.json()['code']), (403, 'feature_not_included'),
                    (feature, method, path),
                )
            set_hr_feature(self, feature, True)
        self.assertEqual(self._plans(), before)
        self.assertEqual(self.plan.name, 'Own offboarding plan')
        self.assertEqual(self.api('GET', PLANS).status_code, 200)

    def test_another_company_plan_is_a_404_and_stays_untouched(self):
        self._as_manager()
        self.assertNotIn(self.foreign_plan.id, self._listed_ids('?active=all'))
        snapshot = (self.foreign_plan.name, self.foreign_plan.template_ids.ids, self.foreign_plan.active)
        for method, payload in (
            ('GET', None),
            ('PATCH', {'name': 'اختراق', 'active': False, 'steps': [_step('اختراق')]}),
        ):
            response = self.api(method, f'{PLANS}/{self.foreign_plan.id}', json=payload)
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), method)
        self.assertEqual(
            (self.foreign_plan.name, self.foreign_plan.template_ids.ids, self.foreign_plan.active), snapshot,
        )
        # A plan created through the API lands in the caller's company, never another one.
        created = self.api('POST', PLANS, json={'name': 'خطة الشركة', 'steps': [_step('خطوة')]})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.env['mail.activity.plan'].browse(created.json()['id']).company_id, self.company)

    # --- runs --------------------------------------------------------------------

    def test_run_launch_returns_201_and_the_detail_reflects_the_employee_and_plan(self):
        self._as_manager()
        runs_before = self._runs()
        response = self._launch(plan_date='2026-11-02')
        self.assertEqual(response.status_code, 201, response.text)
        run = response.json()
        self.assertEqual(set(run), RUN_KEYS | {'steps', 'can_cancel'})
        self.assertEqual(run['employee'], {'id': self.employee_record.id, 'name': self.employee_record.name})
        self.assertEqual(run['plan'], {'id': self.plan.id, 'name': self.plan.name})
        self.assertEqual(run['launched_by'], {'id': self.manager.id, 'name': self.manager.name})
        self.assertEqual((run['plan_date'], run['done'], run['total'], run['state']), ('2026-11-02', 0, 1, 'open'))
        self.assertEqual(len(run['steps']), 1)
        step = run['steps'][0]
        self.assertEqual(set(step), RUN_STEP_KEYS)
        self.assertEqual(step['summary'], 'Collect the laptop')
        self.assertEqual(step['assignee'], {'id': self.lead_user.id, 'name': self.lead_user.name})
        self.assertNotEqual(step['state'], 'done')
        self.assertTrue(step['can_complete'])

        record = self.env['liwan.hr.plan.run'].browse(run['id'])
        self.assertEqual(self._runs() - runs_before, record)
        self.assertEqual((record.employee_id, record.plan_id, record.launched_by_id), (self.employee_record, self.plan, self.manager))
        self.assertEqual(record.activity_ids.ids, [step['id']])
        self.assertEqual(record.activity_ids.res_id, self.employee_record.id)

        detail = self.api('GET', f"{RUNS}/{run['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json(), run)

    def test_a_plan_created_through_the_api_can_be_launched(self):
        self._as_manager()
        plan = self.api('POST', PLANS, json={
            'name': 'خطة للإطلاق', 'steps': [_step('استلام البطاقة'), _step('إغلاق الحساب', delay_count=1)],
        })
        self.assertEqual(plan.status_code, 201, plan.text)
        run = self._launch(plan=self.env['mail.activity.plan'].browse(plan.json()['id']), plan_date='2026-11-02')
        self.assertEqual(run.status_code, 201, run.text)
        self.assertEqual(run.json()['plan'], {'id': plan.json()['id'], 'name': 'خطة للإطلاق'})
        self.assertEqual((run.json()['done'], run.json()['total']), (0, 2))
        self.assertEqual(
            sorted(step['summary'] for step in run.json()['steps']), ['إغلاق الحساب', 'استلام البطاقة'],
        )

    def test_the_reader_sees_a_run_but_cannot_launch_one(self):
        self._as_manager()
        run = self._launch(plan_date='2026-11-02').json()
        self._as_reader()
        detail = self.api('GET', f"{RUNS}/{run['id']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['employee'], run['employee'])
        self.assertEqual(detail.json()['plan'], run['plan'])
        self.assertFalse(detail.json()['steps'][0]['can_complete'])

        runs_before = self._runs()
        denied = self._launch(employee=self.own_employee)
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        self.assertEqual(self._runs(), runs_before)
        self.assertFalse(self.own_employee.activity_ids)

    def test_self_launch_is_forbidden_and_creates_nothing(self):
        self._as_manager()
        runs_before = self._runs()
        activities_before = self.own_employee.activity_ids
        response = self._launch(employee=self.own_employee, plan_date='2026-11-02')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.assertEqual(self._runs(), runs_before)
        self.assertEqual(self.own_employee.activity_ids, activities_before)

    def test_a_launch_refused_for_the_area_or_the_company_creates_nothing(self):
        self._as_manager()
        runs_before = self._runs()
        activities_before = self.env['mail.activity'].search([])
        for payload_employee, payload_plan in (
            (self.employee_record, self.onboarding_plan),
            (self.employee_record, self.foreign_plan),
            (self.foreign_employee, self.plan),
        ):
            response = self._launch(plan=payload_plan, employee=payload_employee)
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), response.text)
        self.assertEqual(self._runs(), runs_before)
        self.assertEqual(self.env['mail.activity'].search([]), activities_before)
        # Runs of another purpose or company are not found through the offboarding area.
        for run in (self.onboarding_run, self.foreign_run):
            response = self.api('GET', f'{RUNS}/{run.id}')
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), run)

    def test_a_shared_plan_stays_free_of_company_departments(self):
        shared = self._make_plan('Shared offboarding plan', 'offboarding', self.env['res.company'], 'Shared step')
        department = self.department
        # The ORM refuses a company department on a shared plan, from either side.
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            shared.write({'department_id': department.id})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.env['mail.activity.plan'].create({
                'name': 'Shared mismatch', 'res_model': 'hr.employee', 'hr_purpose': 'offboarding',
                'company_id': False, 'department_id': department.id,
            })
        pinned = self._make_plan('Pinned shared check', 'offboarding', self.company, 'Pin step')
        pinned.department_id = department
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            pinned.company_id = False
        self.assertEqual((shared.department_id, pinned.company_id), (self.env['hr.department'], self.company))
        # The department gaining a company while a shared plan targets it is refused.
        free = self.env['hr.department'].create({'name': 'Ofb Free', 'company_id': False})
        shared.department_id = free
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            free.company_id = self.company
        self.assertFalse(free.company_id)
        # The route answers 422 department_id and leaves the plan unchanged.
        shared.department_id = False
        self._as_manager()
        refused = self.api('PATCH', f'{PLANS}/{shared.id}', json={'department_id': department.id})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'department_id'))
        self.assertFalse(shared.department_id)
        # A companyless department stays allowed on a shared plan; readers see only that one.
        shared.department_id = free
        self._as_reader()
        listed = {i['id']: i['department'] for i in self.api('GET', PLANS).json()['items']}
        self.assertEqual(listed[shared.id], {'id': free.id, 'name': 'Ofb Free'})
        one = self.api('GET', f'{PLANS}/{shared.id}').json()
        self.assertEqual(one['department'], {'id': free.id, 'name': 'Ofb Free'})
