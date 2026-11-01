# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase, set_hr_feature
from odoo.addons.liwan_hr.models.audit_event import NON_PAYROLL_MODELS

BASE = '/api/v1/hr/insurance'
PROVIDERS = f'{BASE}/providers'
PLANS = f'{BASE}/plans'
ENROLLMENTS = f'{BASE}/enrollments'
SETTINGS = f'{BASE}/settings'
MEMBER_NUMBER = 'MBR-7770001'
NATIONAL_ID = '1098765432'
PROVIDER_KEYS = {'id', 'name', 'active', 'revision'}
PLAN_KEYS = {
    'id', 'provider', 'name', 'tier', 'policy_number', 'valid_from', 'valid_to', 'annual_premium', 'state',
    'expires_in_days', 'active', 'revision',
}
ENROLLMENT_KEYS = {
    'id', 'employee', 'member_number', 'date_from', 'date_to', 'date_end', 'state', 'employee_share', 'company_share',
    'revision', 'plan', 'dependents_count',
}
SETTINGS_KEYS = {'insurance_visibility', 'insurance_expiry_alert_days', 'insurance_require_dependent_id', 'revision'}


@tagged('post_install', '-at_install', 'liwan')
class TestHrInsurance(LiwanHrCase):
    """Medical insurance: providers, plans, enrollments, dependents, policy, and what never leaks."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.today = fields.Date.context_today(cls.env['res.users'])
        cls.hr = cls._user('ins_hr', ['liwan_core.role_employee', 'liwan_hr.role_hr_manager'])
        cls.emp_user = cls._user('ins_emp', ['liwan_core.role_employee'])
        cls.other_user = cls._user('ins_other', ['liwan_core.role_employee'])
        cls.reader = cls._user('ins_reader', [])
        role = cls.env['liwan.access.role'].create({
            'key': 'ins_reader_role', 'name_ar': 'reader', 'name_en': 'reader', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['hr.insurance.read', 'hr.employees.read']),
            ]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.reader, [{
            'role_id': role.id, 'company_id': cls.company.id,
        }])
        Employee = cls.env['hr.employee']
        cls.emp = Employee.create({'name': 'Ins Employee', 'user_id': cls.emp_user.id, 'company_id': cls.company.id})
        cls.other = Employee.create({'name': 'Ins Other', 'user_id': cls.other_user.id, 'company_id': cls.company.id})
        cls.bare = Employee.create({'name': 'Ins Bare', 'company_id': cls.company.id})

    @classmethod
    def _user(cls, login, roles):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
        )
        if roles:
            cls.env['liwan.access.service']._liwan_replace_assignments(user, [
                {'role_id': cls.env.ref(role).id, 'company_id': cls.company.id} for role in roles
            ])
        return user

    def call(self, user, method, path, body=None):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self.api(method, path, json=body)

    def assert_status(self, res, status, code=None):
        self.assertEqual(res.status_code, status, res.text)
        if code:
            self.assertEqual(res.json()['code'], code, res.text)
        return res

    def day(self, offset):
        return (self.today + timedelta(days=offset)).isoformat()

    def provider(self, name='Bupa'):
        return self.assert_status(self.call(self.hr, 'POST', PROVIDERS, {'name': name}), 201).json()

    def plan(self, provider=None, start=-100, end=200, name='Gold 2026', **extra):
        provider = provider or self.provider(f'Insurer {name}')
        body = {
            'provider_id': provider['id'], 'name': name, 'tier': 'Gold', 'policy_number': 'POL-1',
            'valid_from': self.day(start), 'valid_to': self.day(end), 'annual_premium': 1500, **extra,
        }
        return self.assert_status(self.call(self.hr, 'POST', PLANS, body), 201).json()

    def enroll(self, plan, employee=None, start=-50, **extra):
        body = {
            'employee_id': (employee or self.emp).id, 'plan_id': plan['id'], 'date_from': self.day(start),
            'member_number': MEMBER_NUMBER, 'employee_share': 100, 'company_share': 300, 'notes': 'Internal remark',
            **extra,
        }
        return self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, body), 201).json()

    def policy(self, visibility='own_enrollment_and_dependents', days=60, require_id=False):
        Settings = self.env['liwan.hr.insurance.settings']
        vals = {
            'insurance_visibility': visibility, 'insurance_expiry_alert_days': days,
            'insurance_require_dependent_id': require_id,
        }
        row = Settings.search([('company_id', '=', self.company.id)])
        if row:
            row.write(vals)
        else:
            Settings.create({**vals, 'company_id': self.company.id})

    # --- providers ---------------------------------------------------------------------------------------

    def test_providers_are_added_renamed_and_archived_by_the_manager_only(self):
        created = self.provider('Tawuniya')
        self.assertEqual(set(created), PROVIDER_KEYS)
        patched = self.assert_status(self.call(self.hr, 'PATCH', f"{PROVIDERS}/{created['id']}", {
            'revision': created['revision'], 'name': 'Tawuniya Co',
        }), 200).json()
        self.assertEqual((patched['name'], patched['revision']), ('Tawuniya Co', created['revision'] + 1))
        self.assert_status(self.call(self.hr, 'PATCH', f"{PROVIDERS}/{created['id']}", {
            'revision': created['revision'], 'name': 'Stale',
        }), 409, 'conflict')
        self.assert_status(self.call(self.hr, 'POST', PROVIDERS, {'name': 'Tawuniya Co'}), 409, 'conflict')
        archived = self.assert_status(self.call(self.hr, 'PATCH', f"{PROVIDERS}/{created['id']}", {
            'revision': patched['revision'], 'active': False,
        }), 200).json()
        self.assertFalse(archived['active'])
        self.assertNotIn('Tawuniya Co', [item['name'] for item in self.call(self.hr, 'GET', PROVIDERS).json()['items']])
        self.assertIn('Tawuniya Co', [
            item['name'] for item in self.call(self.hr, 'GET', f'{PROVIDERS}?active=all').json()['items']
        ])
        for user in (self.reader, self.emp_user):
            self.assert_status(self.call(user, 'POST', PROVIDERS, {'name': 'Nope'}), 403, 'forbidden')
        self.assert_status(self.call(self.reader, 'GET', PROVIDERS), 200)
        self.assert_status(self.call(self.emp_user, 'GET', PROVIDERS), 403, 'forbidden')
        self.assert_status(self.call(self.hr, 'PATCH', f"{PROVIDERS}/{created['id']}", {'revision': 3}), 422, 'invalid')

    # --- plans -------------------------------------------------------------------------------------------

    def test_plans_list_filter_patch_and_archive(self):
        provider = self.provider('Plan insurer')
        active = self.plan(provider, name='Active plan')
        expired = self.plan(provider, start=-300, end=-10, name='Expired plan')
        self.assertEqual(set(active), PLAN_KEYS)
        self.assertEqual((active['state'], active['expires_in_days']), ('active', 200))
        self.assertEqual(expired['state'], 'expired')
        listed = self.call(self.reader, 'GET', PLANS).json()
        self.assertEqual(set(listed), {'items', 'total'})
        self.assertEqual({item['name'] for item in listed['items']}, {'Active plan', 'Expired plan'})
        only = self.call(self.reader, 'GET', f'{PLANS}?state=expired').json()
        self.assertEqual([item['name'] for item in only['items']], ['Expired plan'])
        patched = self.assert_status(self.call(self.hr, 'PATCH', f"{PLANS}/{active['id']}", {
            'revision': active['revision'], 'tier': 'Platinum', 'valid_to': self.day(400),
        }), 200).json()
        self.assertEqual((patched['tier'], patched['expires_in_days']), ('Platinum', 400))
        archived = self.assert_status(self.call(self.hr, 'PATCH', f"{PLANS}/{active['id']}", {
            'revision': patched['revision'], 'active': False,
        }), 200).json()
        self.assertEqual((archived['state'], archived['expires_in_days']), ('archived', None))
        names = [item['name'] for item in self.call(self.reader, 'GET', PLANS).json()['items']]
        self.assertNotIn('Active plan', names)
        self.assertEqual(
            [item['name'] for item in self.call(self.reader, 'GET', f'{PLANS}?state=archived').json()['items']],
            ['Active plan'],
        )
        self.assert_status(self.call(self.reader, 'GET', f"{PLANS}/{active['id']}"), 200)
        self.assert_status(self.call(self.reader, 'PATCH', f"{PLANS}/{active['id']}", {'revision': 3, 'tier': 'x'}), 403)
        self.assert_status(self.call(self.hr, 'PATCH', f"{PLANS}/{active['id']}", {'revision': 1, 'tier': 'x'}), 409)
        self.assert_status(self.call(self.hr, 'GET', f'{PLANS}?state=gone'), 422, 'invalid')

    def test_plan_dates_and_provider_are_validated(self):
        provider = self.provider('Bad dates')
        self.assert_status(self.call(self.hr, 'POST', PLANS, {
            'provider_id': provider['id'], 'name': 'Backwards', 'valid_from': self.day(10), 'valid_to': self.day(5),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', PLANS, {
            'provider_id': 999999999, 'name': 'No insurer', 'valid_from': self.day(0), 'valid_to': self.day(5),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', PLANS, {
            'provider_id': provider['id'], 'name': 'Odd', 'valid_from': self.day(0), 'valid_to': self.day(5), 'x': 1,
        }), 422, 'invalid')

    def test_shrinking_a_plan_below_its_enrollments_is_refused(self):
        plan = self.plan()
        self.enroll(plan)
        self.assert_status(self.call(self.hr, 'PATCH', f"{PLANS}/{plan['id']}", {
            'revision': plan['revision'], 'valid_to': self.day(10),
        }), 200)
        self.assert_status(self.call(self.hr, 'PATCH', f"{PLANS}/{plan['id']}", {
            'revision': plan['revision'] + 1, 'valid_from': self.day(-10),
        }), 422, 'invalid')

    # --- enrollments -------------------------------------------------------------------------------------

    def test_enrollment_is_created_read_and_changed_in_shares_and_notes_only(self):
        plan = self.plan()
        row = self.enroll(plan)
        # Creating answers the record page's shape: the list keys plus the notes and the dependents.
        self.assertEqual(set(row), ENROLLMENT_KEYS | {'notes', 'dependents'})
        self.assertEqual(set(self.call(self.reader, 'GET', ENROLLMENTS).json()['items'][0]), ENROLLMENT_KEYS)
        self.assertEqual((row['state'], row['date_to'], row['date_end']), ('active', None, plan['valid_to']))
        detail = self.assert_status(self.call(self.reader, 'GET', f"{ENROLLMENTS}/{row['id']}"), 200).json()
        self.assertEqual((detail['notes'], detail['member_number'], detail['dependents']), ('Internal remark', MEMBER_NUMBER, []))
        patched = self.assert_status(self.call(self.hr, 'PATCH', f"{ENROLLMENTS}/{row['id']}", {
            'revision': row['revision'], 'employee_share': 150, 'notes': 'Updated',
        }), 200).json()
        self.assertEqual((patched['employee_share'], patched['notes']), (150, 'Updated'))
        for field in ('member_number', 'plan_id', 'date_from', 'employee_id', 'state'):
            self.assert_status(self.call(self.hr, 'PATCH', f"{ENROLLMENTS}/{row['id']}", {
                'revision': patched['revision'], field: 'x',
            }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'PATCH', f"{ENROLLMENTS}/{row['id']}", {
            'revision': row['revision'], 'notes': 'Stale',
        }), 409, 'conflict')
        self.assert_status(self.call(self.reader, 'PATCH', f"{ENROLLMENTS}/{row['id']}", {
            'revision': patched['revision'], 'notes': 'x',
        }), 403, 'forbidden')
        self.assert_status(self.call(self.reader, 'POST', ENROLLMENTS, {
            'employee_id': self.other.id, 'plan_id': plan['id'], 'date_from': self.day(0),
        }), 403, 'forbidden')
        self.assert_status(self.call(self.emp_user, 'GET', f"{ENROLLMENTS}/{row['id']}"), 403, 'forbidden')

    def test_list_filters_and_the_expiring_view(self):
        near = self.plan(name='Near plan', end=30)
        far = self.plan(name='Far plan', end=300)
        a = self.enroll(near)
        b = self.enroll(far, self.other)
        listed = self.call(self.reader, 'GET', ENROLLMENTS).json()
        self.assertEqual({item['id'] for item in listed['items']}, {a['id'], b['id']})
        self.assertEqual(self.call(self.reader, 'GET', f'{ENROLLMENTS}?employee_id={self.other.id}').json()['total'], 1)
        self.assertEqual(self.call(self.reader, 'GET', f"{ENROLLMENTS}?plan_id={near['id']}").json()['total'], 1)
        expiring = self.call(self.reader, 'GET', f'{ENROLLMENTS}?expiring=true').json()
        self.assertEqual([item['id'] for item in expiring['items']], [a['id']])
        self.policy(days=10)
        self.assertEqual(self.call(self.reader, 'GET', f'{ENROLLMENTS}?expiring=true').json()['total'], 0)
        self.assert_status(self.call(self.reader, 'GET', f'{ENROLLMENTS}?state=gone'), 422, 'invalid')

    def test_dates_must_lie_inside_the_plan_and_never_overlap(self):
        plan = self.plan(start=-100, end=200)
        self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': self.emp.id, 'plan_id': plan['id'], 'date_from': self.day(-200),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': self.emp.id, 'plan_id': plan['id'], 'date_from': self.day(-50), 'date_to': self.day(300),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': self.emp.id, 'plan_id': plan['id'], 'date_from': self.day(-50), 'date_to': self.day(-60),
        }), 422, 'invalid')
        first = self.enroll(plan, start=-50, date_to=self.day(0))
        other_plan = self.plan(start=-100, end=200, name='Second plan')
        res = self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': self.emp.id, 'plan_id': other_plan['id'], 'date_from': self.day(-10),
        })
        self.assert_status(res, 422, 'invalid')
        self.assertIn('already has', res.json()['message'])
        # The day after the first one ends is free, and another employee is never blocked.
        self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': self.emp.id, 'plan_id': other_plan['id'], 'date_from': self.day(1),
        }), 201)
        self.enroll(other_plan, self.other, start=-10)
        self.assertEqual(first['state'], 'active')
        with self.assertRaises(ValidationError):
            self.env['liwan.hr.insurance.enrollment'].create({
                'employee_id': self.emp.id, 'plan_id': other_plan['id'], 'date_from': self.day(5),
            })

    def test_foreign_employee_and_foreign_plan_are_refused(self):
        other = self.env['res.company'].create({'name': 'Insurance Other Co'})
        employee = self.env['hr.employee'].create({'name': 'Elsewhere', 'company_id': other.id})
        provider = self.env['liwan.hr.insurance.provider'].create({'company_id': other.id, 'name': 'Elsewhere insurer'})
        plan = self.env['liwan.hr.insurance.plan'].create({
            'company_id': other.id, 'provider_id': provider.id, 'name': 'Elsewhere plan',
            'valid_from': self.day(-10), 'valid_to': self.day(10),
        })
        mine = self.plan()
        self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': employee.id, 'plan_id': mine['id'], 'date_from': self.day(0),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', ENROLLMENTS, {
            'employee_id': self.emp.id, 'plan_id': plan.id, 'date_from': self.day(0),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'GET', f'{PLANS}/{plan.id}'), 404, 'not_found')
        row = self.env['liwan.hr.insurance.enrollment'].create({
            'employee_id': employee.id, 'plan_id': plan.id, 'date_from': self.day(-5),
        })
        self.assert_status(self.call(self.hr, 'GET', f'{ENROLLMENTS}/{row.id}'), 404, 'not_found')
        self.assertNotIn(row.id, [item['id'] for item in self.call(self.hr, 'GET', ENROLLMENTS).json()['items']])

    def test_ending_keeps_history_and_frees_the_range(self):
        plan = self.plan()
        row = self.enroll(plan)
        dependent = self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", {
            'name': 'Child One', 'relation': 'child', 'date_from': self.day(-40),
        }), 201).json()
        ended = self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {
            'revision': row['revision'], 'date_end': self.day(-5),
        }), 200).json()
        self.assertEqual((ended['state'], ended['date_to']), ('ended', self.day(-5)))
        self.assertEqual([(item['state'], item['date_to']) for item in ended['dependents']], [('ended', self.day(-5))])
        self.assertEqual(ended['dependents'][0]['id'], dependent['id'])
        self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {
            'revision': ended['revision'],
        }), 409, 'conflict')
        self.assert_status(self.call(self.hr, 'PATCH', f"{ENROLLMENTS}/{row['id']}", {
            'revision': ended['revision'], 'notes': 'x',
        }), 409, 'conflict')
        self.enroll(plan, start=-4)
        self.assertEqual(self.call(self.reader, 'GET', f"{ENROLLMENTS}?employee_id={self.emp.id}").json()['total'], 2)
        self.assert_status(self.call(self.reader, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {'revision': 3}), 403)
        self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {
            'revision': ended['revision'], 'date_end': 'bad',
        }), 422)

    def test_end_date_is_bounded_and_cancel_frees_the_range(self):
        plan = self.plan()
        row = self.enroll(plan)
        self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {
            'revision': row['revision'], 'date_end': self.day(-90),
        }), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {
            'revision': row['revision'], 'date_end': self.day(250),
        }), 422, 'invalid')
        cancelled = self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/cancel", {
            'revision': row['revision'],
        }), 200).json()
        self.assertEqual(cancelled['state'], 'cancelled')
        self.enroll(plan)
        self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/cancel", {
            'revision': cancelled['revision'],
        }), 409, 'conflict')
        own = self.call(self.emp_user, 'GET', f'{BASE}/me').json()
        self.assertEqual(own['total'], 1)

    # --- dependents --------------------------------------------------------------------------------------

    def dependent_body(self, **extra):
        return {
            'name': 'Spouse One', 'relation': 'spouse', 'birth_date': '1990-04-01', 'national_id': NATIONAL_ID,
            'date_from': self.day(-40), **extra,
        }

    def test_dependents_are_added_changed_ended_and_masked_in_lists(self):
        row = self.enroll(self.plan())
        path = f"{ENROLLMENTS}/{row['id']}/dependents"
        added = self.assert_status(self.call(self.hr, 'POST', path, self.dependent_body()), 201).json()
        self.assertEqual(added['national_id'], NATIONAL_ID)
        self.assertEqual(added['national_id_masked'], '******5432')
        detail = self.call(self.hr, 'GET', f"{ENROLLMENTS}/{row['id']}").json()
        self.assertEqual([item['id'] for item in detail['dependents']], [added['id']])
        listed = self.call(self.reader, 'GET', ENROLLMENTS).json()
        self.assertEqual(listed['items'][0]['dependents_count'], 1)
        self.assertNotIn(NATIONAL_ID, str(listed))
        patched = self.assert_status(self.call(self.hr, 'PATCH', f"{BASE}/dependents/{added['id']}", {
            'revision': added['revision'], 'name': 'Spouse Renamed', 'relation': 'other',
        }), 200).json()
        self.assertEqual((patched['name'], patched['relation']), ('Spouse Renamed', 'other'))
        self.assert_status(self.call(self.hr, 'PATCH', f"{BASE}/dependents/{added['id']}", {
            'revision': added['revision'], 'name': 'Stale',
        }), 409)
        self.assert_status(self.call(self.hr, 'PATCH', f"{BASE}/dependents/{added['id']}", {
            'revision': patched['revision'], 'date_from': self.day(-400),
        }), 422)
        ended = self.assert_status(self.call(self.hr, 'POST', f"{BASE}/dependents/{added['id']}/end", {
            'revision': patched['revision'], 'date_end': self.day(-1),
        }), 200).json()
        self.assertEqual((ended['state'], ended['date_to']), ('ended', self.day(-1)))
        self.assert_status(self.call(self.hr, 'POST', f"{BASE}/dependents/{added['id']}/end", {
            'revision': ended['revision'],
        }), 409, 'conflict')
        self.assert_status(self.call(self.reader, 'POST', path, self.dependent_body()), 403, 'forbidden')
        self.assert_status(self.call(self.hr, 'POST', path, self.dependent_body(relation='cousin')), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', path, self.dependent_body(date_from=self.day(-400))), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'POST', path, self.dependent_body(national_id='1 2')), 422, 'invalid')

    def test_the_policy_can_require_a_dependent_identity_number(self):
        row = self.enroll(self.plan())
        path = f"{ENROLLMENTS}/{row['id']}/dependents"
        without = self.dependent_body()
        del without['national_id']
        self.assert_status(self.call(self.hr, 'POST', path, without), 201)
        self.policy(require_id=True)
        res = self.assert_status(self.call(self.hr, 'POST', path, without), 422, 'invalid')
        self.assertEqual(res.json()['field'], 'national_id')
        self.assert_status(self.call(self.hr, 'POST', path, self.dependent_body()), 201)

    def test_a_dependent_cannot_be_added_to_an_ended_enrollment(self):
        row = self.enroll(self.plan())
        ended = self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {'revision': row['revision']}).json()
        self.assertEqual(ended['state'], 'ended')
        self.assert_status(self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", self.dependent_body()), 409)

    # --- the employee's own card -------------------------------------------------------------------------

    def test_an_employee_reads_only_their_own_enrollment_and_dependents(self):
        row = self.enroll(self.plan())
        self.enroll(self.plan(name='Other plan'), self.other)
        self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", self.dependent_body())
        own = self.assert_status(self.call(self.emp_user, 'GET', f'{BASE}/me'), 200).json()
        self.assertEqual(set(own), {'items', 'total'})
        self.assertEqual([item['id'] for item in own['items']], [row['id']])
        item = own['items'][0]
        self.assertNotIn('notes', item)
        self.assertEqual(item['plan']['name'], 'Gold 2026')
        self.assertNotIn('policy_number', item['plan'])
        self.assertTrue(item['dependents_visible'])
        self.assertEqual(item['dependents'][0]['national_id'], None)
        self.assertEqual(item['dependents'][0]['national_id_masked'], '******5432')
        self.assertNotIn(NATIONAL_ID, str(own))
        self.assertEqual(self.call(self._user('ins_bare', ['liwan_core.role_employee']), 'GET', f'{BASE}/me').json(), {'items': [], 'total': 0})
        self.assertEqual(self.call(self.other_user, 'GET', f'{BASE}/me').json()['total'], 1)
        # Management routes stay closed to the employee.
        self.assert_status(self.call(self.emp_user, 'GET', ENROLLMENTS), 403, 'forbidden')
        self.assert_status(self.call(self.emp_user, 'GET', f'{BASE}/summary'), 403, 'forbidden')

    def test_the_visibility_policy_hides_dependents_from_the_employee(self):
        row = self.enroll(self.plan())
        self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", self.dependent_body())
        self.policy(visibility='own_enrollment_only')
        own = self.call(self.emp_user, 'GET', f'{BASE}/me').json()
        self.assertEqual(own['total'], 1)
        item = own['items'][0]
        self.assertEqual((item['dependents_visible'], item['dependents']), (False, []))
        self.assertNotIn('Spouse One', str(own))
        Dependent = self.env['liwan.hr.insurance.dependent']
        self.assertFalse(Dependent.with_user(self.emp_user).search([]))
        self.assertTrue(Dependent.with_user(self.reader).search([]))
        self.policy()
        self.assertTrue(Dependent.with_user(self.emp_user).search([]))
        self.assertFalse(Dependent.with_user(self.other_user).search([]))

    def test_nobody_edits_a_record_behind_the_actions(self):
        row = self.env['liwan.hr.insurance.enrollment'].browse(self.enroll(self.plan())['id'])
        for user in (self.hr, self.emp_user):
            with self.assertRaises(Exception):  # noqa: B017 - AccessError from the write gate
                row.with_user(user).write({'notes': 'sneaky'})
            with self.assertRaises(Exception):  # noqa: B017
                row.with_user(user).unlink()

    # --- summary and settings ----------------------------------------------------------------------------

    def test_the_summary_is_counts_only(self):
        near = self.plan(name='Near plan', end=30)
        row = self.enroll(near)
        self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", self.dependent_body())
        covered = self.env['liwan.hr.insurance.enrollment'].search_count([('state', '=', 'active')])
        employees = self.env['hr.employee'].search_count([('company_id', '=', self.company.id)])
        body = self.assert_status(self.call(self.reader, 'GET', f'{BASE}/summary'), 200).json()
        self.assertEqual(set(body), {
            'active_members', 'active_enrollments', 'active_dependents', 'expiring_plans',
            'employees_without_insurance', 'expiry_alert_days',
        })
        self.assertTrue(all(isinstance(value, int) for value in body.values()))
        self.assertEqual((body['active_enrollments'], body['active_dependents'], body['active_members']), (covered, 1, covered + 1))
        self.assertEqual(body['expiring_plans'], 1)
        self.assertEqual(body['employees_without_insurance'], employees - covered)
        self.assertNotIn('Ins Employee', str(body))

    def test_settings_default_save_and_conflict(self):
        self.env['liwan.hr.insurance.settings'].search([]).unlink()
        body = self.assert_status(self.call(self.other_user, 'GET', SETTINGS), 200).json()
        self.assertEqual(set(body), SETTINGS_KEYS)
        self.assertEqual(body, {
            'insurance_visibility': 'own_enrollment_and_dependents', 'insurance_expiry_alert_days': 60,
            'insurance_require_dependent_id': False, 'revision': 0,
        })
        change = {
            'insurance_visibility': 'own_enrollment_only', 'insurance_expiry_alert_days': 30,
            'insurance_require_dependent_id': True,
        }
        saved = self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 0}), 200).json()
        self.assertEqual((saved['insurance_visibility'], saved['insurance_expiry_alert_days'], saved['revision']),
                         ('own_enrollment_only', 30, 1))
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 0}), 409, 'conflict')
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 1, 'insurance_visibility': 'all'}), 422)
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 1, 'insurance_expiry_alert_days': 0}), 422)
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {
            **change, 'revision': 1, 'insurance_require_dependent_id': 'yes',
        }), 422)
        for user in (self.reader, self.emp_user):
            self.assert_status(self.call(user, 'PATCH', SETTINGS, {**change, 'revision': 1}), 403, 'forbidden')
        event = self.env['liwan.hr.audit.event'].search([('action', '=', 'insurance_settings_changed')])
        self.assertEqual(len(event), 1)
        self.assertEqual({row.field_name for row in event.change_ids}, set(SETTINGS_KEYS) - {'revision'})

    # --- bell and cron -----------------------------------------------------------------------------------

    def bell(self, user):
        res = self.call(user, 'GET', '/api/v1/notifications')
        return [item for item in res.json()['items'] if item['kind'] == 'hr.insurance_plan_expiring']

    def test_the_expiry_cron_rings_the_managers_once_and_names_the_plan_only(self):
        near = self.plan(name='Near plan', end=20)
        far = self.plan(name='Far plan', end=300)
        self.enroll(near)
        Plan = self.env['liwan.hr.insurance.plan']
        Plan._liwan_run_expiry_alerts()
        Plan._liwan_run_expiry_alerts()
        rows = self.bell(self.hr)
        self.assertEqual([(row['plan_id'], row['title']) for row in rows], [(near['id'], 'Near plan')])
        self.assertNotIn(MEMBER_NUMBER, str(rows))
        self.assertNotIn(far['id'], [row['plan_id'] for row in rows])
        for user in (self.emp_user, self.reader, self.other_user):
            self.assertEqual(self.bell(user), [])
        # A renewed plan alerts again for its new end date; an archived one never does.
        self.assert_status(self.call(self.hr, 'PATCH', f"{PLANS}/{near['id']}", {
            'revision': near['revision'], 'valid_to': self.day(25),
        }), 200)
        Plan._liwan_run_expiry_alerts()
        self.assertEqual(len(self.bell(self.hr)), 2)

    def test_the_alert_window_is_a_setting(self):
        self.plan(name='Mid plan', end=45)
        Plan = self.env['liwan.hr.insurance.plan']
        self.policy(days=30)
        Plan._liwan_run_expiry_alerts()
        self.assertEqual(self.bell(self.hr), [])
        self.policy(days=60)
        Plan._liwan_run_expiry_alerts()
        self.assertEqual(len(self.bell(self.hr)), 1)

    # --- audit and leaks ---------------------------------------------------------------------------------

    def test_every_step_is_audited_without_the_insurance_text(self):
        row = self.enroll(self.plan())
        self.call(self.hr, 'PATCH', f"{ENROLLMENTS}/{row['id']}", {'revision': 1, 'employee_share': 175, 'notes': 'Secret remark'})
        dependent = self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", self.dependent_body()).json()
        self.call(self.hr, 'POST', f"{BASE}/dependents/{dependent['id']}/end", {'revision': 1})
        self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/end", {'revision': 2})
        events = self.env['liwan.hr.audit.event'].search([('res_model', 'like', 'liwan.hr.insurance%')])
        self.assertEqual(
            sorted(set(events.mapped('action'))),
            ['dependent_added', 'dependent_ended', 'enrollment_changed', 'enrollment_created', 'enrollment_ended',
             'plan_created', 'provider_created'],
        )
        values = [value for event in events for line in event.change_ids for value in (line.old_value, line.new_value)]
        for secret in (MEMBER_NUMBER, NATIONAL_ID, 'Secret remark', 'Spouse One', 'Internal remark', 'POL-1', '175', '1500'):
            self.assertNotIn(secret, values)
        by_action = {event.action: event for event in events}
        self.assertEqual(by_action['enrollment_ended'].create_uid, self.hr)
        self.assertIn('state', {line.field_name for line in by_action['enrollment_ended'].change_ids})
        self.assertIn('member_number', {line.field_name for line in by_action['enrollment_created'].change_ids})

    def test_the_payroll_audit_route_never_lists_insurance_events(self):
        self.enroll(self.plan())
        auditor = self._user('ins_auditor', [])
        role = self.env['liwan.access.role'].create({
            'key': 'ins_auditor_role', 'name_ar': 'a', 'name_en': 'a', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ['hr.payroll.audit.read', 'hr.payroll.read', 'hr.employees.read']),
            ]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(auditor, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])
        body = self.assert_status(self.call(auditor, 'GET', '/api/v1/hr/payroll/audit-events'), 200).json()
        self.assertFalse([item for item in body['items'] if item['res_model'].startswith('liwan.hr.insurance')])
        Event = self.env['liwan.hr.audit.event']
        self.assertTrue(Event.search_count([('res_model', 'like', 'liwan.hr.insurance%')]))
        self.assertEqual(body['total'], Event.search_count([
            ('company_id', '=', self.company.id), ('res_model', 'not in', NON_PAYROLL_MODELS),
        ]))
        self.assert_status(self.call(auditor, 'GET', '/api/v1/hr/payroll/audit-events?action=enrollment_ended'), 422)

    def test_numbers_never_reach_the_general_employee_views(self):
        row = self.enroll(self.plan())
        self.call(self.hr, 'POST', f"{ENROLLMENTS}/{row['id']}/dependents", self.dependent_body())
        for path in (
            '/api/v1/hr/employees', f'/api/v1/hr/employees/{self.emp.id}', '/api/v1/people?q=Ins',
            '/api/v1/hr/payroll/audit-events', '/api/v1/notifications',
        ):
            text = self.call(self.hr, 'GET', path).text
            for secret in (MEMBER_NUMBER, NATIONAL_ID, 'Spouse One'):
                self.assertNotIn(secret, text, path)

    def test_an_employee_with_enrollments_cannot_move_company(self):
        self.enroll(self.plan())
        other = self.env['res.company'].create({'name': 'Insurance Move Co'})
        with self.assertRaises(ValidationError):
            self.emp.write({'company_id': other.id})

    # --- feature gate ------------------------------------------------------------------------------------

    def test_feature_off_closes_every_route(self):
        plan = self.plan()
        row = self.enroll(plan)
        set_hr_feature(self, 'hr.insurance', False)
        for method, path, body in (
            ('GET', PROVIDERS, None), ('POST', PROVIDERS, {'name': 'x'}), ('GET', PLANS, None),
            ('GET', f"{PLANS}/{plan['id']}", None), ('GET', ENROLLMENTS, None),
            ('GET', f"{ENROLLMENTS}/{row['id']}", None), ('POST', f"{ENROLLMENTS}/{row['id']}/end", {'revision': 1}),
            ('GET', f'{BASE}/me', None), ('GET', SETTINGS, None), ('GET', f'{BASE}/summary', None),
        ):
            self.assert_status(self.call(self.hr, method, path, body), 403, 'feature_not_included')
        self.assertEqual(self.bell(self.hr), [])
