# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import date
from pathlib import Path

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import set_hr_feature
from .payroll_common import PayrollCase

AUDIT = '/api/v1/hr/payroll/audit-events'
RATES = '/api/v1/hr/payroll/gosi-rates'
PROFILES = '/api/v1/hr/payroll/bank-profiles'
CASES = '/api/v1/hr/payroll/eos-cases'
EOS = '/api/v1/hr/payroll/eos'
EVENT_KEYS = {'id', 'action', 'actor', 'created_at', 'res_model', 'res_id', 'changes'}
CHANGE_KEYS = {'field', 'old_value', 'new_value'}
IBAN = 'SA0380000000608010167519'
NEW_IBAN = 'SA4420000001234567891234'
SECRET_CONSTANT = '987654321000'
GCC_RATE = {
    'branch': 'annuities', 'nationality_class': 'gcc', 'date_from': '2026-01-01',
    'employee_rate': 9, 'employer_rate': 9, 'wage_min': 1500, 'wage_max': 45000,
}
PROFILE = {
    'name': 'Audit bank', 'kind': 'bank', 'columns': [
        {'source': 'iban', 'label': 'IBAN'},
        {'source': 'constant', 'label': 'Account', 'constant_value': SECRET_CONSTANT},
    ],
}
COMPENSATION = {
    'basic_wage': 10000, 'housing_allowance': 2500, 'transport_allowance': 1000, 'other_allowance': 0,
    'iban': NEW_IBAN, 'bank_id': None, 'gosi_number': '123456789', 'gosi_registration_date': '2024-01-01',
}
DEPARTURE = date(2026, 11, 30)
# Also parsed against HR_PAYROLL_AUDIT_ACTIONS by packages/contracts/src/hr/__tests__/payrollAudit.test.ts.
ACTIONS_GOLDEN = (
    Path(__file__).resolve().parents[3]
    / 'packages/contracts/src/hr/__tests__/payroll-audit-actions.golden.json'
)


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollAudit(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        base = ['hr.payroll.read', 'hr.employees.read']
        cls.config = cls.payroll_user(cls, 'aud_config', [*base, 'hr.payroll.config'])
        cls.officer = cls.payroll_user(cls, 'aud_officer', [*base, 'hr.payroll.manage'])
        cls.approver = cls.payroll_user(cls, 'aud_approver', [*base, 'hr.payroll.approve'])
        cls.auditor = cls.payroll_user(cls, 'aud_auditor', [*base, 'hr.payroll.audit.read'])
        cls.reader = cls.payroll_user(cls, 'aud_reader', base)
        cls.leaver = cls.make_employee(cls, 'Audit Leaver', start=date(2023, 12, 1))
        cls.set_compensation(cls, cls.leaver, 8000, 2000, 500, iban=IBAN, gosi_registration_date=date(2020, 1, 1))
        cls.leaver.write({'departure_date': DEPARTURE, 'departure_reason_id': cls.env.ref('hr.departure_resigned').id})
        cls.Event = cls.env['webvue.hr.audit.event']

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _call(self, user, method, path, body=None):
        self._login(user)
        res = self.api(method, path, json=body)
        self.assertLess(res.status_code, 300, res.text)
        return res

    def _only_event(self, action, user):
        events = self.Event.search([('action', '=', action)])
        self.assertEqual(len(events), 1, action)
        self.assertEqual(events.create_uid, user, action)
        self.assertEqual(events.company_id, self.env.company, action)
        return events

    def _changes(self, event):
        return {change.field_name: (change.old_value, change.new_value) for change in event.change_ids}

    def _all_values(self):
        changes = self.env['webvue.hr.audit.change'].search([('company_id', '=', self.env.company.id)])
        return {value for value in changes.mapped('old_value') + changes.mapped('new_value') if value}

    # --- one event per write route, by the caller, with policy values --------------------------

    def test_settings_patch_records_old_and_new_policy_values(self):
        self.env['webvue.hr.payroll.settings']._webvue_save(self.env.company, {'day_divisor': 30})
        self._call(self.config, 'PATCH', '/api/v1/hr/payroll/settings', {'day_divisor': 28, 'revision': self.payroll_settings_revision()})
        event = self._only_event('payroll_settings_changed', self.config)
        self.assertEqual(self._changes(event), {'day_divisor': ('30', '28')})
        self.assertEqual(event.res_model, 'webvue.hr.payroll.settings')

    def test_first_settings_save_records_the_defaults_as_old_values(self):
        self.env['webvue.hr.payroll.settings'].search([]).unlink()
        self._call(self.config, 'PATCH', '/api/v1/hr/payroll/settings', {'day_divisor': 29, 'revision': 0})
        event = self._only_event('payroll_settings_changed', self.config)
        self.assertEqual(self._changes(event), {'day_divisor': ('30', '29')})

    def test_gosi_rate_create_change_and_delete_answer_who_changed_the_rate(self):
        created = self._call(self.config, 'POST', RATES, GCC_RATE).json()
        event = self._only_event('gosi_rate_created', self.config)
        self.assertEqual((event.res_id, self._changes(event)['employer_rate']), (created['id'], (False, '9.0')))
        self._call(self.config, 'PATCH', f'{RATES}/{created["id"]}', {'employer_rate': 10, 'revision': 1})
        event = self._only_event('gosi_rate_changed', self.config)
        self.assertEqual(self._changes(event), {'employer_rate': ('9.0', '10.0')})
        self._call(self.config, 'DELETE', f'{RATES}/{created["id"]}', {'revision': 2})
        event = self._only_event('gosi_rate_deleted', self.config)
        self.assertEqual(self._changes(event)['employer_rate'], ('10.0', False))
        self.assertEqual(self._changes(event)['date_from'], ('2026-01-01', False))

    def test_bank_profile_writes_record_layout_but_never_the_constant_value(self):
        created = self._call(self.config, 'POST', PROFILES, PROFILE).json()
        event = self._only_event('bank_profile_created', self.config)
        self.assertEqual(self._changes(event)['name'], (False, 'Audit bank'))
        self.assertEqual(self._changes(event)['column_ids'], (False, '10/iban/IBAN; 20/constant/Account'))
        self._call(self.config, 'PATCH', f'{PROFILES}/{created["id"]}', {'footer': 'totals', 'revision': 1})
        event = self._only_event('bank_profile_changed', self.config)
        self.assertEqual(self._changes(event), {'footer': ('none', 'totals')})
        self._call(self.config, 'DELETE', f'{PROFILES}/{created["id"]}', {'revision': 2})
        self._only_event('bank_profile_deleted', self.config)
        self.assertFalse(any(SECRET_CONSTANT in value for value in self._all_values()))

    def test_eos_case_map_records_the_case(self):
        reason = self.env['hr.departure.reason'].create({'name': 'Audit retired'})
        self._call(self.config, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'termination', 'revision': 0})
        event = self._only_event('eos_case_changed', self.config)
        self.assertEqual(self._changes(event)['case'], (False, 'termination'))
        self._call(self.config, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'no_award', 'revision': 1})
        events = self.Event.search([('action', '=', 'eos_case_changed')])
        self.assertEqual(len(events), 2)
        self.assertEqual(self._changes(events[0]), {'case': ('termination', 'no_award')})

    def test_settlement_save_and_confirm_record_field_names_only(self):
        self._call(self.officer, 'PUT', f'{EOS}/{self.leaver.id}/settlement', {'case': 'resignation', 'open_deductions': 300})
        saved = self._only_event('settlement_saved', self.officer)
        self.assertIn('award', self._changes(saved))
        self.assertTrue(all(values == (False, False) for values in self._changes(saved).values()))
        self._call(self.approver, 'POST', f'{EOS}/{self.leaver.id}/settlement/confirm')
        confirmed = self._only_event('settlement_confirmed', self.approver)
        self.assertEqual(self._changes(confirmed), {'state': (False, False)})

    def test_compensation_put_records_field_names_without_wage_or_iban(self):
        self._call(self.officer, 'PUT', f'/api/v1/hr/payroll/compensation/{self.leaver.id}', COMPENSATION)
        event = self._only_event('compensation_changed', self.officer)
        self.assertLessEqual({'basic_wage', 'housing_allowance', 'iban', 'gosi_number'}, set(self._changes(event)))
        self.assertTrue(all(values == (False, False) for values in self._changes(event).values()))
        values = self._all_values()
        for secret in (IBAN, NEW_IBAN, '8000', '10000', '123456789'):
            self.assertFalse(any(secret in value for value in values), secret)

    def test_refused_write_logs_nothing(self):
        self._login(self.officer)
        self.assertEqual(self.api('POST', RATES, json=GCC_RATE).status_code, 403)
        self._login(self.config)
        self.assertEqual(self.api('PATCH', '/api/v1/hr/payroll/settings', json={'day_divisor': 27, 'revision': self.payroll_settings_revision()}).status_code, 422)
        self.assertFalse(self.Event.search_count([]))

    def test_a_refused_delete_leaves_no_delete_event(self):
        rate = self._call(self.config, 'POST', RATES, GCC_RATE).json()
        profile = self._call(self.config, 'POST', PROFILES, PROFILE).json()
        logged = self.Event.search([]).ids

        def refuse(records):
            msg = 'record_locked'
            raise AccessError(msg)

        for model, path in (('webvue.hr.gosi.rate', RATES), ('webvue.hr.payroll.bank.profile', PROFILES)):
            self.patch(type(self.env[model]), 'unlink', refuse)
            record_id = rate['id'] if path == RATES else profile['id']
            self._login(self.config)
            res = self.api('DELETE', f'{path}/{record_id}', json={'revision': 1})
            self.assertEqual(res.status_code, 403, res.text)
            self.assertTrue(self.env[model].browse(record_id).exists(), model)
        self.assertEqual(self.Event.search([]).ids, logged)
        self.assertFalse(self.Event.search([('action', 'in', ('gosi_rate_deleted', 'bank_profile_deleted'))]))
        self.assertFalse(self.env['webvue.hr.audit.change'].search([('event_id', 'not in', logged)]))

    def test_forged_actor_or_company_in_a_payload_never_reaches_an_event(self):
        other = self.env['res.company'].create({'name': 'Audit Forged Co'})
        self._login(self.config)
        path = '/api/v1/hr/payroll/settings'
        revision = self.payroll_settings_revision()
        res = self.api('PATCH', path, json={'day_divisor': 28, 'revision': revision, 'create_uid': self.officer.id})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'create_uid'))
        res = self.api('PATCH', path, json={'day_divisor': 28, 'revision': revision, 'company_id': other.id})
        self.assertEqual((res.status_code, res.json()['code']), (404, 'not_found'))
        res = self.api('PATCH', path, json={'day_divisor': 28, 'revision': revision, 'company_id': self.env.company.id})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'company_id'))
        self.assertFalse(self.Event.search_count([]))
        self._call(self.config, 'PATCH', path, {'day_divisor': 28, 'revision': revision})
        event = self._only_event('payroll_settings_changed', self.config)
        self.assertNotEqual(event.company_id, other)

    # --- immutability and forgery ----------------------------------------------------------------

    def test_events_and_changes_cannot_be_created_changed_or_deleted(self):
        rate = self.env['webvue.hr.gosi.rate'].create({**GCC_RATE, 'company_id': self.env.company.id})
        logged = self.Event.with_user(self.config)._webvue_log('gosi_rate_created', rate.with_user(self.config))
        event = self.Event.browse(logged.id)
        change = event.change_ids[:1]
        self.assertTrue(change)
        for model in (self.Event.with_user(self.config), self.Event):
            with self.assertRaises(AccessError):
                model.create({
                    'company_id': self.env.company.id, 'action': 'gosi_rate_created',
                    'res_model': rate._name, 'res_id': rate.id, 'create_uid': self.officer.id,
                })
        with self.assertRaises(AccessError):
            self.env['webvue.hr.audit.change'].create({'event_id': event.id, 'field_name': 'x'})
        for record in (event, change):
            with self.assertRaises(AccessError):
                record.write({'create_uid': self.officer.id})
            with self.assertRaises(AccessError):
                record.unlink()
        self.assertEqual(event.create_uid, self.config)

    def test_log_refuses_a_record_outside_the_callers_companies_or_capability(self):
        shared = self.env['webvue.hr.gosi.rate'].search([('company_id', '=', False)], limit=1)
        with self.assertRaises(AccessError):
            self.Event.with_user(self.config)._webvue_log('gosi_rate_changed', shared.with_user(self.config))
        other = self.env['res.company'].create({'name': 'Audit Other Co'})
        foreign = self.env['webvue.hr.gosi.rate'].create({**GCC_RATE, 'company_id': other.id})
        with self.assertRaises(AccessError):
            self.Event.with_user(self.config)._webvue_log('gosi_rate_changed', foreign)
        own = self.env['webvue.hr.gosi.rate'].create({**GCC_RATE, 'company_id': self.env.company.id})
        with self.assertRaises(AccessError):
            self.Event.with_user(self.officer)._webvue_log('gosi_rate_changed', own.with_user(self.officer))
        with self.assertRaisesRegex(AccessError, 'audit_action_unknown'):
            self.Event.with_user(self.config)._webvue_log('salary_file_deleted', own.with_user(self.config))
        self.assertFalse(self.Event.search_count([]))

    def test_log_refuses_a_second_company_record_the_caller_holds_no_capability_in(self):
        other = self.env['res.company'].create({'name': 'Audit Second Co'})
        self.config.company_ids |= other
        both = {'allowed_company_ids': [self.env.company.id, other.id]}
        foreign = self.env['webvue.hr.gosi.rate'].create({**GCC_RATE, 'company_id': other.id})
        Event = self.Event.with_user(self.config).with_context(**both)
        self.assertIn(other, Event.env.companies)
        with self.assertRaisesRegex(AccessError, 'audit_capability_missing'):
            Event._webvue_log('gosi_rate_changed', foreign.with_user(self.config).with_context(**both))
        self.assertFalse(self.Event.search_count([]))

    def test_the_action_selection_matches_the_contract(self):
        selection = dict(self.Event._fields['action'].selection)
        self.assertEqual(set(selection), set(json.loads(ACTIONS_GOLDEN.read_text())))

    # --- the read route ----------------------------------------------------------------------------

    def test_audit_route_needs_the_audit_capability(self):
        self._call(self.config, 'POST', RATES, GCC_RATE)
        for user in (self.reader, self.config):
            self._login(user)
            res = self.api('GET', AUDIT)
            self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'), user.login)
        hr_manager = self.payroll_user('aud_hr_manager', [])
        self.env['webvue.access.service']._webvue_replace_assignments(hr_manager, [{
            'role_id': self.env.ref('webvue_hr.role_hr_manager').id, 'company_id': self.env.company.id,
        }])
        self._login(hr_manager)
        self.assertEqual(self.api('GET', AUDIT).status_code, 403)

    def test_audit_route_lists_events_with_filters(self):
        self._call(self.config, 'POST', RATES, GCC_RATE)
        self._call(self.config, 'PATCH', '/api/v1/hr/payroll/settings', {'day_divisor': 29, 'revision': self.payroll_settings_revision()})
        self.auditor.tz = 'UTC'
        self._login(self.auditor)
        body = self.api('GET', AUDIT).json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(body['total'], 2)
        item = body['items'][0]
        self.assertEqual(set(item), EVENT_KEYS)
        self.assertEqual(item['action'], 'payroll_settings_changed')
        self.assertEqual(item['actor'], {'id': self.config.id, 'name': self.config.name})
        self.assertTrue(all(set(change) == CHANGE_KEYS for change in item['changes']))
        filtered = self.api('GET', f'{AUDIT}?action=gosi_rate_created').json()
        self.assertEqual([event['action'] for event in filtered['items']], ['gosi_rate_created'])
        today = self.Event.search([], limit=1).create_date.date().isoformat()
        self.assertEqual(self.api('GET', f'{AUDIT}?date_from={today}&date_to={today}').json()['total'], 2)
        self.assertEqual(self.api('GET', f'{AUDIT}?date_to=2000-01-01').json()['total'], 0)
        self.assertEqual(self.api('GET', f'{AUDIT}?limit=1').json()['total'], 2)
        res = self.api('GET', f'{AUDIT}?action=bogus')
        self.assertEqual((res.status_code, res.json()['field']), (422, 'action'))
        res = self.api('GET', f'{AUDIT}?date_from=2026-02-01&date_to=2026-01-01')
        self.assertEqual((res.status_code, res.json()['field']), (422, 'date_to'))

    def test_audit_route_is_closed_without_the_payroll_feature(self):
        set_hr_feature(self, 'hr.payroll', False)
        self._login(self.auditor)
        res = self.api('GET', AUDIT)
        self.assertEqual((res.status_code, res.json()['code']), (403, 'feature_not_included'))

    def test_a_reader_of_another_company_never_sees_the_events(self):
        self._call(self.config, 'POST', RATES, GCC_RATE)
        other = self.env['res.company'].create({'name': 'Audit Reader Co'})
        foreign = self.payroll_user('aud_foreign', [])
        foreign.write({'company_ids': [(4, other.id)], 'company_id': other.id})
        self.env['webvue.access.assignment'].create({
            'user_id': foreign.id, 'role_id': self.env.ref('webvue_hr.role_payroll_manager').id, 'company_id': other.id,
        })
        self._login(foreign)
        body = self.api('GET', AUDIT).json()
        self.assertEqual((body['total'], body['items']), (0, []))
        Event = self.Event.with_user(foreign).with_company(other)
        self.assertFalse(Event.search([]))
        self.assertFalse(self.env['webvue.hr.audit.change'].with_user(foreign).with_company(other).search([]))
