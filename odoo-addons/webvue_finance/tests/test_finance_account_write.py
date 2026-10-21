# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PASSWORD, WebVueFinanceWriteCase

ACCOUNTS = '/api/v1/finance/accounts'
ACCOUNT_KEYS = {'id', 'code', 'name', 'account_type', 'reconcile', 'currency', 'active'}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAccountWrite(WebVueFinanceWriteCase):

    def create_account(self, **overrides):
        body = {'code': '777001', 'name': 'Consulting costs', 'account_type': 'expense', **overrides}
        result = self.api('POST', ACCOUNTS, json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def used_account(self):
        """An expense account carrying a posted 1000 SAR bill line."""
        account = self.env['account.account'].browse(self.create_account(code='777002', name='Used expense')['id'])
        bill = self.env['account.move'].with_company(self.company).create({
            'move_type': 'in_invoice', 'partner_id': self.vendor.id, 'invoice_date': '2026-10-05',
            'invoice_line_ids': [(0, 0, {'name': 'x', 'price_unit': 1000, 'quantity': 1, 'account_id': account.id, 'tax_ids': False})],
        })
        bill.action_post()
        return account

    def test_create_returns_the_account_of_the_current_company(self):
        account = self.create_account()
        self.assertEqual(set(account), ACCOUNT_KEYS)
        self.assertEqual((account['code'], account['account_type'], account['active']), ('777001', 'expense', True))
        record = self.env['account.account'].browse(account['id'])
        self.assertEqual(record.company_ids, self.company)
        self.assertEqual(self.api('GET', f'{ACCOUNTS}/{account["id"]}').json(), account)

    def test_patch_changes_the_name_code_and_reconcile(self):
        account = self.create_account()
        changed = self.api('PATCH', f'{ACCOUNTS}/{account["id"]}', json={'name': 'Advisory costs', 'code': '777009', 'reconcile': True})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((changed.json()['name'], changed.json()['code'], changed.json()['reconcile']), ('Advisory costs', '777009', True))

    def test_refusals(self):
        for body, field in (
            ({'name': 'x', 'account_type': 'expense'}, 'code'),
            ({'code': '1', 'account_type': 'expense'}, 'name'),
            ({'code': '1', 'name': 'x'}, 'account_type'),
            ({'code': '1', 'name': 'x', 'account_type': 'nope'}, 'account_type'),
            ({'code': ' ', 'name': 'x', 'account_type': 'expense'}, 'code'),
            ({'code': '1', 'name': 'x', 'account_type': 'expense', 'reconcile': 'yes'}, 'reconcile'),
            ({'code': '1', 'name': 'x', 'account_type': 'expense', 'company_ids': [1]}, 'company_ids'),
            ({'code': '1', 'name': 'x', 'account_type': 'expense', 'currency': 'ZZZ'}, 'currency'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', ACCOUNTS, json=body), 422, 'invalid', field)
        account = self.create_account()
        self.assertRefused(self.api('PATCH', f'{ACCOUNTS}/{account["id"]}', json={}), 422, 'invalid')
        self.assertRefused(self.api('GET', f'{ACCOUNTS}/999999'), 404, 'not_found')

    def test_a_duplicate_code_is_refused(self):
        self.create_account()
        self.assertRefused(self.api('POST', ACCOUNTS, json={'code': '777001', 'name': 'Twin', 'account_type': 'expense'}), 422, 'invalid')

    def test_the_type_of_an_account_with_items_cannot_change(self):
        account = self.used_account()
        self.assertRefused(
            self.api('PATCH', f'{ACCOUNTS}/{account.id}', json={'account_type': 'expense_other'}), 422, 'account_in_use', 'account_type',
        )
        self.assertEqual(account.account_type, 'expense')
        renamed = self.api('PATCH', f'{ACCOUNTS}/{account.id}', json={'name': 'Renamed'})
        self.assertEqual(renamed.status_code, 200, renamed.text)

    def test_archive_and_unarchive(self):
        account = self.create_account()
        archived = self.api('POST', f'{ACCOUNTS}/{account["id"]}/archive')
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False))
        self.assertNotIn(account['id'], [item['id'] for item in self.api('GET', ACCOUNTS).json()['items']])
        listed = self.api('GET', f'{ACCOUNTS}?archived=true').json()['items']
        self.assertIn(account['id'], [item['id'] for item in listed])
        restored = self.api('POST', f'{ACCOUNTS}/{account["id"]}/unarchive')
        self.assertEqual((restored.status_code, restored.json()['active']), (200, True))

    def test_an_account_with_a_balance_cannot_be_archived(self):
        account = self.used_account()
        self.assertRefused(self.api('POST', f'{ACCOUNTS}/{account.id}/archive'), 422, 'account_in_use')
        self.assertTrue(account.active)

    def test_the_default_account_of_a_journal_cannot_be_archived(self):
        account = self.bank.default_account_id
        self.assertRefused(self.api('POST', f'{ACCOUNTS}/{account.id}/archive'), 422, 'account_in_use')

    def test_another_company_account_is_not_found(self):
        foreign = self.env['account.account'].search([('company_ids', 'in', self.other_company.ids)], limit=1)
        self.assertRefused(self.api('GET', f'{ACCOUNTS}/{foreign.id}'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{ACCOUNTS}/{foreign.id}', json={'name': 'x'}), 404, 'not_found')
        self.assertRefused(self.api('POST', f'{ACCOUNTS}/{foreign.id}/archive'), 404, 'not_found')

    def test_every_write_leaves_an_audit_event_with_field_names_only(self):
        account = self.create_account()
        self.api('PATCH', f'{ACCOUNTS}/{account["id"]}', json={'name': 'Audited'})
        self.api('POST', f'{ACCOUNTS}/{account["id"]}/archive')
        events = self.env['webvue.finance.audit.event'].search([('res_model', '=', 'account.account'), ('res_id', '=', account['id'])])
        self.assertEqual(set(events.mapped('action')), {'account_created', 'account_changed', 'account_archived'})
        changed = events.filtered(lambda event: event.action == 'account_changed')
        self.assertEqual(changed.fields_written, 'name')
        self.assertEqual(set(events.create_uid.ids), {self.manager.id})

    def test_writes_need_the_manage_capability_and_reads_do_not_grant_it(self):
        self.user_with('accounts_reader', ['finance.accounts.read'])
        self.authenticate('accounts_reader', PASSWORD)
        self.assertEqual(self.api('GET', ACCOUNTS).status_code, 200)
        body = {'code': '777003', 'name': 'x', 'account_type': 'expense'}
        self.assertRefused(self.api('POST', ACCOUNTS, json=body), 403, 'forbidden')
        some = self.env['account.account'].search([('company_ids', 'in', self.company.ids)], limit=1)
        self.assertRefused(self.api('PATCH', f'{ACCOUNTS}/{some.id}', json={'name': 'x'}), 403, 'forbidden')
        self.assertRefused(self.api('POST', f'{ACCOUNTS}/{some.id}/archive'), 403, 'forbidden')
        self.user_with('accounts_writer', ['finance.accounts.manage', 'finance.accounts.read'])
        self.authenticate('accounts_writer', PASSWORD)
        self.assertEqual(self.api('POST', ACCOUNTS, json=body).status_code, 201)
