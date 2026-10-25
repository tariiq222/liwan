# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Successful mutation routes covered: invoice and manual-entry create, patch, delete,
post, reset; invoice cancel; manual-entry unreconcile. Reads, payment mutations,
non-manual/generated moves, previews and rejected/failed operations are excluded.
"""
from odoo import Command
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD
from .write_common import INVOICES, PASSWORD, WebVueFinanceWriteCase

ENTRIES = '/api/v1/finance/entries'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceMutationAudit(WebVueFinanceWriteCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.general = cls.env['account.journal'].search([
            ('company_id', '=', cls.company.id), ('type', '=', 'general'),
        ], limit=1)
        cls.expense = cls.env['account.account'].search([
            ('company_ids', 'in', cls.company.id), ('account_type', '=', 'expense'),
        ], limit=1)
        cls.income = cls.env['account.account'].search([
            ('company_ids', 'in', cls.company.id), ('account_type', '=', 'income'),
        ], limit=1)
        cls.receivable = cls.env['account.account'].search([
            ('company_ids', 'in', cls.company.id), ('account_type', '=', 'asset_receivable'),
        ], limit=1)

    def _audit_events(self):
        return self.env['webvue.finance.audit.event'].search([('company_id', '=', self.company.id)])

    def _assert_single_event(self, before, action, record, fields, outcome):
        events = self._audit_events()
        self.assertEqual(len(events) - before, 1, events.mapped('action'))
        event = events[0]
        self.assertEqual(
            (event.action, event.create_uid, event.company_id, event.res_model, event.res_id,
             event.fields_written, event.outcome),
            (action, self.manager, self.company, 'account.move', record.id,
             ', '.join(sorted(fields)) or False, outcome),
        )
        self.assertNotIn('amount', event.outcome or '')

    def _invoice_route(self, invoice_id, suffix=''):
        return f'{INVOICES}/{invoice_id}{suffix}'

    def _entry_body(self):
        return {
            'journal_id': self.general.id, 'date': '2026-10-18', 'ref': 'AUDIT-ENTRY',
            'lines': [
                {'account_id': self.expense.id, 'name': 'Audit debit', 'debit': 50},
                {'account_id': self.income.id, 'name': 'Audit credit', 'credit': 50},
            ],
        }

    def test_invoice_mutations_emit_exactly_one_safe_company_scoped_event(self):
        before = len(self._audit_events())
        result = self.api('POST', INVOICES, json=self.invoice_body(ref='AUDIT-INVOICE'))
        self.assertEqual(result.status_code, 201, result.text)
        invoice_id = result.json()['id']
        invoice = self.env['account.move'].browse(invoice_id)
        self._assert_single_event(before, 'invoice_created', invoice,
                                  ('move_type', 'partner_id', 'invoice_date', 'invoice_line_ids', 'ref', 'company_id'), 'draft')

        before = len(self._audit_events())
        result = self.api('PATCH', self._invoice_route(invoice_id), json={'ref': 'CHANGED'})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'invoice_changed', invoice, ('ref',), 'draft')

        before = len(self._audit_events())
        result = self.api('POST', self._invoice_route(invoice_id, '/post'), json={})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'invoice_posted', invoice, ('state',), 'posted')

        before = len(self._audit_events())
        result = self.api('POST', self._invoice_route(invoice_id, '/cancel'), json={})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'invoice_cancelled', invoice, ('state',), 'cancel')

        before = len(self._audit_events())
        result = self.api('POST', self._invoice_route(invoice_id, '/reset-to-draft'), json={})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'invoice_reset_to_draft', invoice, ('state',), 'draft')

        before = len(self._audit_events())
        result = self.api('DELETE', self._invoice_route(invoice_id))
        self.assertEqual(result.status_code, 204, result.text)
        self.assertFalse(invoice.exists())
        self._assert_single_event(before, 'invoice_deleted', invoice, ('unlink',), 'deleted')

    def test_entry_mutations_emit_exactly_one_event_and_preserve_deleted_reference(self):
        before = len(self._audit_events())
        result = self.api('POST', ENTRIES, json=self._entry_body())
        self.assertEqual(result.status_code, 201, result.text)
        entry_id = result.json()['id']
        entry = self.env['account.move'].browse(entry_id)
        self._assert_single_event(before, 'entry_created', entry,
                                  ('date', 'journal_id', 'ref', 'line_ids', 'move_type', 'company_id'), 'draft')

        before = len(self._audit_events())
        result = self.api('PATCH', f'{ENTRIES}/{entry_id}', json={'ref': 'ENTRY-CHANGED'})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'entry_changed', entry, ('ref',), 'draft')

        before = len(self._audit_events())
        result = self.api('POST', f'{ENTRIES}/{entry_id}/post', json={})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'entry_posted', entry, ('state',), 'posted')

        before = len(self._audit_events())
        result = self.api('POST', f'{ENTRIES}/{entry_id}/reset-to-draft', json={})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'entry_reset_to_draft', entry, ('state',), 'draft')

        before = len(self._audit_events())
        result = self.api('DELETE', f'{ENTRIES}/{entry_id}')
        self.assertEqual(result.status_code, 204, result.text)
        self.assertFalse(entry.exists())
        self._assert_single_event(before, 'entry_deleted', entry, ('unlink',), 'deleted')

    def test_debit_note_audits_success_and_failed_or_denied_attempts_do_not_mutate(self):
        original = self._draft_sale_invoice(self.company, self.partner)
        original.invoice_line_ids.write({'name': 'Debit-note source', 'price_unit': 100})
        original.action_post()
        before_moves = self.env['account.move'].search_count([('company_id', '=', self.company.id)])
        before_events = len(self._audit_events())

        success = self.api('POST', self._invoice_route(original.id, '/debit-note'),
                           json={'reason': 'Audit test', 'copy_lines': True})
        self.assertEqual(success.status_code, 201, success.text)
        debit_id = success.json()['id']
        debit = self.env['account.move'].browse(debit_id)
        self.assertEqual((debit.debit_origin_id, debit.company_id, debit.state), (original, self.company, 'draft'))
        self._assert_single_event(before_events, 'invoice_debit_note_created', debit,
                                  ('move_type', 'debit_origin_id', 'date', 'ref', 'invoice_line_ids'), 'draft')

        before_events = len(self._audit_events())
        empty = self.api('POST', self._invoice_route(original.id, '/debit-note'), json={})
        self.assertEqual(empty.status_code, 201, empty.text)
        empty_debit = self.env['account.move'].browse(empty.json()['id'])
        self.assertFalse(empty_debit.invoice_line_ids)
        self._assert_single_event(before_events, 'invoice_debit_note_created', empty_debit,
                                  ('move_type', 'debit_origin_id', 'date', 'ref'), 'draft')

        before_moves = self.env['account.move'].search_count([('company_id', '=', self.company.id)])
        before_events = len(self._audit_events())
        failed = self.api('POST', self._invoice_route(debit.id, '/debit-note'), json={})
        self.assertEqual(failed.status_code, 422, failed.text)
        self.assertEqual(self.env['account.move'].search_count([('company_id', '=', self.company.id)]), before_moves)
        self.assertEqual(len(self._audit_events()), before_events)

        self.authenticate('finance_outsider', 'finance_outsider_pass_123')
        denied = self.api('POST', self._invoice_route(original.id, '/debit-note'), json={})
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self.env['account.move'].search_count([('company_id', '=', self.company.id)]), before_moves)
        self.assertEqual(len(self._audit_events()), before_events)

    def test_branch_invoice_patch_audits_in_record_company(self):
        branch = self.env['res.company'].create({'name': 'Audit Event Branch', 'parent_id': self.company.id})
        self.manager.company_ids = [Command.set((self.company | branch).ids)]
        branch_accounts = self.env['account.account'].with_company(branch).create([
            {
                'name': 'Audit branch income', 'code': 'ABIN', 'account_type': 'income',
                'company_ids': [Command.set(branch.ids)],
            },
            {
                'name': 'Audit branch receivable', 'code': 'ABAR', 'account_type': 'asset_receivable',
                'reconcile': True, 'company_ids': [Command.set(branch.ids)],
            },
            {
                'name': 'Audit branch payable', 'code': 'ABAP', 'account_type': 'liability_payable',
                'reconcile': True, 'company_ids': [Command.set(branch.ids)],
            },
        ])
        branch_income = branch_accounts.filtered(lambda account: account.account_type == 'income')
        branch_journal = self.env['account.journal'].with_company(branch).create({
            'name': 'Audit branch sales', 'code': 'ABSL', 'type': 'sale', 'company_id': branch.id,
            'default_account_id': branch_income.id,
        })
        branch_partner = self.env['res.partner'].with_company(branch).create({
            'name': 'Audit Branch Customer',
            'company_id': branch.id,
        })
        branch_partner.with_company(branch).write({
            'property_account_receivable_id': branch_accounts.filtered(
                lambda account: account.account_type == 'asset_receivable',
            ).id,
            'property_account_payable_id': branch_accounts.filtered(
                lambda account: account.account_type == 'liability_payable',
            ).id,
        })
        branch_invoice = self.env['account.move'].with_company(branch).create({
            'move_type': 'out_invoice', 'partner_id': branch_partner.id, 'journal_id': branch_journal.id,
            'invoice_date': '2026-10-18', 'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [Command.create({
                'name': 'Branch audit consulting', 'quantity': 1, 'price_unit': 1000,
                'account_id': branch_income.id,
            })],
        })
        self.manager.company_ids = [Command.set((self.company | branch).ids)]
        self.env['webvue.access.assignment']._webvue_access_create({
            'user_id': self.manager.id, 'role_id': self.env.ref('webvue_finance.role_finance_manager').id,
            'company_id': branch.id,
        })
        parent_assignment = self.env['webvue.access.assignment'].search([
            ('user_id', '=', self.manager.id), ('company_id', '=', self.company.id),
        ])
        parent_assignment._webvue_access_unlink()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)
        self.assertTrue(self.env['webvue.access.service'].with_company(branch)._webvue_has_capability(
            self.manager, 'finance.invoices.manage', company=branch,
        ))
        self.assertTrue(self.manager.with_company(branch).has_group(
            'webvue_finance.group_cap_finance_journals_read',
        ))
        audit_domain = [
            ('res_model', '=', 'account.move'), ('res_id', '=', branch_invoice.id),
            ('action', '=', 'invoice_changed'),
        ]
        audit_events = self.env['webvue.finance.audit.event']
        before = audit_events.search_count(audit_domain)
        result = self.api('PATCH', self._invoice_route(branch_invoice.id), json={'ref': 'BRANCH-CHANGED'})
        self.assertEqual(result.status_code, 200, result.text)
        events = audit_events.search(audit_domain)
        self.assertEqual(len(events), before + 1)
        event = events[0]
        self.assertEqual(event.company_id, branch)
        self.assertEqual((event.res_model, event.res_id), ('account.move', branch_invoice.id))
        self.assertEqual(event.fields_written, 'ref')
        self.assertNotRegex(event.fields_written, r'\d')
        self.assertTrue(self.env['webvue.access.service'].with_company(branch)._webvue_has_capability(
            self.manager, 'finance.invoices.manage', company=branch,
        ))

    def test_minimal_invoice_and_entry_managers_can_audit_without_audit_read_write_unlink(self):
        for login, capability, path, body, action, model in (
            ('audit_invoice_minimal', 'finance.invoices.manage', INVOICES, self.invoice_body(ref='MIN-INV'),
             'invoice_created', 'account.move'),
            ('audit_entry_minimal', 'finance.entries.manage', ENTRIES, self._entry_body(),
             'entry_created', 'account.move'),
        ):
            permissions = [capability]
            if capability == 'finance.invoices.manage':
                permissions.append('finance.invoices.read')
            else:
                # Entry read is an explicit prerequisite of entries.manage, not an audit ACL grant.
                permissions.append('finance.entries.read')
            user = self.user_with(login, permissions)
            self.authenticate(login, PASSWORD)
            response = self.api('POST', path, json=body)
            self.assertEqual(response.status_code, 201, response.text)
            rec_id = response.json()['id']
            event = self.env['webvue.finance.audit.event'].search([
                ('create_uid', '=', user.id), ('action', '=', action), ('res_model', '=', model),
                ('res_id', '=', rec_id), ('company_id', '=', self.company.id),
            ], limit=1)
            self.assertTrue(event, f'{login} did not create the audit event')
            self.assertFalse(user.has_group('webvue_finance.group_cap_finance_audit_read'))
            access = self.env['ir.model.access'].with_user(user)
            for operation in ('read', 'write', 'unlink'):
                self.assertFalse(access.check('webvue.finance.audit.event', operation, raise_exception=False))

    def test_unreconcile_audits_once_and_failed_or_denied_mutations_do_not(self):
        def make_entry(counterpart, debit, credit):
            return self.env['account.move'].with_company(self.company).create({
                'move_type': 'entry', 'journal_id': self.general.id, 'date': '2026-10-18',
                'line_ids': [
                    Command.create({'account_id': self.receivable.id, 'partner_id': self.partner.id,
                                    'name': 'Receivable', 'debit': 100 if debit else 0,
                                    'credit': 100 if credit else 0}),
                    Command.create({'account_id': counterpart.id, 'name': 'Offset',
                                    'debit': 100 if credit else 0, 'credit': 100 if debit else 0}),
                ],
            })

        first = make_entry(self.income, True, False)
        second = make_entry(self.expense, False, True)
        (first | second).action_post()
        receivable_lines = (first | second).line_ids.filtered(lambda line: line.account_id == self.receivable)
        receivable_lines.reconcile()
        lines = first.line_ids.filtered(lambda line: line.account_id == self.receivable)
        before = len(self._audit_events())
        result = self.api('POST', f'{ENTRIES}/{first.id}/unreconcile', json={})
        self.assertEqual(result.status_code, 200, result.text)
        self._assert_single_event(before, 'entry_unreconciled', first, ('reconciled',), 'posted')

        before = len(self._audit_events())
        failed = self.api('PATCH', f'{ENTRIES}/{first.id}', json={'ref': 'late'})
        self.assertEqual(failed.status_code, 422, failed.text)
        self.assertEqual(len(self._audit_events()), before)
        self.assertFalse(lines.reconciled)

        self.authenticate('finance_outsider', 'finance_outsider_pass_123')
        denied = self.api('POST', ENTRIES, json=self._entry_body())
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(len(self.env['webvue.finance.audit.event'].search([])), before)
