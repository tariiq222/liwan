# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .payroll_common import PayrollCase

SETTINGS = '/api/v1/hr/payroll/settings'
RATES = '/api/v1/hr/payroll/gosi-rates'
PROFILES = '/api/v1/hr/payroll/bank-profiles'
CASES = '/api/v1/hr/payroll/eos-cases'
GCC_RATE = {
    'branch': 'annuities', 'nationality_class': 'gcc', 'date_from': '2026-01-01',
    'employee_rate': 9, 'employer_rate': 9, 'wage_min': 1500, 'wage_max': 45000,
}
PROFILE = {'name': 'Revision bank', 'kind': 'bank', 'columns': [{'source': 'iban', 'label': 'IBAN'}]}


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollSettingsRevision(PayrollCase):
    """Two administrators reading the same revision: the first write wins, the second answers 409."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        keys = ['hr.payroll.read', 'hr.payroll.config', 'hr.employees.read']
        cls.first = cls.payroll_user(cls, 'rev_first', keys)
        cls.second = cls.payroll_user(cls, 'rev_second', keys)
        cls.Event = cls.env['liwan.hr.audit.event']

    def _as(self, user, method, path, body=None):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self.api(method, path, json=body)

    def assertRefused(self, res, status, code, field=None):
        self.assertEqual(res.status_code, status, res.text)
        self.assertEqual(res.json()['code'], code)
        if field:
            self.assertEqual(res.json()['field'], field)

    def _events(self, action):
        return self.Event.search_count([('action', '=', action)])

    # --- payroll settings (a singleton, revision 0 before its first save) -------------------------

    def test_settings_second_writer_of_the_same_revision_is_refused(self):
        self.env['liwan.hr.payroll.settings'].search([]).unlink()
        self.assertEqual(self._as(self.first, 'GET', SETTINGS).json()['revision'], 0)
        saved = self._as(self.first, 'PATCH', SETTINGS, {'day_divisor': 28, 'revision': 0})
        self.assertEqual((saved.status_code, saved.json()['revision']), (200, 1), saved.text)
        stale = self._as(self.second, 'PATCH', SETTINGS, {'day_divisor': 31, 'revision': 0})
        self.assertRefused(stale, 409, 'conflict')
        self.assertEqual(self._as(self.second, 'GET', SETTINGS).json()['day_divisor'], 28)
        self.assertEqual(self._events('payroll_settings_changed'), 1)
        again = self._as(self.second, 'PATCH', SETTINGS, {'day_divisor': 31, 'revision': 1})
        self.assertEqual((again.status_code, again.json()['revision'], again.json()['day_divisor']), (200, 2, 31))
        self.assertRefused(self._as(self.first, 'PATCH', SETTINGS, {'day_divisor': 29, 'revision': 1}), 409, 'conflict')

    def test_settings_write_without_a_revision_is_invalid(self):
        for body in ({'day_divisor': 28}, {'day_divisor': 28, 'revision': -1}, {'day_divisor': 28, 'revision': True},
                     {'day_divisor': 28, 'revision': '1'}):
            self.assertRefused(self._as(self.first, 'PATCH', SETTINGS, body), 422, 'invalid', 'revision')
        self.assertEqual(self._events('payroll_settings_changed'), 0)

    def test_settings_first_save_race_answers_409(self):
        """A concurrent first save stored the row after this request read none: the UNIQUE loser answers 409."""
        Settings = self.env['liwan.hr.payroll.settings']
        Settings.search([]).unlink()
        Settings._liwan_save(self.env.company, {'day_divisor': 29})
        self.patch(type(Settings), 'search', lambda records, *args, **kwargs: records.browse())
        self.assertRefused(self._as(self.first, 'PATCH', SETTINGS, {'day_divisor': 28, 'revision': 0}), 409, 'conflict')
        self.assertEqual(self._events('payroll_settings_changed'), 0)

    # --- GOSI rates --------------------------------------------------------------------------------

    def test_gosi_rate_second_writer_and_stale_delete_are_refused(self):
        created = self._as(self.first, 'POST', RATES, GCC_RATE).json()
        self.assertEqual(created['revision'], 1)
        path = f"{RATES}/{created['id']}"
        saved = self._as(self.first, 'PATCH', path, {'employer_rate': 10, 'revision': 1})
        self.assertEqual((saved.status_code, saved.json()['revision']), (200, 2), saved.text)
        self.assertRefused(self._as(self.second, 'PATCH', path, {'employer_rate': 12, 'revision': 1}), 409, 'conflict')
        rate = self.env['liwan.hr.gosi.rate'].browse(created['id'])
        self.assertEqual((rate.employer_rate, rate.revision), (10.0, 2))
        self.assertRefused(self._as(self.second, 'DELETE', path, {'revision': 1}), 409, 'conflict')
        self.assertTrue(rate.exists())
        self.assertEqual(self._events('gosi_rate_deleted'), 0)
        self.assertEqual(self._as(self.second, 'DELETE', path, {'revision': 2}).status_code, 204)
        self.assertFalse(rate.exists())

    def test_gosi_rate_writes_without_a_revision_are_invalid(self):
        path = f"{RATES}/{self._as(self.first, 'POST', RATES, GCC_RATE).json()['id']}"
        self.assertRefused(self._as(self.first, 'PATCH', path, {'employer_rate': 10}), 422, 'invalid', 'revision')
        self.assertRefused(self._as(self.first, 'DELETE', path), 422, 'invalid', 'revision')
        self.assertRefused(self._as(self.first, 'DELETE', path, {'revision': 1, 'force': True}), 422, 'invalid', 'force')
        self.assertEqual(self._events('gosi_rate_changed') + self._events('gosi_rate_deleted'), 0)

    # --- salary file profiles ------------------------------------------------------------------------

    def test_bank_profile_second_writer_and_stale_delete_are_refused(self):
        created = self._as(self.first, 'POST', PROFILES, PROFILE).json()
        self.assertEqual(created['revision'], 1)
        path = f"{PROFILES}/{created['id']}"
        saved = self._as(self.first, 'PATCH', path, {'footer': 'totals', 'revision': 1})
        self.assertEqual((saved.status_code, saved.json()['revision']), (200, 2), saved.text)
        self.assertRefused(self._as(self.second, 'PATCH', path, {'name': 'Overwritten', 'revision': 1}), 409, 'conflict')
        profile = self.env['liwan.hr.payroll.bank.profile'].browse(created['id'])
        self.assertEqual((profile.name, profile.footer, profile.revision), ('Revision bank', 'totals', 2))
        self.assertRefused(self._as(self.second, 'DELETE', path, {'revision': 1}), 409, 'conflict')
        self.assertTrue(profile.exists())
        self.assertEqual(self._as(self.second, 'DELETE', path, {'revision': 2}).status_code, 204)

    def test_bank_profile_writes_without_a_revision_are_invalid(self):
        path = f"{PROFILES}/{self._as(self.first, 'POST', PROFILES, PROFILE).json()['id']}"
        self.assertRefused(self._as(self.first, 'PATCH', path, {'footer': 'totals'}), 422, 'invalid', 'revision')
        self.assertRefused(self._as(self.first, 'DELETE', path), 422, 'invalid', 'revision')
        self.assertEqual(self._events('bank_profile_changed') + self._events('bank_profile_deleted'), 0)

    # --- end-of-service cases (the company row is revision 0 before its first save) ------------------

    def test_eos_case_second_writer_of_the_same_revision_is_refused(self):
        reason = self.env['hr.departure.reason'].create({'name': 'Revision retired'})
        item = next(row for row in self._as(self.first, 'GET', CASES).json()['items'] if row['departure_reason']['id'] == reason.id)
        self.assertEqual(item['revision'], 0)
        saved = self._as(self.first, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'termination', 'revision': 0})
        self.assertEqual((saved.status_code, saved.json()['revision']), (200, 1), saved.text)
        stale = self._as(self.second, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'no_award', 'revision': 0})
        self.assertRefused(stale, 409, 'conflict')
        row = self.env['liwan.hr.payroll.eos.case'].search([('departure_reason_id', '=', reason.id), ('company_id', '=', self.env.company.id)])
        self.assertEqual((row.case, row.revision), ('termination', 1))
        again = self._as(self.second, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'no_award', 'revision': 1})
        self.assertEqual((again.status_code, again.json()['revision'], again.json()['case']), (200, 2, 'no_award'))
        self.assertEqual(self._events('eos_case_changed'), 2)

    def test_eos_case_write_without_a_revision_is_invalid(self):
        reason = self.env['hr.departure.reason'].create({'name': 'Revision missing'})
        res = self._as(self.first, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'termination'})
        self.assertRefused(res, 422, 'invalid', 'revision')
        self.assertEqual(self._events('eos_case_changed'), 0)

    def test_eos_case_first_save_race_answers_409(self):
        """A concurrent first mapping stored the company row after this request read none: 409, never a 500."""
        Case = self.env['liwan.hr.payroll.eos.case']
        reason = self.env['hr.departure.reason'].create({'name': 'Revision raced'})
        Case.create({'departure_reason_id': reason.id, 'company_id': self.env.company.id, 'case': 'termination'})
        self.patch(type(Case), '_liwan_company_row', lambda records, reason, company: records.browse())
        res = self._as(self.first, 'PUT', CASES, {'departure_reason_id': reason.id, 'case': 'no_award', 'revision': 0})
        self.assertRefused(res, 409, 'conflict')
        self.assertEqual(self._events('eos_case_changed'), 0)
