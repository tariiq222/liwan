# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    WebVueFinanceCase,
)
from odoo.addons.webvue_api.tests.common import set_probe_feature

SETUP_KEYS = {'chart', 'company', 'fiscal', 'journals', 'taxes', 'zatca', 'ready', 'blockers'}
COMPANY_KEYS = {
    'name', 'vat', 'company_registry', 'street', 'city', 'state', 'country', 'currency', 'missing_fields',
}
FISCAL_KEYS = {
    'fiscalyear_last_day', 'fiscalyear_last_month', 'fiscalyear_lock_date', 'tax_lock_date',
    'sale_lock_date', 'purchase_lock_date', 'hard_lock_date',
}
VALID_VAT = '300000000000003'
PASSWORD = 'finance_setup_pass_123'
ADMIN_LOGIN = 'finance_setup_admin'
READER_LOGIN = 'finance_setup_reader'
REPORTER_LOGIN = 'finance_setup_reporter'
MANAGER_NO_ADMIN_LOGIN = 'finance_setup_manager'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceSetup(WebVueFinanceCase):
    """The setup status and the guided steps, on a Saudi company without a chart."""

    @classmethod
    def _user(cls, login, company, groups, keys):
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login, groups=groups,
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        role = cls.env['webvue.access.role'].with_company(company).create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(
            user, [{'role_id': role.id, 'company_id': company.id}],
        )
        return user

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        saudi_arabia = cls.env.ref('base.sa')
        cls.fresh = cls.env['res.company'].create({
            'name': 'Finance Fresh', 'country_id': saudi_arabia.id, 'currency_id': cls.env.ref('base.SAR').id,
        })
        cls.state = cls.env['res.country.state'].search([('country_id', '=', saudi_arabia.id)], limit=1)
        cls._user(ADMIN_LOGIN, cls.fresh, 'webvue_core.group_employee',
                  ['finance.setup.read', 'finance.setup.manage'])
        cls._user(READER_LOGIN, cls.fresh, 'webvue_core.group_employee', ['finance.setup.read'])
        cls._user(REPORTER_LOGIN, cls.fresh, 'webvue_core.group_employee', ['finance.reports.read'])

    def _get(self):
        result = self.api('GET', '/api/v1/finance/setup')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _write(self, method, route, body):
        return self.api(method, f'/api/v1/finance/setup/{route}', json=body)

    def _identity(self, **overrides):
        return {
            'vat': VALID_VAT, 'company_registry': '1010000000', 'street': 'King Fahd Road', 'city': 'Riyadh',
            'country_id': self.env.ref('base.sa').id, 'state_id': self.state.id, **overrides,
        }

    def test_a_company_with_a_chart_reports_it_and_the_missing_identity(self):
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        body = self._get()
        self.assertEqual(set(body), SETUP_KEYS)
        self.assertEqual(set(body['company']), COMPANY_KEYS)
        self.assertEqual(set(body['fiscal']), FISCAL_KEYS)
        self.assertEqual(body['chart']['template'], 'sa')
        self.assertTrue(body['chart']['loaded'])
        self.assertGreater(body['chart']['accounts_count'], 100)
        self.assertEqual(body['company']['name'], 'Finance Company A')
        self.assertEqual(body['company']['currency'], 'SAR')
        self.assertTrue(body['taxes']['vat_15_present'])
        self.assertGreaterEqual(body['journals']['sale'], 1)
        self.assertEqual(set(body['journals']), {'sale', 'purchase', 'bank', 'cash'})
        self.assertNotIn('chart_not_loaded', body['blockers'])
        self.assertEqual(body['blockers'], [
            'company_vat_missing', 'company_registry_missing', 'company_address_incomplete', 'zatca_not_onboarded',
        ])
        self.assertFalse(body['ready'])

    def test_a_company_without_a_chart_is_blocked_on_it(self):
        self.authenticate(READER_LOGIN, PASSWORD)
        body = self._get()
        self.assertEqual(body['chart'], {'loaded': False, 'template': None, 'accounts_count': 0})
        self.assertEqual(body['company']['name'], 'Finance Fresh')
        self.assertEqual(body['blockers'][0], 'chart_not_loaded')
        self.assertEqual(body['journals'], {'sale': 0, 'purchase': 0, 'bank': 0, 'cash': 0})
        self.assertFalse(body['taxes']['vat_15_present'])

    def test_the_guided_steps_clear_the_blockers_one_by_one(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        result = self.api('POST', '/api/v1/finance/setup/chart', json={})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body['chart']['template'], 'sa')
        self.assertTrue(body['taxes']['vat_15_present'])
        self.assertNotIn('chart_not_loaded', body['blockers'])
        self.assertIn('company_vat_missing', body['blockers'])
        result = self._write('PATCH', 'company', self._identity())
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['company']['vat'], body['company']['city']), (VALID_VAT, 'Riyadh'))
        self.assertEqual(body['company']['country']['name'], self.env.ref('base.sa').name)
        # The identity is complete; only the ZATCA onboarding of the sales journal is left.
        self.assertEqual(
            (body['company']['missing_fields'], body['blockers'], body['ready']), ([], ['zatca_not_onboarded'], False),
        )
        self.assertEqual(self._get(), body)

    def test_loading_the_chart_twice_is_refused(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self.api('POST', '/api/v1/finance/setup/chart', json={}).status_code, 200)
        accounts = self._get()['chart']['accounts_count']
        result = self.api('POST', '/api/v1/finance/setup/chart', json={})
        self.assertEqual((result.status_code, result.json()['code']), (422, 'chart_already_loaded'))
        self.assertEqual(self._get()['chart']['accounts_count'], accounts)

    def test_the_fiscal_year_and_lock_dates_are_written(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        result = self._write('PATCH', 'fiscal', {
            'fiscalyear_last_day': 30, 'fiscalyear_last_month': 6, 'tax_lock_date': '2026-06-30',
        })
        self.assertEqual(result.status_code, 200, result.text)
        fiscal = result.json()['fiscal']
        self.assertEqual((fiscal['fiscalyear_last_day'], fiscal['fiscalyear_last_month']), (30, 6))
        self.assertEqual((fiscal['tax_lock_date'], fiscal['hard_lock_date']), ('2026-06-30', None))
        later = self._write('PATCH', 'fiscal', {'tax_lock_date': '2026-07-31'})
        self.assertEqual(later.json()['fiscal']['tax_lock_date'], '2026-07-31')

    def test_a_lock_date_can_only_be_tightened(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self._write('PATCH', 'fiscal', {'sale_lock_date': '2026-06-30'}).status_code, 200)
        self.assertEqual(self._write('PATCH', 'fiscal', {'sale_lock_date': '2026-06-30'}).status_code, 200)
        for value in ('2026-05-31', None):
            with self.subTest(value=value):
                result = self._write('PATCH', 'fiscal', {'sale_lock_date': value})
                self.assertEqual((result.status_code, result.json()['code']), (422, 'lock_date_loosening'), result.text)
                self.assertEqual(result.json()['field'], 'sale_lock_date')
        self.assertEqual(self._get()['fiscal']['sale_lock_date'], '2026-06-30')

    def test_a_stock_redirect_warning_is_a_422_without_the_action(self):
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        journal = self.env['account.journal'].search([('company_id', '=', self.company.id), ('type', '=', 'bank')], limit=1)
        self.env['account.bank.statement.line'].with_company(self.company).create({
            'journal_id': journal.id, 'amount': 100, 'date': '2026-01-10', 'payment_ref': 'unreconciled',
        })
        result = self._write('PATCH', 'fiscal', {'fiscalyear_lock_date': '2026-06-30'})
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'), result.text)
        self.assertNotIn('action', result.text.lower().replace('unreconciled', ''))
        self.assertFalse(self.company.fiscalyear_lock_date)

    def test_changing_only_the_country_revalidates_the_state(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self._write('PATCH', 'company', {'state_id': self.state.id}).status_code, 200)
        other_country = self.env['res.country.state'].search(
            [('country_id', '!=', self.env.ref('base.sa').id)], limit=1,
        ).country_id
        result = self._write('PATCH', 'company', {'country_id': other_country.id})
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'invalid', 'state_id'))
        self.assertEqual(self.fresh.country_id, self.env.ref('base.sa'))
        result = self._write('PATCH', 'company', {'country_id': other_country.id, 'state_id': None})
        self.assertEqual(result.status_code, 200, result.text)

    def test_the_chart_load_is_refused_when_it_would_replace_or_recurse(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.env['res.company'].create({'name': 'Fresh Branch', 'parent_id': self.fresh.id})
        result = self.api('POST', '/api/v1/finance/setup/chart', json={})
        self.assertEqual(result.status_code, 422, result.text[:800])
        self.assertEqual((result.status_code, result.json()['code']), (422, 'company_has_branches'), result.text[:600])
        self.assertFalse(self.fresh.chart_template)

    def test_the_chart_load_is_refused_when_entries_exist(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        journal = self.env['account.journal'].create({
            'name': 'Misc', 'code': 'MSC', 'type': 'general', 'company_id': self.fresh.id,
        })
        self.env['account.move'].with_company(self.fresh).create({
            'journal_id': journal.id, 'move_type': 'entry', 'date': '2026-10-01', 'company_id': self.fresh.id,
        })
        result = self.api('POST', '/api/v1/finance/setup/chart', json={})
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'), result.text)
        self.assertFalse(self.fresh.chart_template)

    def test_invalid_company_payloads_are_422(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        other_state = self.env['res.country.state'].search([('country_id', '!=', self.env.ref('base.sa').id)], limit=1)
        for body, field in (
            ({}, None),
            ({'vat': 'not-a-vat'}, None),
            ({'vat': 12}, 'vat'),
            ({'currency': 'USD'}, 'currency'),
            ({'country_id': 0}, 'country_id'),
            ({'country_id': 999999999}, 'country_id'),
            ({'state_id': other_state.id, 'country_id': self.env.ref('base.sa').id}, 'state_id'),
        ):
            with self.subTest(body=body):
                result = self._write('PATCH', 'company', body)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'), result.text)
                if field:
                    self.assertEqual(result.json()['field'], field)
        self.assertEqual(self._get()['company']['vat'], '')

    def test_invalid_fiscal_payloads_are_422(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        for body, field in (
            ({}, None),
            ({'fiscalyear_last_day': 32}, 'fiscalyear_last_day'),
            ({'fiscalyear_last_day': True}, 'fiscalyear_last_day'),
            ({'fiscalyear_last_month': 13}, 'fiscalyear_last_month'),
            ({'tax_lock_date': 'tomorrow'}, 'tax_lock_date'),
            ({'tax_lock_date': 20261031}, 'tax_lock_date'),
            ({'hard_lock_date': '2026-01-01'}, 'hard_lock_date'),
            ({'fiscalyear_last_day': 31, 'fiscalyear_last_month': 2}, None),
        ):
            with self.subTest(body=body):
                result = self._write('PATCH', 'fiscal', body)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'), result.text)
                if field:
                    self.assertEqual(result.json()['field'], field)

    def test_a_finance_manager_who_is_not_an_administrator_finishes_the_setup(self):
        manager = self._user(MANAGER_NO_ADMIN_LOGIN, self.fresh, 'webvue_core.group_employee',
                             ['finance.setup.read', 'finance.setup.manage'])
        self.assertFalse(manager.has_group('base.group_system'))
        self.authenticate(MANAGER_NO_ADMIN_LOGIN, PASSWORD)
        result = self.api('POST', '/api/v1/finance/setup/chart', json={})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), SETUP_KEYS)
        self.assertEqual(body['chart']['template'], 'sa')
        self.assertTrue(body['taxes']['vat_15_present'])
        result = self._write('PATCH', 'company', self._identity())
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()['company']), COMPANY_KEYS)
        self.assertEqual(result.json()['company']['vat'], VALID_VAT)
        result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30, 'fiscalyear_last_month': 6})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()['fiscal']), FISCAL_KEYS)
        self.assertEqual(result.json()['fiscal']['fiscalyear_last_month'], 6)

    def test_a_user_without_the_manage_capability_changes_nothing(self):
        for login, body in ((READER_LOGIN, {'city': 'Jeddah'}), (OUTSIDER_LOGIN, {'city': 'Jeddah'})):
            self.authenticate(login, PASSWORD if login == READER_LOGIN else OUTSIDER_PASSWORD)
            for method, route, payload in (
                ('POST', 'chart', {}), ('PATCH', 'company', body), ('PATCH', 'fiscal', {'fiscalyear_last_day': 30}),
            ):
                with self.subTest(login=login, route=route):
                    result = self._write(method, route, payload)
                    self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), result.text)
        self.env.invalidate_all()
        self.assertFalse(self.fresh.chart_template)
        self.assertFalse(self.fresh.city)
        self.assertEqual(self.fresh.fiscalyear_last_day, 31)
        self.assertFalse(self.company.city)

    def test_the_manager_who_is_not_an_administrator_never_touches_another_company(self):
        self._user(MANAGER_NO_ADMIN_LOGIN, self.fresh, 'webvue_core.group_employee',
                   ['finance.setup.read', 'finance.setup.manage'])
        sibling = self.env['res.company'].create({
            'name': 'Finance Sibling', 'country_id': self.env.ref('base.sa').id,
            'currency_id': self.env.ref('base.SAR').id,
        })
        before = sibling.read(['vat', 'city', 'chart_template', 'fiscalyear_last_day', 'tax_lock_date'])
        self.authenticate(MANAGER_NO_ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self.api('POST', '/api/v1/finance/setup/chart', json={}).status_code, 200)
        self.assertEqual(self._write('PATCH', 'company', self._identity()).status_code, 200)
        self.assertEqual(self._write('PATCH', 'fiscal', {'tax_lock_date': '2026-06-30'}).status_code, 200)
        self.env.invalidate_all()
        self.assertEqual(sibling.read(['vat', 'city', 'chart_template', 'fiscalyear_last_day', 'tax_lock_date']), before)
        self.assertFalse(self.other_company.city or self.company.city)

    def test_the_model_methods_refuse_non_whitelisted_fields_and_other_companies(self):
        setup = self.env['webvue.finance.setup'].with_user(
            self._user('finance_setup_direct', self.fresh, 'webvue_core.group_employee', ['finance.setup.read', 'finance.setup.manage']),
        ).with_company(self.fresh)
        for vals in ({'name': 'Hacked'}, {'hard_lock_date': '2026-01-01'}, {'currency_id': 1}, {'city': 'Riyadh', 'email': 'x@y.z'}):
            with self.subTest(vals=vals), self.assertRaises(AccessError):
                setup._webvue_write_company(self.fresh, vals)
        with self.assertRaises(AccessError):
            setup._webvue_write_company(self.company, {'city': 'Riyadh'})
        with self.assertRaises(AccessError):
            setup._webvue_load_chart(self.other_company)
        with self.assertRaises(AccessError):
            setup._webvue_write_company(self.fresh | self.company, {'city': 'Riyadh'})
        self.assertEqual((self.fresh.name, self.company.name, self.company.city), ('Finance Fresh', 'Finance Company A', False))
        self.assertFalse(self.fresh.hard_lock_date)

    def test_each_route_needs_its_own_capability(self):
        routes = (
            ('GET', '/api/v1/finance/setup'),
            ('POST', '/api/v1/finance/setup/chart'),
            ('PATCH', '/api/v1/finance/setup/company'),
            ('PATCH', '/api/v1/finance/setup/fiscal'),
            ('GET', '/api/v1/finance/reports/vat?date_from=2026-10-01&date_to=2026-10-31'),
        )
        allowed = {OUTSIDER_LOGIN: (), READER_LOGIN: (routes[0],), REPORTER_LOGIN: (routes[4],)}
        for login, password in (
            (OUTSIDER_LOGIN, OUTSIDER_PASSWORD), (READER_LOGIN, PASSWORD), (REPORTER_LOGIN, PASSWORD),
        ):
            self.authenticate(login, password)
            for method, route in routes:
                with self.subTest(login=login, route=route):
                    result = self.api(method, route, json={'city': 'Riyadh'} if method == 'PATCH' else {})
                    if (method, route) in allowed[login]:
                        self.assertEqual(result.status_code, 200, result.text)
                    else:
                        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_writes_touch_only_the_current_company(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self._write('PATCH', 'company', {'city': 'Dammam'}).status_code, 200)
        self.assertEqual(self.fresh.city, 'Dammam')
        self.assertFalse(self.company.city or self.other_company.city)

    def test_a_closed_feature_refuses_every_setup_route(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        for method, route in (
            ('GET', '/api/v1/finance/setup'), ('POST', '/api/v1/finance/setup/chart'),
            ('PATCH', '/api/v1/finance/setup/company'), ('PATCH', '/api/v1/finance/setup/fiscal'),
        ):
            with self.subTest(route=route):
                self.assertEqual(self.api(method, route, json={'city': 'Riyadh'}).status_code, 403)
