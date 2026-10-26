# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    SETUP_EXPECTED_COMPANY_HEADER,
    SETUP_EXPECTED_USER_HEADER,
    WebVueFinanceCase,
)
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_finance.controllers.finance_setup import (
    EXPECTED_ID_PATTERN,
    MAX_EXPECTED_ID,
)

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

    def authenticate(self, login, password):
        """Sign in, and remember which user the session belongs to so the precondition headers can state it."""
        self.signed_in = self.env['res.users'].sudo().search([('login', '=', login)], limit=1)
        return super().authenticate(login, password)

    def _api(self, method, path, json=None, *, user=None, company=None, headers=None):
        """A setup call as the signed-in user; `headers` states a missing or malformed context on purpose."""
        identity = self.signed_in
        return self.setup_api(
            method, path, json=json, headers=headers,
            user=identity if user is None else user,
            company=identity.company_id if company is None else company,
        )

    def _get(self):
        result = self._api('GET', '/api/v1/finance/setup')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _write(self, method, route, body, **kwargs):
        return self._api(method, f'/api/v1/finance/setup/{route}', body, **kwargs)

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
        result = self._api('POST', '/api/v1/finance/setup/chart', {})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body['chart']['template'], 'sa')
        self.assertEqual(self.fresh.tax_calculation_rounding_method, 'round_globally')
        self.assertTrue(body['taxes']['vat_15_present'])
        self.assertNotIn('chart_not_loaded', body['blockers'])
        self.assertIn('company_vat_missing', body['blockers'])
        # The company identity is written by the company profile (/admin/company); setup only reads it.
        self.fresh.write(self._identity())
        body = self._get()
        self.assertEqual((body['company']['vat'], body['company']['city']), (VALID_VAT, 'Riyadh'))
        self.assertEqual(body['company']['country']['name'], self.env.ref('base.sa').name)
        # The identity is complete; only the ZATCA onboarding of the sales journal is left.
        self.assertEqual(
            (body['company']['missing_fields'], body['blockers'], body['ready']), ([], ['zatca_not_onboarded'], False),
        )
        self.assertEqual(self._get(), body)

    def test_loading_the_chart_twice_is_refused(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self._api('POST', '/api/v1/finance/setup/chart', {}).status_code, 200)
        accounts = self._get()['chart']['accounts_count']
        result = self._api('POST', '/api/v1/finance/setup/chart', {})
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

    def test_the_chart_load_is_refused_when_it_would_replace_or_recurse(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.env['res.company'].create({'name': 'Fresh Branch', 'parent_id': self.fresh.id})
        result = self._api('POST', '/api/v1/finance/setup/chart', {})
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
        result = self._api('POST', '/api/v1/finance/setup/chart', {})
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'), result.text)
        self.assertFalse(self.fresh.chart_template)

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
        result = self._api('POST', '/api/v1/finance/setup/chart', {})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), SETUP_KEYS)
        self.assertEqual(body['chart']['template'], 'sa')
        self.assertEqual(self.fresh.tax_calculation_rounding_method, 'round_globally')
        self.assertTrue(body['taxes']['vat_15_present'])
        self.assertEqual(set(self._get()['company']), COMPANY_KEYS)
        result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30, 'fiscalyear_last_month': 6})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()['fiscal']), FISCAL_KEYS)
        self.assertEqual(result.json()['fiscal']['fiscalyear_last_month'], 6)

    def test_a_user_without_the_manage_capability_changes_nothing(self):
        for login in (READER_LOGIN, OUTSIDER_LOGIN):
            self.authenticate(login, PASSWORD if login == READER_LOGIN else OUTSIDER_PASSWORD)
            for method, route, payload in (('POST', 'chart', {}), ('PATCH', 'fiscal', {'fiscalyear_last_day': 30})):
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
        self.assertEqual(self._api('POST', '/api/v1/finance/setup/chart', {}).status_code, 200)
        self.assertEqual(self._write('PATCH', 'fiscal', {'tax_lock_date': '2026-06-30'}).status_code, 200)
        self.env.invalidate_all()
        self.assertEqual(sibling.read(['vat', 'city', 'chart_template', 'fiscalyear_last_day', 'tax_lock_date']), before)
        self.assertFalse(self.other_company.city or self.company.city)

    def test_the_model_methods_refuse_non_whitelisted_fields_and_other_companies(self):
        setup = self.env['webvue.finance.setup'].with_user(
            self._user('finance_setup_direct', self.fresh, 'webvue_core.group_employee', ['finance.setup.read', 'finance.setup.manage']),
        ).with_company(self.fresh)
        for vals in ({'name': 'Hacked'}, {'hard_lock_date': '2026-01-01'}, {'currency_id': 1}, {'city': 'Riyadh'}, {'vat': VALID_VAT}, {'fiscalyear_last_day': 30, 'email': 'x@y.z'}):
            with self.subTest(vals=vals), self.assertRaises(AccessError):
                setup._webvue_write_company(self.fresh, vals)
        with self.assertRaises(AccessError):
            setup._webvue_write_company(self.company, {'fiscalyear_last_day': 30})
        with self.assertRaises(AccessError):
            setup._webvue_load_chart(self.other_company)
        with self.assertRaises(AccessError):
            setup._webvue_write_company(self.fresh | self.company, {'fiscalyear_last_day': 30})
        self.assertEqual((self.fresh.name, self.company.name, self.company.fiscalyear_last_day), ('Finance Fresh', 'Finance Company A', 31))
        self.assertFalse(self.fresh.hard_lock_date)

    def test_the_model_methods_check_the_capability_before_they_elevate(self):
        reader = self._user('finance_setup_direct_reader', self.fresh, 'webvue_core.group_employee', ['finance.setup.read'])
        setup = self.env['webvue.finance.setup'].with_user(reader).with_company(self.fresh)
        with self.assertRaises(AccessError):
            setup._webvue_load_chart(self.fresh)
        with self.assertRaises(AccessError):
            setup._webvue_write_company(self.fresh, {'fiscalyear_last_day': 30})
        self.assertFalse(self.fresh.chart_template)
        self.assertEqual(self.fresh.fiscalyear_last_day, 31)

    def test_the_chart_load_and_the_company_write_leave_a_log_record_and_audit_events(self):
        setup = self.env['webvue.finance.setup'].with_user(
            self._user('finance_setup_audited', self.fresh, 'webvue_core.group_employee', ['finance.setup.read', 'finance.setup.manage']),
        ).with_company(self.fresh)
        with self.assertLogs('odoo.addons.webvue_finance.models.setup_service', 'INFO') as logs:
            setup._webvue_load_chart(self.fresh)
            setup._webvue_write_company(self.fresh, {'fiscalyear_last_day': 30, 'fiscalyear_last_month': '6'})
        self.assertEqual(len(logs.records), 2)
        self.assertIn(f'finance.setup.chart_loaded company={self.fresh.id}', logs.output[0])
        self.assertIn(f'finance.setup.company_written company={self.fresh.id}', logs.output[1])
        self.assertIn('fields=fiscalyear_last_day, fiscalyear_last_month', logs.output[1])
        events = self.env['webvue.finance.audit.event'].search([('company_id', '=', self.fresh.id)], order='id')
        self.assertEqual(events.mapped('action'), ['chart_loaded', 'company_written'])
        self.assertEqual((events[1].fields_written, events[1].res_id, events[0].outcome), ('fiscalyear_last_day, fiscalyear_last_month', self.fresh.id, 'sa'),
        )

    def test_each_route_needs_its_own_capability(self):
        routes = (
            ('GET', '/api/v1/finance/setup'),
            ('POST', '/api/v1/finance/setup/chart'),
            ('PATCH', '/api/v1/finance/setup/fiscal'),
            ('GET', '/api/v1/finance/reports/vat?date_from=2026-10-01&date_to=2026-10-31'),
        )
        allowed = {OUTSIDER_LOGIN: (), READER_LOGIN: (routes[0],), REPORTER_LOGIN: (routes[3],)}
        for login, password in (
            (OUTSIDER_LOGIN, OUTSIDER_PASSWORD), (READER_LOGIN, PASSWORD), (REPORTER_LOGIN, PASSWORD),
        ):
            self.authenticate(login, password)
            for method, route in routes:
                with self.subTest(login=login, route=route):
                    result = self._api(method, route, {'fiscalyear_last_day': 30} if method == 'PATCH' else {})
                    if (method, route) in allowed[login]:
                        self.assertEqual(result.status_code, 200, result.text)
                    else:
                        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_writes_touch_only_the_current_company(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        self.assertEqual(self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30}).status_code, 200)
        self.assertEqual(self.fresh.fiscalyear_last_day, 30)
        self.assertEqual((self.company.fiscalyear_last_day, self.other_company.fiscalyear_last_day), (31, 31))

    def _expected_ids(self):
        """The header pair that states the identity this test's session was read for."""
        return {SETUP_EXPECTED_USER_HEADER: str(self.signed_in.id), SETUP_EXPECTED_COMPANY_HEADER: str(self.fresh.id)}

    def _audit_events(self):
        return self.env['webvue.finance.audit.event'].search_count([])

    def test_only_positive_canonical_ascii_ids_are_accepted(self):
        accepted = ('1', '31', '9007199254740991')
        refused = ('', '0', '01', '007', '+1', '-1', '1.0', '1e3', ' 1', '1 ', '1 2', '١', '1٢', '1' * 17, '9007199254740992')
        for value in accepted:
            with self.subTest(value=value):
                self.assertTrue(EXPECTED_ID_PATTERN.match(value), value)
                self.assertLessEqual(int(value), MAX_EXPECTED_ID)
        for value in refused:
            with self.subTest(value=value):
                within_contract = bool(EXPECTED_ID_PATTERN.match(value)) and len(value) <= 16 and int(value) <= MAX_EXPECTED_ID
                self.assertFalse(within_contract, value)

    def test_a_missing_or_malformed_expected_context_is_refused_before_any_effect(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        fields = ['fiscalyear_last_day', 'fiscalyear_last_month', 'tax_lock_date', 'chart_template']
        before = self.fresh.read(fields)
        events_before = self._audit_events()
        valid = self._expected_ids()
        payload = {'fiscalyear_last_day': 30, 'tax_lock_date': '2026-06-30'}
        for headers in (
            {},
            {SETUP_EXPECTED_COMPANY_HEADER: valid[SETUP_EXPECTED_COMPANY_HEADER]},
            {SETUP_EXPECTED_USER_HEADER: valid[SETUP_EXPECTED_USER_HEADER]},
            {**valid, SETUP_EXPECTED_USER_HEADER: ''},
            {**valid, SETUP_EXPECTED_COMPANY_HEADER: ''},
            {**valid, SETUP_EXPECTED_USER_HEADER: '0'},
            {**valid, SETUP_EXPECTED_COMPANY_HEADER: '0'},
            {**valid, SETUP_EXPECTED_USER_HEADER: '01'},
            {**valid, SETUP_EXPECTED_USER_HEADER: '+1'},
            {**valid, SETUP_EXPECTED_USER_HEADER: '1.0'},
            {**valid, SETUP_EXPECTED_USER_HEADER: '9007199254740992'},
            {**valid, SETUP_EXPECTED_COMPANY_HEADER: '9' * 17},
        ):
            with self.subTest(headers=headers):
                result = self._write('PATCH', 'fiscal', payload, headers=headers)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid_request_context'), result.text)
        self.env.invalidate_all()
        self.assertEqual(self.fresh.read(fields), before)
        self.assertEqual(self._audit_events(), events_before)

    def test_a_stale_expected_context_is_refused_before_any_effect_in_either_company(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        reader = self.env['res.users'].sudo().search([('login', '=', READER_LOGIN)], limit=1)
        fields = ['fiscalyear_last_day', 'fiscalyear_last_month', 'tax_lock_date']
        companies = (self.fresh, self.company, self.other_company)
        before = {company.id: company.read(fields) for company in companies}
        events_before = self._audit_events()
        payload = {'fiscalyear_last_day': 30, 'tax_lock_date': '2026-06-30'}
        for headers in (
            {SETUP_EXPECTED_USER_HEADER: str(self.signed_in.id), SETUP_EXPECTED_COMPANY_HEADER: str(self.company.id)},
            {SETUP_EXPECTED_USER_HEADER: str(reader.id), SETUP_EXPECTED_COMPANY_HEADER: str(self.fresh.id)},
            {SETUP_EXPECTED_USER_HEADER: str(self.signed_in.id), SETUP_EXPECTED_COMPANY_HEADER: str(self.other_company.id)},
        ):
            with self.subTest(headers=headers):
                result = self._write('PATCH', 'fiscal', payload, headers=headers)
                self.assertEqual((result.status_code, result.json()['code']), (409, 'request_context_changed'), result.text)
                body = result.json()
                # The refusal names no identity: neither the stated one nor the authenticated one.
                self.assertNotIn('field', body)
                for stated in (str(self.signed_in.id), str(self.company.id), str(reader.id), str(self.fresh.id)):
                    self.assertNotIn(stated, body['message'])
        self.env.invalidate_all()
        for company in companies:
            self.assertEqual(company.read(fields), before[company.id])
        self.assertEqual(self._audit_events(), events_before)

    def test_the_correct_expected_context_is_accepted_and_audited_once(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        events_before = self._audit_events()
        result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30, 'fiscalyear_last_month': 6})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((self.fresh.fiscalyear_last_day, self.fresh.fiscalyear_last_month), (30, '6'))
        self.assertEqual(self._audit_events(), events_before + 1)

    def test_the_chart_load_states_the_same_expected_context(self):
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        valid = self._expected_ids()
        missing = self._write('POST', 'chart', {}, headers={})
        self.assertEqual((missing.status_code, missing.json()['code']), (422, 'invalid_request_context'), missing.text)
        stale = self._write('POST', 'chart', {}, headers={**valid, SETUP_EXPECTED_COMPANY_HEADER: str(self.company.id)})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'request_context_changed'), stale.text)
        self.assertFalse(self.fresh.chart_template)
        self.assertEqual(self._write('POST', 'chart', {}).status_code, 200)
        self.assertEqual(self.fresh.chart_template, 'sa')

    def test_the_capability_is_checked_before_the_expected_context(self):
        # A caller without the capability is refused by authorization even with a malformed context,
        # so a 422 never stands in for a missing grant.
        self.authenticate(READER_LOGIN, PASSWORD)
        for headers in (None, {}, {SETUP_EXPECTED_USER_HEADER: '0'}):
            with self.subTest(headers=headers):
                result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30}, headers=headers)
                self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), result.text)
        self.env.invalidate_all()
        self.assertEqual(self.fresh.fiscalyear_last_day, 31)

    def _setup_manager(self):
        self._user(MANAGER_NO_ADMIN_LOGIN, self.fresh, 'webvue_core.group_employee',
                   ['finance.setup.read', 'finance.setup.manage'])
        self.authenticate(MANAGER_NO_ADMIN_LOGIN, PASSWORD)

    def _post_fresh_company_entry(self):
        self._setup_manager()
        self._write('POST', 'chart', {})
        journal = self.env['account.journal'].search([
            ('company_id', '=', self.fresh.id), ('type', '=', 'general'),
        ], limit=1)
        move = self.env['account.move'].with_company(self.fresh).create({
            'journal_id': journal.id, 'move_type': 'entry', 'date': '2026-10-01',
            'line_ids': [
                Command.create({'name': 'Debit', 'account_id': self.env['account.account'].with_company(self.fresh).search([
                    ('code', '=', '400064'), ('company_ids', 'in', self.fresh.ids),
                ], limit=1).id, 'debit': 1}),
                Command.create({'name': 'Credit', 'account_id': self.env['account.account'].with_company(self.fresh).search([
                    ('code', '=', '101001'), ('company_ids', 'in', self.fresh.ids),
                ], limit=1).id, 'credit': 1}),
            ],
        })
        move.action_post()
        return move

    def test_posted_entries_refuse_a_changed_fiscal_year_end(self):
        self._post_fresh_company_entry()
        before = (self.fresh.fiscalyear_last_day, self.fresh.fiscalyear_last_month)

        result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30, 'fiscalyear_last_month': 6})

        self.assertEqual((result.status_code, result.json()['code']), (422, 'fiscal_year_has_posted_entries'), result.text)
        self.env.invalidate_all()
        self.assertEqual((self.fresh.fiscalyear_last_day, self.fresh.fiscalyear_last_month), before)

    def test_fiscal_year_end_can_change_before_any_posted_entry(self):
        self._setup_manager()

        result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': 30, 'fiscalyear_last_month': 6})

        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((self.fresh.fiscalyear_last_day, self.fresh.fiscalyear_last_month), (30, '6'))

    def test_posted_entries_allow_unchanged_fiscal_year_values(self):
        self._post_fresh_company_entry()
        self.authenticate(MANAGER_NO_ADMIN_LOGIN, PASSWORD)

        result = self._write('PATCH', 'fiscal', {'fiscalyear_last_day': self.fresh.fiscalyear_last_day,
                                                 'fiscalyear_last_month': int(self.fresh.fiscalyear_last_month)})

        self.assertEqual(result.status_code, 200, result.text)

    def test_posted_entries_do_not_block_lock_date_tightening(self):
        self._post_fresh_company_entry()
        self.authenticate(MANAGER_NO_ADMIN_LOGIN, PASSWORD)

        result = self._write('PATCH', 'fiscal', {'fiscalyear_lock_date': '2026-06-30'})

        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(str(self.fresh.fiscalyear_lock_date), '2026-06-30')

    def test_a_closed_feature_refuses_every_setup_route(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.authenticate(ADMIN_LOGIN, PASSWORD)
        for method, route in (
            ('GET', '/api/v1/finance/setup'), ('POST', '/api/v1/finance/setup/chart'),
            ('PATCH', '/api/v1/finance/setup/fiscal'),
        ):
            with self.subTest(route=route):
                self.assertEqual(self._api(method, route, {'fiscalyear_last_day': 30}).status_code, 403)
