# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import set_hr_feature
from .payroll_common import PayrollCase
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.payroll.compensation import parse_compensation

COMPENSATION_KEYS = {
    'employee', 'basic_wage', 'housing_allowance', 'transport_allowance', 'other_allowance',
    'fixed_wage', 'iban', 'bank', 'gosi_number', 'gosi_registration_date', 'nationality', 'relationship_type',
    'currency',
}
SALARY_KEYS = {'basic_wage', 'housing_allowance', 'iban', 'gosi_number', 'compensation', 'wage'}
VALID_IBAN = 'SA0380000000608010167519'
PUT_BODY = {
    'basic_wage': 10000, 'housing_allowance': 2500, 'transport_allowance': 1000, 'other_allowance': 0,
    'iban': VALID_IBAN, 'bank_id': None, 'gosi_number': '123456789', 'gosi_registration_date': '2024-01-01',
    'relationship_type': 'employee',
}


def keys_of(value):
    """Every dict key found anywhere in a JSON body."""
    if isinstance(value, dict):
        found = set(value)
        for item in value.values():
            found |= keys_of(item)
        return found
    if isinstance(value, list):
        return set().union(*(keys_of(item) for item in value)) if value else set()
    return set()


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollCompensation(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.target = cls.make_employee(cls, 'Layla Target')
        cls.set_compensation(cls, cls.target, 10000, housing=2500, transport=1000, iban=VALID_IBAN)
        cls.reader = cls.payroll_user(cls, 'pay_reader', ['hr.payroll.read', 'hr.employees.read'])
        cls.manager = cls.payroll_user(
            cls, 'pay_manager', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'],
        )
        cls.hr_manager = cls.payroll_user(cls, 'pay_hr_mgr', [])
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id, 'company_id': cls.env.company.id,
        }])
        cls.staff = cls.make_employee(cls, 'Own Staff', user=cls.employee)

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _get(self, employee=None):
        return self.api('GET', f'/api/v1/hr/payroll/compensation/{(employee or self.target).id}')

    def _put(self, body=None, employee=None):
        return self.api(
            'PUT', f'/api/v1/hr/payroll/compensation/{(employee or self.target).id}',
            json=PUT_BODY if body is None else body,
        )

    def test_compensation_visibility_matrix(self):
        accountant = self.env.ref('liwan_finance.role_finance_accountant', raise_if_not_found=False)
        rows = [(self.reader, 200), (self.manager, 200), (self.hr_manager, 403)]
        for user, status in rows:
            self._login(user)
            res = self._get()
            self.assertEqual(res.status_code, status, (user.login, res.text))
        # An employee never reads pay data, not even their own.
        self.authenticate(self.employee.login, 'api_emp_pass_123')
        for employee in (self.target, self.staff):
            res = self._get(employee)
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(res.json()['code'], 'forbidden')
        if accountant:
            clerk = self.payroll_user('pay_accountant', [])
            self.env['liwan.access.service']._liwan_replace_assignments(clerk, [{
                'role_id': accountant.id, 'company_id': self.env.company.id,
            }])
            self._login(clerk)
            self.assertEqual(self._get().status_code, 403)
        for user, status in ((self.reader, 403), (self.hr_manager, 403), (self.manager, 200)):
            self._login(user)
            res = self._put()
            self.assertEqual(res.status_code, status, (user.login, res.text))

    def test_compensation_keys_are_exact(self):
        self._login(self.reader)
        res = self._get()
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), COMPENSATION_KEYS)
        self.assertEqual(body['fixed_wage'], 13500.0)
        self.assertEqual(body['employee'], {'id': self.target.id, 'name': 'Layla Target'})
        self.assertEqual(body['nationality']['code'], 'SA')
        self.assertIsNone(body['bank'])

    def test_missing_compensation_is_404(self):
        self._login(self.reader)
        res = self._get(self.make_employee('No Pay'))
        self.assertEqual(res.status_code, 404, res.text)
        self.assertEqual(res.json()['code'], 'not_found')

    def test_put_creates_then_updates(self):
        newcomer = self.make_employee('Newcomer')
        self._login(self.manager)
        res = self._put(employee=newcomer)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(set(res.json()), COMPENSATION_KEYS)
        res = self._put({**PUT_BODY, 'basic_wage': 12000}, employee=newcomer)
        self.assertEqual(res.json()['basic_wage'], 12000.0)
        self.assertEqual(self.env['liwan.hr.compensation'].search_count([('employee_id', '=', newcomer.id)]), 1)

    def test_employee_routes_never_carry_salary(self):
        user = self.payroll_user(
            'pay_all', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'],
        )
        self._login(user)
        paths = [f'/api/v1/hr/employees/{self.target.id}', '/api/v1/hr/employees']
        # The people picker belongs to liwan_directory, which an HR-only installation does not carry.
        if self.env['ir.module.module'].search_count([('name', '=', 'liwan_directory'), ('state', '=', 'installed')]):
            paths.append('/api/v1/people?q=Layla')
        for path in paths:
            res = self.api('GET', path)
            self.assertEqual(res.status_code, 200, (path, res.text))
            self.assertFalse(keys_of(res.json()) & SALARY_KEYS, path)

    def test_put_validates_iban_and_amounts(self):
        self._login(self.manager)
        self.assertEqual(self._put().status_code, 200)
        res = self._put({**PUT_BODY, 'iban': 'SA0380000000608010167518'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'iban'))
        res = self._put({**PUT_BODY, 'iban': 'GB82WEST12345698765432'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'iban'))
        res = self._put({**PUT_BODY, 'basic_wage': 0})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'basic_wage'))
        res = self._put({**PUT_BODY, 'housing_allowance': -1})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'housing_allowance'))
        res = self._put({**PUT_BODY, 'surprise': 1})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'surprise'))
        res = self._put({k: v for k, v in PUT_BODY.items() if k != 'iban'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'iban'))
        res = self._put({**PUT_BODY, 'bank_id': 999999})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'bank_id'))

    def test_iban_is_stored_compact(self):
        self._login(self.manager)
        res = self._put({**PUT_BODY, 'iban': 'sa03 8000 0000 6080 1016 7519'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['iban'], VALID_IBAN)

    def test_other_company_employee_is_404(self):
        other = self.env['res.company'].create({'name': 'Other Payroll Co'})
        foreign = self.env['hr.employee'].with_company(other).create({
            'name': 'Foreign', 'company_id': other.id,
        })
        self._login(self.manager)
        for res in (self._get(foreign), self._put(employee=foreign)):
            self.assertEqual(res.status_code, 404, res.text)
            self.assertEqual(res.json()['code'], 'not_found')

    def test_payroll_feature_off_closes_compensation(self):
        set_hr_feature(self, 'hr.payroll', False)
        self._login(self.reader)
        res = self._get()
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'feature_not_included')

    def test_non_finite_amounts_are_refused(self):
        for value in (float('nan'), float('inf')):
            with self.assertRaises(ApiError) as caught:
                parse_compensation({**PUT_BODY, 'basic_wage': value})
            self.assertEqual((caught.exception.status, caught.exception.field), (422, 'basic_wage'))

    def test_bank_is_serialized_as_a_reference(self):
        bank = self.env['res.bank'].create({'name': 'Al Rajhi Test Bank'})
        self._login(self.manager)
        res = self._put({**PUT_BODY, 'bank_id': bank.id})
        self.assertEqual(res.status_code, 200, res.text)
        self._login(self.reader)
        self.assertEqual(self._get().json()['bank'], {'id': bank.id, 'name': 'Al Rajhi Test Bank'})

    def test_relationship_type_is_the_customers_choice(self):
        self._login(self.manager)
        res = self._put({**PUT_BODY, 'relationship_type': 'unknown'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'relationship_type'))
        for relationship in ('independent_contractor', 'consultant', 'other_cooperation', 'employee'):
            with self.subTest(relationship=relationship):
                res = self._put({**PUT_BODY, 'relationship_type': relationship})
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual(res.json()['relationship_type'], relationship)
        self.assertEqual(
            self.env['liwan.hr.compensation'].create({'employee_id': self.make_employee('Default').id, 'basic_wage': 1})
            .relationship_type, 'employee',
        )
