# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The neutral extension points of PMO, exercised with patched hooks so no accounting application is needed."""
from contextlib import ExitStack, contextmanager
from decimal import Decimal
from unittest.mock import patch

from odoo.exceptions import AccessError, MissingError
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_pmo.models.project_actual_source import (
    LiwanProjectActualSource,
)

SETTINGS_URL = '/api/v1/settings/projects'
# A selection field of res.company stands in for what an application adds through the extension point.
EXTENSION_SPEC = {'name': 'font', 'kind': 'selection', 'label': 'Font', 'help': 'The report font.'}
ACCOUNT = {'id': 7, 'name': 'Alpha cost center', 'code': 'ALP'}
LINE = {
    'id': 1, 'date': '2030-01-15', 'label': 'Paper', 'reference': 'BILL/1', 'partner': None,
    'amount': 12.5, 'record': None,
}
EXTERNAL_KEYS = ('actual_source', 'actual_account', 'can_read_actual_lines', 'can_choose_actual_account')


@tagged('post_install', '-at_install', 'liwan')
class TestProjectExtensionPoints(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project.company_id = cls.env.company
        new_test_user(
            cls.env, login='api_ext_admin', password='api_ext_admin_pass_123',
            groups='liwan_pmo.group_pmo_manager',
        )
        cls.source = type(cls.env['liwan.project.actual.source'])

    def _url(self, suffix=''):
        return f'/api/v1/projects/{self.project.id}/finance{suffix}'

    def _entry(self, **fields):
        return self.env['liwan.project.finance.entry'].create({'project_id': self.project.id, **fields})

    @contextmanager
    def _external(self, can_read=True, can_choose=True, lines=([LINE], 1)):
        """Make the project external with a source that answers the six hooks."""
        project = self.project
        with ExitStack() as stack:
            patches = {
                '_liwan_is_external': True,
                '_liwan_actual_totals': {project.id: (Decimal('-12.50'), 3)},
                '_liwan_actual_account': ACCOUNT,
                '_liwan_can_read_actual_lines': can_read,
                '_liwan_can_choose_actual_account': can_choose,
                '_liwan_actual_lines': lines,
                '_liwan_set_actual_account': None,
            }
            yield {
                name: stack.enter_context(patch.object(self.source, name, return_value=value))
                for name, value in patches.items()
            }

    def test_manual_by_default(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        summary = self.api('GET', self._url('/summary')).json()
        self.assertEqual(
            {key: summary[key] for key in EXTERNAL_KEYS},
            {'actual_source': 'manual', 'actual_account': None,
             'can_read_actual_lines': False, 'can_choose_actual_account': False},
        )

    def test_base_hooks_answer_manual(self):
        base, source = LiwanProjectActualSource, self.env['liwan.project.actual.source']
        self.assertEqual(base._liwan_actual_totals(source, self.project), {})
        self.assertIsNone(base._liwan_actual_account(source, self.project))
        self.assertFalse(base._liwan_is_external(source, self.project))
        self.assertFalse(base._liwan_can_read_actual_lines(source, self.project))
        self.assertFalse(base._liwan_can_choose_actual_account(source, self.project))
        for hook, args in (('_liwan_actual_lines', (50, 0)), ('_liwan_set_actual_account', (None,))):
            with self.assertRaises(MissingError):
                getattr(base, hook)(source, self.project, *args)

    def test_external_summary_takes_the_actual_from_the_source(self):
        self._entry(kind='budget', title='Budget', amount=1000)
        self._entry(kind='expense', title='Manual cost', amount=250, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        with self._external():
            summary = self.api('GET', self._url('/summary')).json()
            self.assertEqual(
                (summary['actual'], summary['expense_count'], summary['planned'], summary['remaining']),
                (-12.5, 3, 1000, 1012.5),
            )
            self.assertEqual(
                {key: summary[key] for key in EXTERNAL_KEYS},
                {'actual_source': 'external', 'actual_account': ACCOUNT,
                 'can_read_actual_lines': True, 'can_choose_actual_account': True},
            )
            self.authenticate('api_emp', 'api_emp_pass_123')
            employee = self.api('GET', self._url('/summary')).json()
            # Choosing needs the project manager too, whatever the source says.
            self.assertEqual((employee['actual_source'], employee['can_choose_actual_account']), ('external', False))

    def test_the_report_rows_use_the_batch_of_the_source(self):
        manual = self.env['project.project'].create({'name': 'Manual project', 'company_id': self.env.company.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        with self._external():
            body = self.api('GET', '/api/v1/reports/projects/analytics').json()
        row = next(item for item in body['projects'] if item['project']['id'] == self.project.id)
        self.assertEqual((row['finance']['actual'], row['finance']['actual_source']), (-12.5, 'external'))
        other = next(item for item in body['projects'] if item['project']['id'] == manual.id)
        self.assertEqual(other['finance']['actual_source'], 'manual')

    def test_manual_expenses_are_refused_and_hidden_while_external(self):
        self._entry(kind='budget', title='Budget', amount=1000)
        expense = self._entry(kind='expense', title='Old cost', amount=250, expense_date='2030-01-01')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        with self._external():
            listed = self.api('GET', self._url()).json()
            self.assertEqual([item['kind'] for item in listed['items']], ['budget'])
            self.assertEqual(listed['total'], 1)
            self.assertEqual(self.api('GET', self._url('?kind=expense')).json()['total'], 0)
            refused = self.api('POST', self._url(), {
                'kind': 'expense', 'title': 'Cost', 'amount': 5, 'expense_date': '2030-01-02',
            })
            self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'))
            budget = self.api('POST', self._url(), {'kind': 'budget', 'title': 'More', 'amount': 5})
            self.assertEqual(budget.status_code, 201, budget.text)
            changed = self.api('PATCH', self._url(f'/{expense.id}'), {
                'amount': 300, 'expected_updated_at': expense._liwan_updated_at(),
            })
            self.assertEqual(changed.status_code, 422, changed.text)
            # An old expense can still be removed.
            deleted = self.api('DELETE', self._url(f'/{expense.id}'), {'expected_updated_at': expense._liwan_updated_at()})
            self.assertEqual(deleted.status_code, 200, deleted.text)
        created = self.api('POST', self._url(), {'kind': 'expense', 'title': 'Cost', 'amount': 5, 'expense_date': '2030-01-02'})
        self.assertEqual(created.status_code, 201, created.text)

    def test_actual_lines(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', self._url('/actual-lines')).status_code, 404)
        with self._external(can_read=False):
            self.assertEqual(self.api('GET', self._url('/actual-lines')).status_code, 403)
        with self._external() as mocks:
            body = self.api('GET', self._url('/actual-lines?limit=20&offset=5')).json()
            self.assertEqual(body, {'items': [LINE], 'total': 1})
            self.assertEqual(mocks['_liwan_actual_lines'].call_args.args, (self.project, 20, 5))
            for query, status in (('limit=0', 422), ('limit=201', 422), ('offset=-1', 422), ('kind=x', 400)):
                self.assertEqual(self.api('GET', self._url(f'/actual-lines?{query}')).status_code, status, query)

    def test_actual_account_choice(self):
        url = self._url('/actual-account')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('PATCH', url, {'account_id': 7}).status_code, 404)
        with self._external() as mocks:
            for body, status, code, field in (
                ({}, 422, 'invalid', 'account_id'),
                ({'account_id': True}, 422, 'invalid', 'account_id'),
                ({'account_id': 0}, 422, 'invalid', 'account_id'),
                ({'account_id': '7'}, 422, 'invalid', 'account_id'),
                ({'account_id': 7, 'other': 1}, 422, 'unknown_field', 'other'),
            ):
                response = self.api('PATCH', url, body)
                self.assertEqual((response.status_code, response.json()['code'], response.json()['field']),
                                 (status, code, field), body)
            mocks['_liwan_set_actual_account'].assert_not_called()
            for account_id in (7, None):
                response = self.api('PATCH', url, {'account_id': account_id})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['actual_account'], ACCOUNT)
                self.assertEqual(mocks['_liwan_set_actual_account'].call_args.args, (self.project, account_id))
            # The project manager is not a gate: the source decides who may link a cost center.
            self.authenticate('api_emp', 'api_emp_pass_123')
            self.assertEqual(self.api('PATCH', url, {'account_id': 7}).status_code, 200)
            self.assertEqual(mocks['_liwan_set_actual_account'].call_args.args, (self.project, 7))

    def test_settings_extension_is_returned_and_written_generically(self):
        self.authenticate('api_ext_admin', 'api_ext_admin_pass_123')
        self.assertEqual(self.api('GET', SETTINGS_URL).json()['extensions'], [])
        company = self.env.company
        options = [key for key, _label in company._fields['font']._description_selection(self.env)]
        other = next(key for key in options if key != company.font)
        with patch.object(type(self.env['liwan.pmo.settings']), '_liwan_settings_extensions', return_value=[EXTENSION_SPEC]):
            extension = self.api('GET', SETTINGS_URL).json()['extensions'][0]
            self.assertEqual(
                {key: extension[key] for key in ('name', 'kind', 'label', 'help')},
                {'name': 'font', 'kind': 'selection', 'label': 'Font', 'help': 'The report font.'},
            )
            self.assertEqual([option['value'] for option in extension['options']], options)
            patched = self.api('PATCH', SETTINGS_URL, {'font': other})
            self.assertEqual(patched.status_code, 200, patched.text)
            self.assertEqual(patched.json()['extensions'][0]['value'], other)
            for bad in ('not-a-font', ['x'], 3, None):
                response = self.api('PATCH', SETTINGS_URL, {'font': bad})
                self.assertEqual((response.status_code, response.json()['field']), (422, 'font'), bad)
            self.env.invalidate_all()
            self.assertEqual(company.font, other)
            # A plain company write of the declared field stays guarded, and other settings keep working.
            with self.assertRaises(AccessError):
                company.write({'font': options[0]})
            self.assertEqual(self.api('PATCH', SETTINGS_URL, {'require_charter_approval': True}).status_code, 200)
        undeclared = self.api('PATCH', SETTINGS_URL, {'font': options[0]})
        self.assertEqual((undeclared.status_code, undeclared.json()['code']), (422, 'unknown_field'))

    def test_settings_extension_declarations_are_checked(self):
        settings = self.env['liwan.pmo.settings']
        bad_specs = (
            {'name': 'no_such_field', 'kind': 'selection', 'label': 'x'},
            {'name': 'liwan_pmo_project_creators', 'kind': 'selection', 'label': 'x'},
            {'name': 'font', 'kind': 'boolean', 'label': 'x'},
        )
        for spec in bad_specs:
            with patch.object(type(settings), '_liwan_settings_extensions', return_value=[spec]), \
                    self.assertRaises(ValueError):
                settings._liwan_settings_extension_specs()

    def test_boolean_extension_payload(self):
        settings = self.env['liwan.pmo.settings']
        spec = {'name': 'active', 'kind': 'boolean', 'label': 'x'}
        with patch.object(type(settings), '_liwan_settings_extensions', return_value=[spec]):
            self.assertEqual(settings._validate_extension_payload({'active': True}), {'active': True})
            with self.assertRaises(ValueError):
                settings._validate_extension_payload({'active': 'yes'})
