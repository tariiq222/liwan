# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase

WARNINGS = '/api/v1/hr/warnings'
EMPLOYEE_ROLE = 'liwan_core.role_employee'
LEGACY_GROUP = 'liwan_core.group_employee'
# Every model with its own-person rows, and one stored field to read from it.
MODELS = {
    'provider': ('liwan.hr.insurance.provider', 'name'),
    'plan': ('liwan.hr.insurance.plan', 'name'),
    'enrollment': ('liwan.hr.insurance.enrollment', 'member_number'),
    'dependent': ('liwan.hr.insurance.dependent', 'name'),
    'warning': ('liwan.hr.warning', 'reason'),
}


def _account(env, login, managed, **extra):
    """An account made as the invitation flow does (internal user only) or as the legacy tests do (employee group)."""
    return new_test_user(
        env, login=login, password=f'{login}_pass_123', name=login,
        groups='base.group_user' if managed else LEGACY_GROUP, **extra,
    )


def _make_person_rows(env, employee, label):
    """The insurance and warning rows of one employee: own provider and plan, one enrollment with one dependent,
    one warning. Returns the readable ids per model key and, apart, the id of a draft warning about the person."""
    company = employee.company_id
    provider = env['liwan.hr.insurance.provider'].create({'name': f'Provider {label}', 'company_id': company.id})
    plan = env['liwan.hr.insurance.plan'].create({
        'name': f'Plan {label}', 'provider_id': provider.id, 'company_id': company.id,
        'valid_from': '2026-01-01', 'valid_to': '2030-12-31',
    })
    enrollment = env['liwan.hr.insurance.enrollment'].create({
        'employee_id': employee.id, 'plan_id': plan.id, 'date_from': '2026-01-01', 'member_number': f'MBR-{label}',
    })
    dependent = env['liwan.hr.insurance.dependent'].create({
        'enrollment_id': enrollment.id, 'name': f'Dependent {label}', 'relation': 'child', 'date_from': '2026-01-01',
    })
    kind = env['liwan.hr.warning.type'].search([('company_id', '=', company.id)], limit=1)
    warning_vals = {'employee_id': employee.id, 'type_id': kind.id, 'reason': f'Reason {label}'}
    issued = env['liwan.hr.warning'].create({**warning_vals, 'state': 'issued', 'issued_at': fields.Datetime.now()})
    draft = env['liwan.hr.warning'].create({**warning_vals, 'reason': f'Draft {label}'})
    rows = {'provider': provider, 'plan': plan, 'enrollment': enrollment, 'dependent': dependent, 'warning': issued}
    return {key: row.id for key, row in rows.items()}, draft.id


class OwnRowsOnly:
    """Mixin: an employee-role account reads its own insurance and warning rows and nobody else's.

    Subclasses set ``MANAGED``, which decides through ``_account`` whether the accounts are shaped as the
    invitation flow makes them or hold the legacy group; the assertions state what the ``*_self`` record rules
    intend, whichever way the account got its groups.
    """

    MANAGED = True
    # Odoo collects only the methods defined on a test class itself unless this is set.
    allow_inherited_tests_method = True

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        settings = cls.env['liwan.hr.insurance.settings'].search([('company_id', '=', cls.company.id)])
        vals = {'insurance_visibility': 'own_enrollment_and_dependents'}
        if settings:
            settings.write(vals)
        else:
            cls.env['liwan.hr.insurance.settings'].create({**vals, 'company_id': cls.company.id})
        cls.people = {}
        for name in ('alice', 'bob'):
            login = f'{"managed" if cls.MANAGED else "legacy"}_{name}'
            user = _account(cls.env, login, cls.MANAGED)
            cls.env['liwan.access.service']._liwan_replace_assignments(user, [
                {'role_id': cls.env.ref(EMPLOYEE_ROLE).id, 'company_id': cls.company.id},
            ])
            employee = cls.env['hr.employee'].create({'name': login, 'company_id': cls.company.id, 'user_id': user.id})
            ids, draft = _make_person_rows(cls.env, employee, login)
            cls.people[name] = {'user': user, 'ids': ids, 'draft': draft}

    def test_the_accounts_hold_the_expected_groups(self):
        for person in self.people.values():
            user = person['user']
            self.assertEqual(user.has_group(LEGACY_GROUP), not self.MANAGED, user.login)
            self.assertTrue(user.has_group('liwan_hr.group_cap_hr_employees_read'), user.login)

    def _assert_own_rows_only(self, key):
        model, field_name = MODELS[key]
        alice, bob = self.people['alice'], self.people['bob']
        Model = self.env[model].with_user(alice['user'])
        own, foreign = alice['ids'][key], bob['ids'][key]
        with self.subTest('search'):
            self.assertEqual(Model.search([]).ids, [own], f'{model}: search lists the rows of other people')
        with self.subTest('search_count'):
            self.assertEqual(Model.search_count([]), 1, f'{model}: search_count counts the rows of other people')
        with self.subTest('aggregate'):
            self.assertEqual(
                Model._read_group([], aggregates=['__count']), [(1,)], f'{model}: the aggregate counts other people',
            )
        with self.subTest('own row'):
            self.assertTrue(Model.browse(own).read([field_name]), f'{model}: the own row must stay readable')
        with self.subTest('read of another person'), self.assertRaises(AccessError, msg=f'{model}: another was read'):
            Model.browse(foreign).read([field_name])

    def test_providers_are_read_by_the_owner_only(self):
        self._assert_own_rows_only('provider')

    def test_plans_are_read_by_the_owner_only(self):
        self._assert_own_rows_only('plan')

    def test_enrollments_are_read_by_the_owner_only(self):
        self._assert_own_rows_only('enrollment')

    def test_dependents_are_read_by_the_owner_only(self):
        self._assert_own_rows_only('dependent')

    def test_warnings_are_read_by_the_person_warned_once_issued(self):
        self._assert_own_rows_only('warning')
        Warning = self.env['liwan.hr.warning'].with_user(self.people['alice']['user'])
        for owner in ('alice', 'bob'):
            with self.subTest(f'draft of {owner}'), self.assertRaises(AccessError, msg='a draft warning was read'):
                Warning.browse(self.people[owner]['draft']).read(['reason'])

    def test_enrollment_only_policy_still_hides_the_rows_of_other_people(self):
        self.env['liwan.hr.insurance.settings'].search([('company_id', '=', self.company.id)]).write({
            'insurance_visibility': 'own_enrollment_only',
        })
        for key in ('provider', 'plan', 'enrollment', 'dependent'):
            model = MODELS[key][0]
            Model = self.env[model].with_user(self.people['alice']['user'])
            self.assertNotIn(self.people['bob']['ids'][key], Model.search([]).ids, model)
            with self.assertRaises(AccessError, msg=f'{model}: the row of another person was read'):
                Model.browse(self.people['bob']['ids'][key]).read([MODELS[key][1]])

    def test_enrollment_only_policy_hides_the_own_dependents_but_not_the_own_enrollment(self):
        self.env['liwan.hr.insurance.settings'].search([('company_id', '=', self.company.id)]).write({
            'insurance_visibility': 'own_enrollment_only',
        })
        alice = self.people['alice']
        for key in ('provider', 'plan', 'enrollment'):
            model, field_name = MODELS[key]
            Model = self.env[model].with_user(alice['user'])
            self.assertEqual(Model.search([]).ids, [alice['ids'][key]], model)
            self.assertTrue(Model.browse(alice['ids'][key]).read([field_name]), model)
        Dependents = self.env[MODELS['dependent'][0]].with_user(alice['user'])
        self.assertFalse(Dependents.search([]))
        with self.assertRaises(AccessError, msg='an own dependent was read under own_enrollment_only'):
            Dependents.browse(alice['ids']['dependent']).read(['name'])


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestInsuranceWarningRolesManaged(OwnRowsOnly, LiwanHrCase):
    """Accounts managed by roles: base.group_user plus the groups of their capabilities, never the legacy group."""

    MANAGED = True

    def test_the_self_rules_name_the_group_of_the_employee_acl_rows(self):
        # For the insurance models the Python fence alone also returns own rows, so no behaviour test can tell
        # whether the native rule still names the group of the employee ACL row; this pins it.
        for xmlid in (
            'rule_liwan_hr_insurance_provider_self', 'rule_liwan_hr_insurance_plan_self',
            'rule_liwan_hr_insurance_enrollment_self', 'rule_liwan_hr_insurance_dependent_self',
            'rule_liwan_hr_warning_self',
        ):
            groups = self.env.ref(f'liwan_hr.{xmlid}').groups
            self.assertIn(self.env.ref(LEGACY_GROUP), groups, xmlid)
            self.assertIn(self.env.ref('liwan_hr.group_cap_hr_employees_read'), groups, xmlid)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestInsuranceWarningLegacyControl(OwnRowsOnly, LiwanHrCase):
    """The control: the same assertions for accounts that also hold the legacy employee group."""

    MANAGED = False


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestInsuranceWarningAcrossCompanies(LiwanHrCase):
    """A role-managed account reads insurance and warnings of each company by its own role in that company.

    In A the user reads employees, insurance and warnings; in B they read employees only and have their own
    enrollment and warning. Odoo groups are global, so the capability groups earned in A are held in B too and
    the per-company fences keep B closed to everything but the user's own rows.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Company = cls.env['res.company'].sudo()
        cls.company_a = Company.create({'name': 'Insurance A'})
        cls.company_b = Company.create({'name': 'Insurance B'})
        roles = {
            company: cls.env['liwan.access.role'].with_company(company).create({
                'key': f'cross_ins_{name}', 'name_ar': 'x', 'name_en': f'cross_ins_{name}', 'type': 'custom',
                'assignable': True,
                'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
            })
            for company, name, keys in (
                (cls.company_a, 'a', ('hr.employees.read', 'hr.insurance.read', 'hr.warnings.read')),
                (cls.company_b, 'b', ('hr.employees.read',)),
            )
        }
        cls.user = _account(cls.env, 'cross_ins_user', True, company_id=cls.company_a.id)
        cls.user.company_ids = [Command.set((cls.company_a | cls.company_b).ids)]
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.user, [
            {'role_id': roles[cls.company_a].id, 'company_id': cls.company_a.id},
        ])
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.user.id, 'role_id': roles[cls.company_b].id, 'company_id': cls.company_b.id,
        })
        cls.env['liwan.hr.insurance.settings'].create({
            'company_id': cls.company_b.id, 'insurance_visibility': 'own_enrollment_and_dependents',
        })
        cls.rows = {}
        for company, name in ((cls.company_a, 'A'), (cls.company_b, 'B')):
            employee = cls.env['hr.employee'].create({'name': f'Someone in {name}', 'company_id': company.id})
            cls.rows[name] = _make_person_rows(cls.env, employee, f'cross {name}')[0]
        own = cls.env['hr.employee'].create({'name': 'User in B', 'company_id': cls.company_b.id, 'user_id': cls.user.id})
        cls.own_b, cls.own_b_draft = _make_person_rows(cls.env, own, 'cross own B')

    def _model(self, key, company_ids):
        return self.env[MODELS[key][0]].with_user(self.user).with_context(
            allowed_company_ids=[company.id for company in company_ids],
        )

    def _assert_closed(self, key, company_ids):
        Model = self._model(key, company_ids)
        foreign = self.rows['B'][key]
        with self.subTest(f'{MODELS[key][0]} search'):
            self.assertNotIn(foreign, Model.search([]).ids, f'{MODELS[key][0]}: the row of company B is listed')
        with self.subTest(f'{MODELS[key][0]} count'):
            self.assertEqual(Model.search_count([]), len(Model.search([])), MODELS[key][0])
        with self.subTest(f'{MODELS[key][0]} read'), self.assertRaises(AccessError, msg=f'{MODELS[key][0]}: B was read'):
            Model.browse(foreign).read([MODELS[key][1]])

    def _assert_open(self, key, company_ids):
        Model = self._model(key, company_ids)
        own = self.rows['A'][key]
        with self.subTest(f'{MODELS[key][0]} A'):
            self.assertIn(own, Model.search([]).ids, f'{MODELS[key][0]}: the row of company A is not listed')
            self.assertTrue(Model.browse(own).read([MODELS[key][1]]), MODELS[key][0])

    def test_company_b_rows_are_closed_when_only_b_is_allowed(self):
        for key in MODELS:
            self._assert_closed(key, [self.company_b])

    def test_the_user_reads_only_their_own_rows_in_company_b(self):
        for key, (model, field_name) in MODELS.items():
            Model = self._model(key, [self.company_b])
            with self.subTest(model):
                self.assertEqual(Model.search([]).ids, [self.own_b[key]], f'{model}: more than the own rows')
                self.assertEqual(Model.search_count([]), 1, model)
                self.assertTrue(Model.browse(self.own_b[key]).read([field_name]), model)
        with self.assertRaises(AccessError, msg='an own draft warning was read'):
            self._model('warning', [self.company_b]).browse(self.own_b_draft).read(['reason'])

    def test_company_b_rows_are_closed_when_both_are_allowed_and_a_is_current(self):
        for key in MODELS:
            self._assert_closed(key, [self.company_a, self.company_b])

    def test_company_a_rows_are_read_by_the_reader_there(self):
        for company_ids in ([self.company_a], [self.company_a, self.company_b]):
            for key in MODELS:
                self._assert_open(key, company_ids)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestManagerWarningsRoleManaged(LiwanHrCase):
    """A role-managed manager drafts warnings for a direct report under the manager_and_hr policy.

    This is the shape the self rule changes: before it named the employees-read group, no group rule applied to
    such an account. The manager reads the warnings they drafted and the report reads the issued ones.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        settings = cls.env['liwan.hr.warning.settings'].search([('company_id', '=', cls.company.id)])
        vals = {'warnings_issued_by': 'manager_and_hr', 'warnings_employee_acknowledgement': 'optional'}
        if settings:
            settings.write(vals)
        else:
            cls.env['liwan.hr.warning.settings'].create({**vals, 'company_id': cls.company.id})
        cls.kind = cls.env['liwan.hr.warning.type'].search([('company_id', '=', cls.company.id)], limit=1)
        cls.users = {}
        cls.employees = {}
        for name in ('manager', 'report', 'stranger'):
            user = _account(cls.env, f'warn_managed_{name}', True)
            cls.env['liwan.access.service']._liwan_replace_assignments(user, [
                {'role_id': cls.env.ref(EMPLOYEE_ROLE).id, 'company_id': cls.company.id},
            ])
            cls.users[name] = user
            cls.employees[name] = cls.env['hr.employee'].create({
                'name': user.login, 'company_id': cls.company.id, 'user_id': user.id,
            })
        cls.employees['report'].parent_id = cls.employees['manager']
        cls.about_manager = cls.env['liwan.hr.warning'].create({
            'employee_id': cls.employees['manager'].id, 'type_id': cls.kind.id, 'reason': 'Draft about the manager',
        })

    def _call(self, name, method, path, body=None):
        user = self.users[name]
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self.api(method, path, json=body)

    def _draft(self, name, employee='report', expected=201):
        res = self._call(name, 'POST', WARNINGS, {
            'employee_id': self.employees[employee].id, 'type_id': self.kind.id, 'reason': 'Late three times',
        })
        self.assertEqual(res.status_code, expected, res.text)
        return res.json()

    def test_the_manager_drafts_issues_and_discards_and_the_report_acknowledges(self):
        draft = self._draft('manager')
        self.assertEqual(self._call('manager', 'GET', f"{WARNINGS}/{draft['id']}").status_code, 200)
        res = self._call('manager', 'POST', f"{WARNINGS}/{draft['id']}/issue", {'revision': draft['revision']})
        self.assertEqual(res.status_code, 200, res.text)
        issued = res.json()
        second = self._draft('manager')
        res = self._call('manager', 'POST', f"{WARNINGS}/{second['id']}/withdraw", {
            'revision': second['revision'], 'reason': 'Drafted by mistake',
        })
        self.assertEqual((res.status_code, res.json()['state']), (200, 'withdrawn'), res.text)
        res = self._call('report', 'GET', f'{WARNINGS}/me')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual([item['id'] for item in res.json()['items']], [issued['id']])
        res = self._call('report', 'POST', f"{WARNINGS}/me/{issued['id']}/acknowledge", {'revision': issued['revision']})
        self.assertEqual(res.status_code, 200, res.text)

    def test_another_manager_reads_and_drafts_nothing_for_the_report(self):
        draft = self._draft('manager')
        self.assertEqual(self._call('stranger', 'GET', f"{WARNINGS}/{draft['id']}").status_code, 404)
        self._draft('stranger', expected=403)

    def test_the_manager_reads_exactly_the_warnings_they_drafted_at_orm_level(self):
        drafted = self._draft('manager')
        Warning = self.env['liwan.hr.warning'].with_user(self.users['manager'])
        self.assertEqual(Warning.search([]).ids, [drafted['id']])
        with self.assertRaises(AccessError, msg='a draft about the manager was read'):
            Warning.browse(self.about_manager.id).read(['reason'])

    def test_the_manager_reads_no_draft_written_about_themself_through_the_route(self):
        res = self._call('manager', 'GET', f'{WARNINGS}/{self.about_manager.id}')
        self.assertEqual(res.status_code, 404, res.text)
