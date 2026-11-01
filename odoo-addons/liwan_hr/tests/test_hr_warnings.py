# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase, set_hr_feature

WARNINGS = '/api/v1/hr/warnings'
TYPES = '/api/v1/hr/warning-types'
SETTINGS = '/api/v1/hr/warnings/settings'
WARNING_KEYS = {
    'id', 'employee', 'type', 'date_issued', 'reason', 'corrective_action', 'state', 'acknowledgement', 'ack_pending',
    'issued_by', 'issued_at', 'acknowledged_at', 'contested_at', 'contest_note', 'withdrawn_by', 'withdrawn_at',
    'withdraw_reason', 'revision',
}
TYPE_KEYS = {'id', 'name', 'severity', 'active', 'revision'}
SETTINGS_KEYS = {
    'warnings_issued_by', 'warnings_employee_acknowledgement', 'warnings_escalation_window_months', 'can_issue',
    'revision',
}
STANDING_KEYS = {'employee_id', 'window_months', 'active_count', 'highest_severity'}


@tagged('post_install', '-at_install', 'liwan')
class TestHrWarnings(LiwanHrCase):
    """Administrative warnings: types, policy, the lifecycle, who may do what, and what never leaks."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.hr = cls._user('warn_hr', ['liwan_core.role_employee', 'liwan_hr.role_hr_manager'])
        cls.manager = cls._user('warn_mgr', ['liwan_core.role_employee'])
        cls.report_user = cls._user('warn_report', ['liwan_core.role_employee'])
        cls.other_user = cls._user('warn_other', ['liwan_core.role_employee'])
        cls.reader = cls._user('warn_reader', [])
        role = cls.env['liwan.access.role'].create({
            'key': 'warn_reader_role', 'name_ar': 'reader', 'name_en': 'reader', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['hr.warnings.read', 'hr.employees.read']),
            ]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.reader, [{
            'role_id': role.id, 'company_id': cls.company.id,
        }])
        Employee = cls.env['hr.employee']
        cls.hr_emp = Employee.create({'name': 'Warn HR', 'user_id': cls.hr.id, 'company_id': cls.company.id})
        cls.mgr_emp = Employee.create({'name': 'Warn Manager', 'user_id': cls.manager.id, 'company_id': cls.company.id})
        cls.report_emp = Employee.create({
            'name': 'Warn Report', 'user_id': cls.report_user.id, 'parent_id': cls.mgr_emp.id,
            'company_id': cls.company.id,
        })
        cls.other_emp = Employee.create({'name': 'Warn Other', 'user_id': cls.other_user.id, 'company_id': cls.company.id})
        cls.no_account = Employee.create({
            'name': 'Warn No Account', 'parent_id': cls.mgr_emp.id, 'company_id': cls.company.id,
        })
        Type = cls.env['liwan.hr.warning.type']
        cls.verbal = Type.search([('company_id', '=', cls.company.id), ('code', '=', 'verbal')])
        cls.written = Type.search([('company_id', '=', cls.company.id), ('code', '=', 'written')])
        cls.final = Type.search([('company_id', '=', cls.company.id), ('code', '=', 'final')])

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

    def policy(self, issued_by='hr_only', acknowledgement='optional', window=12):
        Settings = self.env['liwan.hr.warning.settings']
        vals = {
            'warnings_issued_by': issued_by, 'warnings_employee_acknowledgement': acknowledgement,
            'warnings_escalation_window_months': window,
        }
        row = Settings.search([('company_id', '=', self.company.id)])
        if row:
            row.write(vals)
        else:
            Settings.create({**vals, 'company_id': self.company.id})

    def payload(self, employee, kind=None, **extra):
        return {
            'employee_id': employee.id, 'type_id': (kind or self.written).id, 'reason': 'Late three times',
            'corrective_action': 'Arrive on time', **extra,
        }

    def draft(self, user, employee, kind=None, **extra):
        res = self.call(user, 'POST', WARNINGS, self.payload(employee, kind, **extra))
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def issued(self, employee, kind=None, **extra):
        """A warning drafted and issued by HR; the response of the issue route."""
        warning = self.draft(self.hr, employee, kind, **extra)
        res = self.call(self.hr, 'POST', f"{WARNINGS}/{warning['id']}/issue", {'revision': warning['revision']})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def assert_status(self, res, status, code=None):
        self.assertEqual(res.status_code, status, res.text)
        if code:
            self.assertEqual(res.json()['code'], code, res.text)
        return res

    # --- types -------------------------------------------------------------------------------------------

    def test_a_company_starts_with_the_four_seeded_types(self):
        res = self.assert_status(self.call(self.other_user, 'GET', TYPES), 200)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual([item['severity'] for item in body['items']], [10, 20, 30, 40])
        self.assertEqual(set(body['items'][0]), TYPE_KEYS)
        self.assertEqual(body['total'], 4)

    def test_types_are_added_renamed_and_archived_by_the_manager_only(self):
        created = self.assert_status(self.call(self.hr, 'POST', TYPES, {'name': 'Safety breach', 'severity': 25}), 201).json()
        self.assertEqual((created['name'], created['severity'], created['active']), ('Safety breach', 25, True))
        patched = self.assert_status(self.call(self.hr, 'PATCH', f"{TYPES}/{created['id']}", {
            'revision': created['revision'], 'name': 'Safety violation', 'severity': 26,
        }), 200).json()
        self.assertEqual((patched['name'], patched['revision']), ('Safety violation', created['revision'] + 1))
        # A stale revision and a duplicate name both answer 409.
        self.assert_status(self.call(self.hr, 'PATCH', f"{TYPES}/{created['id']}", {
            'revision': created['revision'], 'name': 'Stale',
        }), 409, 'conflict')
        self.assert_status(self.call(self.hr, 'POST', TYPES, {'name': 'Safety violation', 'severity': 5}), 409, 'conflict')
        archived = self.assert_status(self.call(self.hr, 'PATCH', f"{TYPES}/{created['id']}", {
            'revision': patched['revision'], 'active': False,
        }), 200).json()
        self.assertFalse(archived['active'])
        names = [item['name'] for item in self.call(self.hr, 'GET', TYPES).json()['items']]
        self.assertNotIn('Safety violation', names)
        names = [item['name'] for item in self.call(self.hr, 'GET', f'{TYPES}?active=all').json()['items']]
        self.assertIn('Safety violation', names)
        # Nobody without the manage capability writes a type.
        for user in (self.reader, self.manager, self.other_user):
            self.assert_status(self.call(user, 'POST', TYPES, {'name': 'Nope', 'severity': 5}), 403, 'forbidden')
            self.assert_status(self.call(user, 'PATCH', f"{TYPES}/{created['id']}", {
                'revision': archived['revision'], 'name': 'Nope',
            }), 403, 'forbidden')
        self.assert_status(self.call(self.hr, 'POST', TYPES, {'name': 'Bad', 'severity': 0}), 422, 'invalid')
        self.assert_status(self.call(self.hr, 'PATCH', f"{TYPES}/{created['id']}", {'revision': 1}), 422, 'invalid')

    def test_an_archived_type_cannot_start_a_warning(self):
        archived = self.env['liwan.hr.warning.type'].create({
            'company_id': self.company.id, 'name': 'Old kind', 'severity': 5, 'active': False,
        })
        res = self.call(self.hr, 'POST', WARNINGS, self.payload(self.report_emp, archived))
        self.assert_status(res, 422, 'invalid')

    def test_the_seed_runs_once_and_keeps_a_renamed_type(self):
        self.verbal.name = 'Oral caution'
        self.company._liwan_ensure_warning_types()
        types = self.env['liwan.hr.warning.type'].with_context(active_test=False).search([
            ('company_id', '=', self.company.id),
        ])
        self.assertEqual(len(types), 4)
        self.assertEqual(self.verbal.name, 'Oral caution')

    # --- settings ----------------------------------------------------------------------------------------

    def test_settings_default_save_and_conflict(self):
        self.env['liwan.hr.warning.settings'].search([]).unlink()
        body = self.assert_status(self.call(self.other_user, 'GET', SETTINGS), 200).json()
        self.assertEqual(set(body), SETTINGS_KEYS)
        self.assertEqual(
            body,
            {'warnings_issued_by': 'hr_only', 'warnings_employee_acknowledgement': 'optional',
             'warnings_escalation_window_months': 12, 'can_issue': False, 'revision': 0},
        )
        change = {
            'warnings_issued_by': 'manager_and_hr', 'warnings_employee_acknowledgement': 'required',
            'warnings_escalation_window_months': 6,
        }
        saved = self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 0}), 200).json()
        self.assertEqual((saved['warnings_issued_by'], saved['warnings_escalation_window_months'], saved['revision']),
                         ('manager_and_hr', 6, 1))
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 0}), 409, 'conflict')
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {**change, 'revision': 1, 'warnings_issued_by': 'all'}), 422)
        self.assert_status(self.call(self.hr, 'PATCH', SETTINGS, {
            **change, 'revision': 1, 'warnings_escalation_window_months': 0,
        }), 422)
        for user in (self.manager, self.reader):
            self.assert_status(self.call(user, 'PATCH', SETTINGS, {**change, 'revision': 1}), 403, 'forbidden')
        event = self.env['liwan.hr.audit.event'].search([('action', '=', 'warning_settings_changed')])
        self.assertEqual(len(event), 1)
        self.assertEqual({row.field_name for row in event.change_ids}, {
            'warnings_issued_by', 'warnings_employee_acknowledgement', 'warnings_escalation_window_months',
        })

    # --- drafting and issuing ----------------------------------------------------------------------------

    def test_hr_drafts_then_issues_and_the_shape_is_exact(self):
        self.policy(acknowledgement='required')
        draft = self.draft(self.hr, self.report_emp)
        self.assertEqual(set(draft), WARNING_KEYS)
        self.assertEqual((draft['state'], draft['revision'], draft['issued_at']), ('draft', 1, None))
        self.assertEqual(draft['date_issued'], fields.Date.context_today(self.hr).isoformat())
        res = self.call(self.hr, 'POST', f"{WARNINGS}/{draft['id']}/issue", {'revision': 1})
        issued = self.assert_status(res, 200).json()
        self.assertEqual(set(issued), WARNING_KEYS)
        self.assertEqual((issued['state'], issued['revision'], issued['acknowledgement'], issued['ack_pending']),
                         ('issued', 2, 'required', True))
        self.assertEqual(issued['issued_by']['id'], self.hr.id)
        self.assertTrue(issued['issued_at'])
        # A second issue and a stale revision both answer 409.
        self.assert_status(self.call(self.hr, 'POST', f"{WARNINGS}/{draft['id']}/issue", {'revision': 2}), 409, 'conflict')
        stale = self.draft(self.hr, self.other_emp)
        self.assert_status(self.call(self.hr, 'POST', f"{WARNINGS}/{stale['id']}/issue", {'revision': 9}), 409, 'conflict')

    def test_the_acknowledgement_policy_is_frozen_at_issue(self):
        self.policy(acknowledgement='optional')
        issued = self.issued(self.report_emp)
        self.policy(acknowledgement='off')
        body = self.call(self.hr, 'GET', f"{WARNINGS}/{issued['id']}").json()
        self.assertEqual(body['acknowledgement'], 'optional')
        res = self.call(self.report_user, 'POST', f"{WARNINGS}/me/{issued['id']}/acknowledge", {'revision': issued['revision']})
        self.assert_status(res, 200)

    def test_create_validation(self):
        for change, field in (
            ({'reason': ' '}, 'reason'), ({'reason': None}, 'reason'), ({'employee_id': 0}, 'employee_id'),
            ({'type_id': 'x'}, 'type_id'), ({'surprise': 1}, 'surprise'), ({'date_issued': 'tomorrow'}, 'date_issued'),
        ):
            res = self.call(self.hr, 'POST', WARNINGS, {**self.payload(self.report_emp), **change})
            self.assert_status(res, 422, 'invalid')
            self.assertEqual(res.json()['field'], field)
        future = (fields.Date.context_today(self.hr) + timedelta(days=2)).isoformat()
        self.assert_status(self.call(self.hr, 'POST', WARNINGS, self.payload(self.report_emp, date_issued=future)), 422)
        self.assert_status(self.call(self.hr, 'POST', WARNINGS, self.payload(self.report_emp, employee_id=999999999)), 422)

    # --- who may issue ----------------------------------------------------------------------------------

    def test_hr_only_policy_refuses_the_direct_manager(self):
        self.policy(issued_by='hr_only')
        res = self.call(self.manager, 'POST', WARNINGS, self.payload(self.report_emp))
        self.assert_status(res, 403, 'forbidden')
        self.assertFalse(self.env['liwan.hr.warning'].search([('employee_id', '=', self.report_emp.id)]))

    def test_manager_and_hr_policy_lets_the_manager_warn_only_a_report(self):
        self.policy(issued_by='manager_and_hr')
        draft = self.draft(self.manager, self.report_emp)
        # The manager issues the draft he made, and sees nothing of what he did not make.
        issued = self.assert_status(
            self.call(self.manager, 'POST', f"{WARNINGS}/{draft['id']}/issue", {'revision': draft['revision']}), 200,
        ).json()
        self.assertEqual(issued['issued_by']['id'], self.manager.id)
        self.assert_status(self.call(self.manager, 'POST', WARNINGS, self.payload(self.other_emp)), 403, 'forbidden')
        self.assert_status(self.call(self.manager, 'POST', WARNINGS, self.payload(self.mgr_emp)), 403, 'forbidden')
        hr_draft = self.draft(self.hr, self.report_emp)
        self.assert_status(
            self.call(self.manager, 'POST', f"{WARNINGS}/{hr_draft['id']}/issue", {'revision': 1}), 404, 'not_found',
        )
        # A manager reads no warning list and cannot withdraw an issued warning.
        self.assert_status(self.call(self.manager, 'GET', WARNINGS), 403, 'forbidden')
        # He reads the warning he drafted, never one HR drafted.
        self.assert_status(self.call(self.manager, 'GET', f"{WARNINGS}/{issued['id']}"), 200)
        self.assert_status(self.call(self.manager, 'GET', f"{WARNINGS}/{hr_draft['id']}"), 404, 'not_found')
        self.assert_status(self.call(self.report_user, 'GET', f"{WARNINGS}/{issued['id']}"), 403, 'forbidden')
        res = self.call(self.manager, 'POST', f"{WARNINGS}/{issued['id']}/withdraw", {
            'revision': issued['revision'], 'reason': 'Changed my mind',
        })
        self.assert_status(res, 403, 'forbidden')
        # He may discard a draft of his own.
        own_draft = self.draft(self.manager, self.no_account)
        res = self.call(self.manager, 'POST', f"{WARNINGS}/{own_draft['id']}/withdraw", {
            'revision': 1, 'reason': 'Drafted by mistake',
        })
        self.assertEqual(self.assert_status(res, 200).json()['state'], 'withdrawn')

    def test_settings_tell_the_caller_whether_they_may_issue(self):
        self.policy(issued_by='hr_only')
        expected = {self.hr: True, self.manager: False, self.other_user: False, self.report_user: False}
        for user, can in expected.items():
            self.assertEqual(self.call(user, 'GET', SETTINGS).json()['can_issue'], can, user.login)
        self.policy(issued_by='manager_and_hr')
        # Under the manager policy only a user with reports gains the right; HR keeps it.
        expected[self.manager] = True
        for user, can in expected.items():
            self.assertEqual(self.call(user, 'GET', SETTINGS).json()['can_issue'], can, user.login)

    def test_candidates_are_the_employees_the_caller_may_warn(self):
        self.policy(issued_by='manager_and_hr')
        mine = self.assert_status(self.call(self.manager, 'GET', f'{WARNINGS}/candidates'), 200).json()
        self.assertEqual(set(mine), {'items', 'total'})
        self.assertEqual({item['id'] for item in mine['items']}, {self.report_emp.id, self.no_account.id})
        everyone = {item['id'] for item in self.call(self.hr, 'GET', f'{WARNINGS}/candidates').json()['items']}
        self.assertIn(self.other_emp.id, everyone)
        self.assertNotIn(self.hr_emp.id, everyone)
        self.assert_status(self.call(self.other_user, 'GET', f'{WARNINGS}/candidates'), 403, 'forbidden')
        self.policy(issued_by='hr_only')
        self.assert_status(self.call(self.manager, 'GET', f'{WARNINGS}/candidates'), 403, 'forbidden')

    def test_nobody_warns_their_own_employee_record(self):
        self.policy(issued_by='manager_and_hr')
        self.assert_status(self.call(self.hr, 'POST', WARNINGS, self.payload(self.hr_emp)), 403, 'forbidden')
        self.assert_status(self.call(self.reader, 'POST', WARNINGS, self.payload(self.other_emp)), 403, 'forbidden')
        self.assert_status(self.call(self.other_user, 'POST', WARNINGS, self.payload(self.other_emp)), 403, 'forbidden')

    # --- the employee's answer --------------------------------------------------------------------------

    def test_the_employee_acknowledges_once(self):
        issued = self.issued(self.report_emp)
        path = f"{WARNINGS}/me/{issued['id']}/acknowledge"
        acknowledged = self.assert_status(self.call(self.report_user, 'POST', path, {'revision': issued['revision']}), 200).json()
        self.assertEqual((acknowledged['state'], acknowledged['ack_pending']), ('acknowledged', False))
        self.assertTrue(acknowledged['acknowledged_at'])
        self.assert_status(self.call(self.report_user, 'POST', path, {'revision': acknowledged['revision']}), 409, 'conflict')
        contest = f"{WARNINGS}/me/{issued['id']}/contest"
        self.assert_status(self.call(self.report_user, 'POST', contest, {
            'revision': acknowledged['revision'], 'note': 'Too late',
        }), 409, 'conflict')

    def test_the_employee_contests_with_a_note_and_hr_withdraws(self):
        self.policy(acknowledgement='required')
        issued = self.issued(self.report_emp)
        contest = f"{WARNINGS}/me/{issued['id']}/contest"
        self.assert_status(self.call(self.report_user, 'POST', contest, {'revision': issued['revision'], 'note': ' '}), 422)
        contested = self.assert_status(self.call(self.report_user, 'POST', contest, {
            'revision': issued['revision'], 'note': 'I was on leave that day',
        }), 200).json()
        self.assertEqual((contested['state'], contested['contest_note']), ('contested', 'I was on leave that day'))
        self.assertFalse(contested['ack_pending'])
        withdrawn = self.assert_status(self.call(self.hr, 'POST', f"{WARNINGS}/{issued['id']}/withdraw", {
            'revision': contested['revision'], 'reason': 'Contest accepted',
        }), 200).json()
        self.assertEqual((withdrawn['state'], withdrawn['withdraw_reason']), ('withdrawn', 'Contest accepted'))
        self.assertEqual(withdrawn['withdrawn_by']['id'], self.hr.id)
        # A withdrawn warning is closed: no second withdrawal, no answer.
        self.assert_status(self.call(self.hr, 'POST', f"{WARNINGS}/{issued['id']}/withdraw", {
            'revision': withdrawn['revision'], 'reason': 'Again',
        }), 409, 'conflict')
        self.assert_status(self.call(self.report_user, 'POST', f"{WARNINGS}/me/{issued['id']}/acknowledge", {
            'revision': withdrawn['revision'],
        }), 409, 'conflict')

    def test_answers_are_off_when_the_company_turns_them_off(self):
        self.policy(acknowledgement='off')
        issued = self.issued(self.report_emp)
        for step, body in (('acknowledge', {}), ('contest', {'note': 'No'})):
            res = self.call(self.report_user, 'POST', f"{WARNINGS}/me/{issued['id']}/{step}", {
                'revision': issued['revision'], **body,
            })
            self.assert_status(res, 403, 'forbidden')

    def test_only_the_employee_answers_and_only_their_own(self):
        issued = self.issued(self.report_emp)
        for user in (self.other_user, self.hr, self.manager):
            res = self.call(user, 'POST', f"{WARNINGS}/me/{issued['id']}/acknowledge", {'revision': issued['revision']})
            self.assert_status(res, 404, 'not_found')
        draft = self.draft(self.hr, self.other_emp)
        res = self.call(self.other_user, 'POST', f"{WARNINGS}/me/{draft['id']}/acknowledge", {'revision': 1})
        self.assert_status(res, 404, 'not_found')

    def test_withdraw_needs_a_reason_and_the_manage_capability(self):
        issued = self.issued(self.report_emp)
        path = f"{WARNINGS}/{issued['id']}/withdraw"
        self.assert_status(self.call(self.hr, 'POST', path, {'revision': issued['revision'], 'reason': ' '}), 422)
        for user in (self.reader, self.other_user):
            res = self.call(user, 'POST', path, {'revision': issued['revision'], 'reason': 'x'})
            self.assertIn(res.status_code, (403, 404), res.text)
        self.assert_status(self.call(self.hr, 'POST', path, {'revision': issued['revision'], 'reason': 'Resolved'}), 200)

    # --- immutability and visibility --------------------------------------------------------------------

    def test_an_issued_warning_is_never_edited_directly(self):
        issued = self.issued(self.report_emp)
        warning = self.env['liwan.hr.warning'].browse(issued['id'])
        for user in (self.hr, self.report_user, self.manager):
            row = warning.with_user(user)
            with self.assertRaises(AccessError):
                row.write({'reason': 'Rewritten'})
            with self.assertRaises(AccessError):
                row.unlink()
        with self.assertRaises(AccessError):
            self.env['liwan.hr.warning'].with_user(self.hr).create({
                'employee_id': self.report_emp.id, 'type_id': self.written.id, 'reason': 'Direct',
            })
        self.assertEqual(warning.reason, 'Late three times')

    def test_the_employee_reads_only_their_own_issued_warnings(self):
        issued = self.issued(self.report_emp)
        self.draft(self.hr, self.report_emp)
        self.issued(self.other_emp)
        body = self.assert_status(self.call(self.report_user, 'GET', f'{WARNINGS}/me'), 200).json()
        self.assertEqual([item['id'] for item in body['items']], [issued['id']])
        self.assertEqual(body['total'], 1)
        self.assertEqual(set(body['items'][0]), WARNING_KEYS)
        # Not the company list, not another's record.
        self.assert_status(self.call(self.report_user, 'GET', WARNINGS), 403, 'forbidden')
        self.assert_status(self.call(self.report_user, 'GET', f"{WARNINGS}/{issued['id']}"), 403, 'forbidden')

    def test_readers_filter_the_company_list(self):
        first = self.issued(self.report_emp, self.verbal)
        second = self.issued(self.other_emp, self.final)
        self.draft(self.hr, self.other_emp)
        for user in (self.hr, self.reader):
            body = self.assert_status(self.call(user, 'GET', WARNINGS), 200).json()
            self.assertEqual(set(body), {'items', 'total'})
            self.assertGreaterEqual(body['total'], 3)
        by_employee = self.call(self.reader, 'GET', f'{WARNINGS}?employee_id={self.report_emp.id}').json()
        self.assertEqual([item['id'] for item in by_employee['items']], [first['id']])
        by_type = self.call(self.reader, 'GET', f"{WARNINGS}?type_id={self.final.id}").json()
        self.assertEqual([item['id'] for item in by_type['items']], [second['id']])
        drafts = self.call(self.reader, 'GET', f'{WARNINGS}?state=draft').json()
        self.assertTrue(drafts['items'] and all(item['state'] == 'draft' for item in drafts['items']))
        self.assert_status(self.call(self.reader, 'GET', f'{WARNINGS}?state=weird'), 422)
        self.assert_status(self.call(self.reader, 'GET', f'{WARNINGS}/999999999'), 404, 'not_found')
        # A reader reads but never writes.
        self.assert_status(self.call(self.reader, 'POST', WARNINGS, self.payload(self.other_emp)), 403, 'forbidden')

    def test_a_warning_never_appears_in_employee_directory_or_people_views(self):
        self.issued(self.report_emp)
        for path in (f'/api/v1/hr/employees/{self.report_emp.id}', '/api/v1/hr/employees', '/api/v1/people?q=Warn'):
            text = self.call(self.hr, 'GET', path).text
            self.assertNotIn('Late three times', text, path)
            self.assertNotIn('warning', text.lower(), path)

    # --- bell and audit ---------------------------------------------------------------------------------

    def bell(self, user):
        res = self.call(user, 'GET', '/api/v1/notifications')
        return [item for item in res.json()['items'] if item['kind'] == 'hr.warning_issued']

    def test_issuing_rings_the_employees_bell_only(self):
        issued = self.issued(self.report_emp)
        rows = self.bell(self.report_user)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['warning_id'], issued['id'])
        self.assertEqual(rows[0]['title'], self.written.name)
        self.assertNotIn('Late three times', str(rows[0]))
        for user in (self.hr, self.other_user, self.manager):
            self.assertEqual(self.bell(user), [])
        # A draft rings nothing, and an employee without an account has no bell.
        self.draft(self.hr, self.other_emp)
        self.issued(self.no_account)
        self.assertEqual(self.bell(self.other_user), [])

    def test_a_role_with_only_employee_read_still_gets_the_bell(self):
        plain = self._user('warn_plain', [])
        role = self.env['liwan.access.role'].create({
            'key': 'warn_plain_role', 'name_ar': 'plain', 'name_en': 'plain', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', '=', 'hr.employees.read')]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(plain, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])
        employee = self.env['hr.employee'].create({'name': 'Warn Plain', 'user_id': plain.id, 'company_id': self.company.id})
        issued = self.issued(employee)
        self.assertEqual([row['warning_id'] for row in self.bell(plain)], [issued['id']])
        own = self.call(plain, 'GET', f'{WARNINGS}/me').json()
        self.assertEqual([item['id'] for item in own['items']], [issued['id']])

    def test_every_step_is_audited_without_the_disciplinary_text(self):
        self.policy(acknowledgement='optional')
        draft = self.draft(self.hr, self.report_emp)
        self.call(self.hr, 'POST', f"{WARNINGS}/{draft['id']}/issue", {'revision': 1})
        self.call(self.report_user, 'POST', f"{WARNINGS}/me/{draft['id']}/contest", {'revision': 2, 'note': 'Not true'})
        self.call(self.hr, 'POST', f"{WARNINGS}/{draft['id']}/withdraw", {'revision': 3, 'reason': 'Accepted'})
        events = self.env['liwan.hr.audit.event'].search([('res_model', '=', 'liwan.hr.warning'), ('res_id', '=', draft['id'])])
        self.assertEqual(
            sorted(events.mapped('action')),
            ['warning_contested', 'warning_created', 'warning_issued', 'warning_withdrawn'],
        )
        by_action = {event.action: event for event in events}
        self.assertEqual(by_action['warning_contested'].create_uid, self.report_user)
        self.assertEqual(by_action['warning_issued'].create_uid, self.hr)
        values = [value for event in events for row in event.change_ids for value in (row.old_value, row.new_value)]
        for secret in ('Late three times', 'Arrive on time', 'Not true', 'Accepted'):
            self.assertNotIn(secret, values)
        moved = {row.field_name for row in by_action['warning_issued'].change_ids}
        self.assertIn('state', moved)

    def test_the_payroll_audit_route_never_lists_warning_events(self):
        self.issued(self.report_emp)
        auditor = self._user('warn_auditor', [])
        role = self.env['liwan.access.role'].create({
            'key': 'warn_auditor_role', 'name_ar': 'a', 'name_en': 'a', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ['hr.payroll.audit.read', 'hr.payroll.read', 'hr.employees.read']),
            ]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(auditor, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])
        body = self.assert_status(self.call(auditor, 'GET', '/api/v1/hr/payroll/audit-events'), 200).json()
        self.assertFalse([item for item in body['items'] if item['res_model'].startswith('liwan.hr.warning')])
        # The warning events exist, and the route's total counts none of them.
        Event = self.env['liwan.hr.audit.event']
        self.assertTrue(Event.search_count([('res_model', '=', 'liwan.hr.warning')]))
        self.assertEqual(body['total'], Event.search_count([
            ('company_id', '=', self.company.id), ('res_model', 'not like', 'liwan.hr.warning%'),
        ]))
        self.assert_status(self.call(auditor, 'GET', '/api/v1/hr/payroll/audit-events?action=warning_issued'), 422)

    # --- escalation figure ------------------------------------------------------------------------------

    def test_standing_counts_the_warnings_inside_the_window(self):
        self.policy(window=6)
        today = fields.Date.context_today(self.hr)
        self.issued(self.report_emp, self.verbal)
        contested = self.issued(self.report_emp, self.final)
        self.call(self.report_user, 'POST', f"{WARNINGS}/me/{contested['id']}/contest", {
            'revision': contested['revision'], 'note': 'No',
        })
        withdrawn = self.issued(self.report_emp, self.written)
        self.call(self.hr, 'POST', f"{WARNINGS}/{withdrawn['id']}/withdraw", {
            'revision': withdrawn['revision'], 'reason': 'Void',
        })
        self.draft(self.hr, self.report_emp)
        self.issued(self.report_emp, self.written, date_issued=(today - timedelta(days=400)).isoformat())
        body = self.assert_status(self.call(self.hr, 'GET', f'{WARNINGS}/standing/{self.report_emp.id}'), 200).json()
        self.assertEqual(set(body), STANDING_KEYS)
        # Issued and contested count; withdrawn, draft and out-of-window do not.
        self.assertEqual((body['active_count'], body['window_months'], body['highest_severity']), (2, 6, 30))
        self.policy(window=36)
        wide = self.call(self.hr, 'GET', f'{WARNINGS}/standing/{self.report_emp.id}').json()
        self.assertEqual(wide['active_count'], 3)
        empty = self.call(self.hr, 'GET', f'{WARNINGS}/standing/{self.other_emp.id}').json()
        self.assertEqual((empty['active_count'], empty['highest_severity']), (0, None))

    def test_standing_is_for_issuers_and_readers_only(self):
        self.policy(issued_by='manager_and_hr')
        self.issued(self.report_emp)
        path = f'{WARNINGS}/standing/{self.report_emp.id}'
        for user in (self.hr, self.reader, self.manager):
            self.assert_status(self.call(user, 'GET', path), 200)
        self.assert_status(self.call(self.other_user, 'GET', path), 403, 'forbidden')
        self.assert_status(self.call(self.report_user, 'GET', path), 403, 'forbidden')
        self.policy(issued_by='hr_only')
        self.assert_status(self.call(self.manager, 'GET', path), 403, 'forbidden')
        self.assert_status(self.call(self.hr, 'GET', f'{WARNINGS}/standing/999999999'), 404, 'not_found')

    # --- feature gate and company isolation -------------------------------------------------------------

    def test_feature_off_closes_every_route(self):
        issued = self.issued(self.report_emp)
        set_hr_feature(self, 'hr.warnings', False)
        for method, path, body in (
            ('GET', WARNINGS, None), ('POST', WARNINGS, self.payload(self.other_emp)),
            ('GET', f"{WARNINGS}/{issued['id']}", None), ('POST', f"{WARNINGS}/{issued['id']}/issue", {'revision': 1}),
            ('POST', f"{WARNINGS}/{issued['id']}/withdraw", {'revision': 2, 'reason': 'x'}),
            ('GET', f'{WARNINGS}/me', None), ('GET', SETTINGS, None), ('GET', TYPES, None),
            ('GET', f'{WARNINGS}/standing/{self.report_emp.id}', None),
        ):
            res = self.call(self.hr, method, path, body)
            self.assert_status(res, 403, 'feature_not_included')
        self.assert_status(self.call(self.report_user, 'POST', f"{WARNINGS}/me/{issued['id']}/acknowledge", {'revision': 2}), 403)
        self.assertEqual(self.bell(self.report_user), [])

    def test_another_company_warning_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Warnings Other Co'})
        employee = self.env['hr.employee'].create({'name': 'Elsewhere', 'company_id': other.id})
        kind = self.env['liwan.hr.warning.type'].search([('company_id', '=', other.id)], limit=1)
        row = self.env['liwan.hr.warning'].create({
            'employee_id': employee.id, 'type_id': kind.id, 'reason': 'Foreign', 'state': 'issued',
            'issued_at': fields.Datetime.now(),
        })
        self.assert_status(self.call(self.hr, 'GET', f'{WARNINGS}/{row.id}'), 404, 'not_found')
        self.assert_status(self.call(self.hr, 'GET', f'{WARNINGS}/standing/{employee.id}'), 404, 'not_found')
        self.assert_status(self.call(self.hr, 'POST', f'{WARNINGS}/{row.id}/issue', {'revision': 1}), 404, 'not_found')
        self.assertNotIn(row.id, [item['id'] for item in self.call(self.hr, 'GET', WARNINGS).json()['items']])
        # A type of another company cannot warn this company's employee.
        res = self.call(self.hr, 'POST', WARNINGS, self.payload(self.report_emp, kind))
        self.assert_status(res, 422, 'invalid')
