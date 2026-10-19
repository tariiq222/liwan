# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD, WebVueFinanceCase

AUDIT = '/api/v1/finance/audit-events'
EVENT_KEYS = {'id', 'action', 'actor', 'created_at', 'res_model', 'res_id', 'fields_written', 'outcome'}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAudit(WebVueFinanceCase):

    def setUp(self):
        super().setUp()
        self.events = self.env['webvue.finance.audit.event']
        as_manager = self.events.with_user(self.manager).with_company(self.company)
        self.written = as_manager._webvue_log('company_written', self.company, fields_written=('vat', 'city'))
        self.submitted = as_manager._webvue_log('zatca_submitted', self.invoice, outcome='accepted')
        self.foreign = self.events.with_company(self.other_company)._webvue_log('chart_loaded', self.other_company)
        self.authenticate('finance_manager', 'finance_manager_pass_123')

    def _list(self, query=''):
        result = self.api('GET', AUDIT + query)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_the_list_holds_the_events_of_the_current_company_newest_first(self):
        body = self._list()
        self.assertEqual([item['id'] for item in body['items']], [self.submitted.id, self.written.id])
        self.assertEqual(body['total'], 2)
        item = body['items'][1]
        self.assertEqual(set(item), EVENT_KEYS)
        self.assertEqual(
            (item['action'], item['fields_written'], item['actor'], item['res_model'], item['res_id'], item['outcome']),
            ('company_written', ['city', 'vat'], {'id': self.manager.id, 'name': self.manager.name}, 'res.company', self.company.id, None),
        )

    def test_the_list_filters_by_action_and_date(self):
        self.assertEqual([i['id'] for i in self._list('?action=zatca_submitted')['items']], [self.submitted.id])
        self.assertEqual(self._list('?date_from=2999-01-01')['total'], 0)
        self.assertEqual(self._list('?date_to=2000-01-01')['total'], 0)
        today = str(self.written.create_date.date())
        self.assertEqual(self._list(f'?date_from={today}&date_to={today}')['total'], 2)
        self.assertEqual(self._list('?limit=1')['total'], 2)
        self.assertEqual(len(self._list('?limit=1')['items']), 1)
        for query in ('?action=nope', '?date_from=2026-13-01', '?date_from=2026-02-01&date_to=2026-01-01'):
            with self.subTest(query=query):
                self.assertEqual(self.api('GET', AUDIT + query).status_code, 422)

    def test_the_dates_are_days_in_the_user_timezone_around_midnight_riyadh(self):
        self.manager.tz = 'Asia/Riyadh'
        # 22:30 UTC on the 18th is 01:30 on the 19th in Riyadh (UTC+3).
        self.env.cr.execute(
            'UPDATE webvue_finance_audit_event SET create_date = %s WHERE id = %s', ['2026-10-18 22:30:00', self.written.id],
        )
        self.env.invalidate_all()
        ids = lambda query: {item['id'] for item in self._list(query)['items']}  # noqa: E731
        self.assertIn(self.written.id, ids('?date_from=2026-10-19&date_to=2026-10-19'))
        self.assertNotIn(self.written.id, ids('?date_from=2026-10-18&date_to=2026-10-18'))
        self.assertEqual(self._list('?date_from=2026-10-19&date_to=2026-10-19')['items'][-1]['created_at'], '2026-10-18T22:30:00Z')
        self.manager.tz = 'UTC'
        self.assertIn(self.written.id, ids('?date_from=2026-10-18&date_to=2026-10-18'))

    def test_the_audit_read_capability_gates_the_route(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertEqual(self.api('GET', AUDIT).status_code, 403)
        self.assertIn('finance.audit.read', self.env['webvue.access.role'].search([('key', '=', 'finance_manager')]).permission_ids.mapped('key'))

    def test_rows_are_immutable_for_everyone_and_only_created_through_the_log(self):
        for user in (self.manager, self.env.ref('base.user_admin'), self.env.ref('base.user_root')):
            events = self.written.with_user(user)
            with self.subTest(user=user.login), self.assertRaises(AccessError):
                events.write({'outcome': 'x'})
            with self.subTest(user=user.login), self.assertRaises(AccessError):
                events.unlink()
            with self.subTest(user=user.login), self.assertRaises(AccessError):
                self.events.with_user(user).create({'company_id': self.company.id, 'action': 'chart_loaded', 'res_model': 'x', 'res_id': 1})
        self.assertEqual(self.written.outcome, False)

    def test_a_caller_without_a_creating_capability_cannot_log(self):
        with self.assertRaises(AccessError):
            self.events.with_user(self.outsider).with_company(self.company)._webvue_log('chart_loaded', self.company)

    def test_another_company_is_never_visible(self):
        visible = self.events.with_user(self.manager).with_company(self.company).search([])
        self.assertNotIn(self.foreign, visible)
