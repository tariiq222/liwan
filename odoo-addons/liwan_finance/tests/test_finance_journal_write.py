# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PASSWORD, LiwanFinanceWriteCase

JOURNALS = '/api/v1/finance/journals'
JOURNAL_KEYS = {'id', 'name', 'code', 'type', 'currency', 'default_account', 'active'}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceJournalWrite(LiwanFinanceWriteCase):

    def liquidity_account(self, code='101999'):
        return self.env['account.account'].create({
            'code': code, 'name': 'Petty cash', 'account_type': 'asset_cash', 'company_ids': [(6, 0, self.company.ids)],
        })

    def create_journal(self, **overrides):
        body = {'name': 'Branch sales', 'code': 'BRS', 'type': 'sale', **overrides}
        result = self.api('POST', JOURNALS, json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_create_a_sales_journal(self):
        journal = self.create_journal()
        self.assertEqual(set(journal), JOURNAL_KEYS)
        self.assertEqual((journal['code'], journal['type'], journal['active'], journal['currency']), ('BRS', 'sale', True, 'SAR'))
        record = self.env['account.journal'].browse(journal['id'])
        self.assertEqual(record.company_id, self.company)
        self.assertEqual(self.api('GET', f'{JOURNALS}/{journal["id"]}').json(), journal)

    def test_a_cash_journal_names_its_account(self):
        body = {'name': 'Petty cash', 'code': 'PTY', 'type': 'cash'}
        self.assertRefused(self.api('POST', JOURNALS, json=body), 422, 'invalid', 'default_account_id')
        account = self.liquidity_account()
        journal = self.create_journal(**body, default_account_id=account.id)
        self.assertEqual(journal['default_account']['id'], account.id)

    def test_the_default_account_must_be_of_this_company(self):
        foreign = self.env['account.account'].search([('company_ids', 'in', self.other_company.ids)], limit=1)
        body = {'name': 'Cash', 'code': 'CSX', 'type': 'cash', 'default_account_id': foreign.id}
        self.assertRefused(self.api('POST', JOURNALS, json=body), 422, 'invalid', 'default_account_id')

    def test_patch_changes_name_and_code_but_never_the_type(self):
        journal = self.create_journal()
        changed = self.api('PATCH', f'{JOURNALS}/{journal["id"]}', json={'name': 'Branch sales 2', 'code': 'BR2'})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((changed.json()['name'], changed.json()['code']), ('Branch sales 2', 'BR2'))
        self.assertRefused(self.api('PATCH', f'{JOURNALS}/{journal["id"]}', json={'type': 'purchase'}), 422, 'invalid', 'type')
        self.assertRefused(self.api('PATCH', f'{JOURNALS}/{journal["id"]}', json={}), 422, 'invalid')

    def test_refusals(self):
        for body, field in (
            ({'code': 'X', 'type': 'sale'}, 'name'),
            ({'name': 'x', 'type': 'sale'}, 'code'),
            ({'name': 'x', 'code': 'X'}, 'type'),
            ({'name': 'x', 'code': 'X', 'type': 'nope'}, 'type'),
            ({'name': 'x', 'code': 'X', 'type': 'sale', 'currency': 'ZZZ'}, 'currency'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', JOURNALS, json=body), 422, 'invalid', field)
        # A payload company_id outside the pinned request set is the uniform not-found.
        self.assertRefused(
            self.api('POST', JOURNALS, json={'name': 'x', 'code': 'X', 'type': 'sale', 'company_id': 1}),
            404, 'not_found',
        )
        self.assertRefused(self.api('GET', f'{JOURNALS}/999999'), 404, 'not_found')

    def test_a_duplicate_code_is_refused(self):
        self.create_journal()
        self.assertRefused(self.api('POST', JOURNALS, json={'name': 'Twin', 'code': 'BRS', 'type': 'sale'}), 422, 'invalid')

    def test_archive_and_unarchive(self):
        journal = self.create_journal()
        archived = self.api('POST', f'{JOURNALS}/{journal["id"]}/archive')
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False))
        self.assertNotIn(journal['id'], [item['id'] for item in self.api('GET', JOURNALS).json()['items']])
        self.assertIn(journal['id'], [item['id'] for item in self.api('GET', f'{JOURNALS}?archived=true').json()['items']])
        restored = self.api('POST', f'{JOURNALS}/{journal["id"]}/unarchive')
        self.assertEqual((restored.status_code, restored.json()['active']), (200, True))

    def test_a_journal_with_draft_entries_cannot_be_archived(self):
        journal = self.env['account.journal'].browse(self.create_journal(name='Misc 2', code='MS2', type='general')['id'])
        self.env['account.move'].create({'move_type': 'entry', 'journal_id': journal.id, 'date': '2026-10-05'})
        self.assertRefused(self.api('POST', f'{JOURNALS}/{journal.id}/archive'), 422, 'invalid')
        self.assertTrue(journal.active)

    def test_another_company_journal_is_not_found(self):
        foreign = self.other_bank
        self.assertRefused(self.api('GET', f'{JOURNALS}/{foreign.id}'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{JOURNALS}/{foreign.id}', json={'name': 'x'}), 404, 'not_found')
        self.assertRefused(self.api('POST', f'{JOURNALS}/{foreign.id}/archive'), 404, 'not_found')

    def test_every_write_leaves_an_audit_event_with_field_names_only(self):
        journal = self.create_journal()
        self.api('PATCH', f'{JOURNALS}/{journal["id"]}', json={'name': 'Audited'})
        self.api('POST', f'{JOURNALS}/{journal["id"]}/archive')
        events = self.env['liwan.finance.audit.event'].search([('res_model', '=', 'account.journal'), ('res_id', '=', journal['id'])])
        self.assertEqual(set(events.mapped('action')), {'journal_created', 'journal_changed', 'journal_archived'})
        self.assertEqual(events.filtered(lambda event: event.action == 'journal_changed').fields_written, 'name')

    def test_writes_need_the_manage_capability(self):
        self.user_with('journals_reader', ['finance.journals.read'])
        self.authenticate('journals_reader', PASSWORD)
        self.assertEqual(self.api('GET', JOURNALS).status_code, 200)
        body = {'name': 'x', 'code': 'XX', 'type': 'sale'}
        self.assertRefused(self.api('POST', JOURNALS, json=body), 403, 'forbidden')
        self.assertRefused(self.api('PATCH', f'{JOURNALS}/{self.bank.id}', json={'name': 'x'}), 403, 'forbidden')
        self.assertRefused(self.api('POST', f'{JOURNALS}/{self.bank.id}/archive'), 403, 'forbidden')
        self.user_with('journals_writer', ['finance.journals.manage', 'finance.journals.read'])
        self.authenticate('journals_writer', PASSWORD)
        self.assertEqual(self.api('POST', JOURNALS, json=body).status_code, 201)
