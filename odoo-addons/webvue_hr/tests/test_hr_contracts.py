# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged
from odoo.tools import mute_logger

from .common import WebVueHrCase

CONTRACT_KEYS = {
    'type', 'start_date', 'end_date', 'probation_end_date',
    'notice_period_days', 'identity_expiry_date',
}


@tagged('post_install', '-at_install', 'webvue')
class TestHrContracts(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_contract_admin', password='hr_contract_admin_pass_123',
            name='Contract Admin', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.contract_type = cls.env.ref('hr.contract_type_permanent')
        cls.hr_emp = cls.env['hr.employee'].create({
            'name': 'Contract Subject',
            'contract_date_start': '2026-01-01',
            'contract_date_end': '2027-01-01',
            'trial_date_end': '2026-04-01',
            'contract_type_id': cls.contract_type.id,
            'notice_period_days': 30,
            'identification_expiration_date': '2028-05-05',
        })
        cls.bare_emp = cls.env['hr.employee'].create({'name': 'No Contract'})

    def test_admin_detail_exposes_the_contract(self):
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        body = self.api('GET', f'/api/v1/hr/employees/{self.hr_emp.id}').json()
        self.assertEqual(set(body['contract']), CONTRACT_KEYS)
        self.assertEqual(body['contract'], {
            'type': {'id': self.contract_type.id, 'name': self.contract_type.name},
            'start_date': '2026-01-01',
            'end_date': '2027-01-01',
            'probation_end_date': '2026-04-01',
            'notice_period_days': 30,
            'identity_expiry_date': '2028-05-05',
        })

    def test_unset_contract_values_are_null(self):
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        contract = self.api('GET', f'/api/v1/hr/employees/{self.bare_emp.id}').json()['contract']
        self.assertEqual(contract, {
            'type': None, 'start_date': None, 'end_date': None,
            'probation_end_date': None, 'notice_period_days': 0, 'identity_expiry_date': None,
        })

    def test_plain_employee_never_sees_the_contract(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        detail = self.api('GET', f'/api/v1/hr/employees/{self.hr_emp.id}').json()
        self.assertIsNone(detail['contract'])
        listing = self.api('GET', '/api/v1/hr/employees').json()
        self.assertTrue(listing['items'])
        self.assertTrue(all(item['contract'] is None for item in listing['items']))

    def test_admin_list_keeps_the_contract_out(self):
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        listing = self.api('GET', '/api/v1/hr/employees').json()
        self.assertTrue(all(item['contract'] is None for item in listing['items']))

    def test_patch_response_carries_the_contract(self):
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/employees/{self.hr_emp.id}', {'job_title': 'Lead'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['contract']['notice_period_days'], 30)

    def test_plain_employee_cannot_read_contract_fields_on_the_orm(self):
        employee = self.hr_emp.with_user(self.employee)
        with self.assertRaises(AccessError):
            employee.read(['notice_period_days'])

    def test_manage_only_user_reads_contract_fields_without_the_stock_manager_group(self):
        user = new_test_user(
            self.env, login='hr_contract_manage_only', name='Manage Only',
            groups='webvue_core.group_employee',
        )
        self.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': self.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': self.env.company.id,
        }])
        self.assertFalse(user.has_group('hr.group_hr_manager'))
        employee = self.hr_emp.with_user(user)
        values = employee.read([
            'contract_date_start', 'contract_date_end', 'trial_date_end',
            'contract_type_id', 'notice_period_days', 'identification_expiration_date',
        ])[0]
        self.assertEqual(str(values['contract_date_start']), '2026-01-01')
        self.assertEqual(values['notice_period_days'], 30)
        self.assertEqual(values['contract_type_id'][0], self.contract_type.id)
        version = self.hr_emp.version_id.with_user(user)
        self.assertEqual(str(version.read(['contract_date_end'])[0]['contract_date_end']), '2027-01-01')

        other_company = self.env['res.company'].create({'name': 'Contract Other Company'})
        foreign = self.env['hr.employee'].create({
            'name': 'Foreign Contract', 'company_id': other_company.id,
            'contract_date_start': '2026-01-01',
        })
        with self.assertRaises(AccessError):
            foreign.version_id.with_user(user).read(['contract_date_start'])
        self.assertFalse(
            self.env['hr.version'].with_user(user).search([('id', '=', foreign.version_id.id)]),
        )

    def test_nationality_is_set_through_the_product_and_feeds_the_gosi_class(self):
        saudi = self.env.ref('base.sa')
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        self.assertIsNone(self.api('GET', f'/api/v1/hr/employees/{self.hr_emp.id}').json()['nationality'])
        res = self.api('PATCH', f'/api/v1/hr/employees/{self.hr_emp.id}', {'nationality_id': saudi.id})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['nationality'], {'id': saudi.id, 'name': saudi.name})
        self.assertEqual(self.hr_emp.current_version_id.country_id, saudi)
        # The GOSI class payroll computes is read from that same nationality.
        compensation = self.env['webvue.hr.compensation'].new({'gosi_registration_date': '2020-01-01'})
        self.assertEqual(
            self.env['webvue.hr.payroll.calculator']._webvue_gosi_class(self.hr_emp, compensation),
            'saudi_before_2024',
        )
        created = self.api('POST', '/api/v1/hr/employees', {'name': 'With Nationality', 'nationality_id': saudi.id})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['nationality']['id'], saudi.id)
        cleared = self.api('PATCH', f'/api/v1/hr/employees/{self.hr_emp.id}', {'nationality_id': None})
        self.assertIsNone(cleared.json()['nationality'])

    def test_nationality_rejects_an_unknown_country_and_stays_private(self):
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/employees/{self.hr_emp.id}', {'nationality_id': 999999999})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'nationality_id'))
        countries = self.api('GET', '/api/v1/hr/countries?q=saudi')
        self.assertEqual(countries.status_code, 200, countries.text)
        self.assertIn('SA', {item['code'] for item in countries.json()['items']})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertIsNone(self.api('GET', f'/api/v1/hr/employees/{self.hr_emp.id}').json()['nationality'])
        self.assertEqual(self.api('GET', '/api/v1/hr/countries').status_code, 403)

    def test_negative_notice_period_is_rejected(self):
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.cr.savepoint():
            self.hr_emp.write({'notice_period_days': -1})

    def _patch_contract(self, contract, employee=None):
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        return self.api('PATCH', f'/api/v1/hr/employees/{(employee or self.hr_emp).id}', {'contract': contract})

    def test_patch_contract_writes_and_clears_values(self):
        other_type = self.env.ref('hr.contract_type_seasonal')
        res = self._patch_contract({
            'start_date': '2026-02-01', 'end_date': '2027-02-01', 'probation_end_date': '2026-05-01',
            'contract_type_id': other_type.id, 'notice_period_days': 60, 'identity_expiry_date': '2029-01-01',
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['contract'], {
            'type': {'id': other_type.id, 'name': other_type.name},
            'start_date': '2026-02-01', 'end_date': '2027-02-01', 'probation_end_date': '2026-05-01',
            'notice_period_days': 60, 'identity_expiry_date': '2029-01-01',
        })
        res = self._patch_contract({'end_date': None, 'identity_expiry_date': None, 'contract_type_id': None})
        self.assertEqual(res.status_code, 200, res.text)
        contract = res.json()['contract']
        self.assertEqual(
            (contract['end_date'], contract['identity_expiry_date'], contract['type'], contract['start_date']),
            (None, None, None, '2026-02-01'),
        )

    def test_patch_contract_invalid_values_are_422(self):
        cases = (
            ({'start_date': 'soon'}, 'contract.start_date'),
            ({'identity_expiry_date': 20280101}, 'contract.identity_expiry_date'),
            ({'notice_period_days': -1}, 'contract.notice_period_days'),
            ({'notice_period_days': 1.5}, 'contract.notice_period_days'),
            ({'notice_period_days': True}, 'contract.notice_period_days'),
            ({'contract_type_id': 999999}, 'contract.contract_type_id'),
            ({'contract_type_id': 0}, 'contract.contract_type_id'),
            ({'end_date': '2025-01-01'}, 'contract.end_date'),
            ({'wage': 5000}, 'contract.wage'),
            ({}, 'contract'),
        )
        for contract, field in cases:
            with self.subTest(contract=contract):
                res = self._patch_contract(contract)
                self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'), res.text)
                self.assertEqual(res.json()['field'], field)
        res = self._patch_contract({'end_date': '2026-06-01'}, employee=self.bare_emp)
        self.assertEqual((res.status_code, res.json()['field']), (422, 'contract.end_date'))
        self.assertEqual(str(self.hr_emp.contract_date_end), '2027-01-01')

    def test_patch_contract_needs_the_manage_capability(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/employees/{self.hr_emp.id}', {'contract': {'notice_period_days': 5}})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.hr_emp.notice_period_days, 30)

    def test_manage_only_caller_reads_an_archived_employee_detail(self):
        archived = self.env['hr.employee'].create({'name': 'Archived Contract', 'active': False})
        self.authenticate('hr_contract_admin', 'hr_contract_admin_pass_123')
        res = self.api('GET', f'/api/v1/hr/employees/{archived.id}')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()['active'])
