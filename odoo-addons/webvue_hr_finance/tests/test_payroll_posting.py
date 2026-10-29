# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextlib import contextmanager
from datetime import date
from functools import partial
from typing import NamedTuple
from uuid import uuid4

from odoo import SUPERUSER_ID, api
from odoo.exceptions import UserError
from odoo.models import Model
from odoo.service import model as service_model
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

from .common import RUNS, VALID_IBAN, PayrollFinanceCase
from odoo.addons.webvue_finance.controllers import write_support
from odoo.addons.webvue_hr.rules import WebVueHrRule
from odoo.addons.webvue_hr.tests.common import set_hr_feature
from odoo.addons.webvue_hr_finance.models.account_move import AccountMove as PayrollMove

MONTH = '2026-11'
PAYROLL_READ = ('hr.payroll.read', 'hr.employees.read')
POSTING = ('finance.entries.read', 'finance.entries.manage', 'finance.entries.post')
PREVIEW_KEYS = {'entry_detail', 'date', 'journal', 'lines', 'debit', 'credit', 'warnings'}
PREVIEW_LINE_KEYS = {'account', 'analytic_account', 'employee', 'debit', 'credit'}
# The two months the committed concurrency fixtures of ``TestPayrollAccountingRace`` use.
POST_RACE_MONTH = '2027-06'
PAYMENT_RACE_MONTH = '2027-07'
# Every account role the shipped Saudi structure can book, with the chart type it needs.
RACE_ACCOUNTS = {
    'basic_expense': ('expense', False), 'allowance_expense': ('expense', False),
    'variable_expense': ('expense', False), 'gosi_expense': ('expense', False),
    'eos_expense': ('expense', False), 'gosi_payable': ('liability_current', False),
    'eos_provision': ('liability_current', False), 'deduction': ('liability_current', False),
    'salaries_payable': ('liability_payable', True), 'advance': ('asset_receivable', True),
}


class RaceFixture(NamedTuple):
    """The committed rows one race fixture created, so its cleanup can remove exactly them."""

    company_id: int
    run_id: int
    run_name: str
    journal_id: int
    bank_id: int
    department_id: int
    employee_id: int
    structure_id: int
    plan_id: int
    center_id: int
    account_ids: tuple


class RaceRequest:
    """Stands in for ``odoo.http.request`` while the posting helpers run outside a browser request.

    ``require_balanced`` and ``is_period_locked`` read the company from ``request.env``; the falsy
    stand-in also keeps ``odoo.service.model.retrying`` from reaching into a request session, its
    uploaded files or its input stream when it re-runs a request after a serialization failure.
    """

    def __init__(self, env):
        self.env = env

    def __bool__(self):
        return False


@contextmanager
def race_request():
    """Bind a mutable :class:`RaceRequest` where the finance write helpers read the request."""
    original = write_support.request
    stub = RaceRequest(None)
    write_support.request = stub
    try:
        yield stub
    finally:
        write_support.request = original


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollPosting(PayrollFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dept_a = cls.make_department('Posting A')
        cls.dept_b = cls.make_department('Posting B')
        cls.env['webvue.hr.payroll.cost.center'].create({
            'company_id': cls.company.id, 'department_id': cls.dept_a.id, 'analytic_account_id': cls.riyadh.id,
        })
        cls.e1 = cls.make_employee('Posting E1', cls.dept_a)
        cls.e2 = cls.make_employee('Posting E2', cls.dept_b)
        cls.e2.version_id.country_id = cls.env.ref('base.eg')
        cls.env['webvue.hr.compensation'].search([('employee_id', '=', cls.e2.id)]).write({
            'basic_wage': 6000, 'housing_allowance': 1500, 'transport_allowance': 500,
        })
        cls.settings = cls.full_settings()
        cls.settings.default_analytic_account_id = cls.jeddah
        cls.poster = cls.user_with('pp_poster', [*PAYROLL_READ, *POSTING])

    def _post(self, run_id, user=None):
        self.login_as(user or self.poster)
        return self.api('POST', f'{RUNS}/{run_id}/post')

    def _posted(self, month=MONTH, **inputs):
        """Approve a run of ``month`` (with ``inputs`` on E1's payslip) and post it; the posted move."""
        run = self._approved_run_with(month, **inputs)
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        return res.json(), self.env['account.move'].browse(res.json()['finance']['entry_id'])

    def _approved_run_with(self, month, **inputs):
        if not inputs:
            return self._approved_run([self.e1, self.e2], month)
        self.login_as(self.payroll_officer)
        run_id = self.api('POST', RUNS, json={'month': month}).json()['id']
        slip = next(
            row for row in self.api('GET', f'{RUNS}/{run_id}/payslips').json()['items']
            if row['employee']['id'] == self.e1.id
        )
        patched = self.api('PATCH', f"{RUNS}/{run_id}/payslips/{slip['id']}/inputs", json=inputs)
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/compute').status_code, 200)
        self.login_as(self.payroll_approver)
        approved = self.api('POST', f'{RUNS}/{run_id}/approve')
        self.assertEqual(approved.status_code, 200, approved.text)
        return approved.json()

    @staticmethod
    def _amounts(move, account):
        return sorted((line.debit, line.credit) for line in move.line_ids if line.account_id == account)

    def _line(self, move, role, analytic=None, partner=None):
        lines = move.line_ids.filtered(lambda line: line.account_id == self.accounts[role])
        if analytic:
            lines = lines.filtered(lambda line: line.analytic_distribution == {str(analytic.id): 100})
        if partner:
            lines = lines.filtered(lambda line: line.partner_id == partner.work_contact_id)
        self.assertEqual(len(lines), 1, f'{role}: {lines}')
        return lines

    def test_aggregated_entry_is_balanced_with_analytic_split(self):
        run, move = self._posted()
        self.assertEqual(run['state'], 'posted')
        self.assertEqual(move.state, 'posted')
        self.assertEqual(move.date, date(2026, 11, 30))
        self.assertEqual(move.journal_id, self.general_journal)
        self.assertEqual(move.ref, MONTH)
        self.assertEqual(move.webvue_payroll_origin, 'run')
        self.assertEqual(len(move.line_ids), 8)
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh).debit, 10000.00)
        self.assertEqual(self._line(move, 'basic_expense', self.jeddah).debit, 6000.00)
        self.assertEqual(self._line(move, 'allowance_expense', self.riyadh).debit, 3500.00)
        self.assertEqual(self._line(move, 'allowance_expense', self.jeddah).debit, 2000.00)
        self.assertEqual(self._line(move, 'gosi_expense', self.riyadh).debit, 1468.75)
        self.assertEqual(self._line(move, 'gosi_expense', self.jeddah).debit, 150.00)
        self.assertEqual(self._line(move, 'salaries_payable').credit, 20281.25)
        self.assertEqual(self._line(move, 'gosi_payable').credit, 2837.50)
        self.assertEqual(sum(move.line_ids.mapped('debit')), 23118.75)
        self.assertEqual(sum(move.line_ids.mapped('credit')), 23118.75)
        self.assertFalse(move.line_ids.partner_id)
        self.assertEqual(run['finance']['entry_id'], move.id)

    def test_preview_shows_the_entry_and_the_unmapped_department(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.login_as(self.poster)
        res = self.api('GET', f"{RUNS}/{run['id']}/posting-preview")
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), PREVIEW_KEYS)
        self.assertEqual(body['entry_detail'], 'aggregated')
        self.assertEqual(body['date'], '2026-11-30')
        self.assertEqual(body['journal'], {'id': self.general_journal.id, 'name': self.general_journal.name})
        self.assertEqual(len(body['lines']), 8)
        self.assertTrue(all(set(line) == PREVIEW_LINE_KEYS for line in body['lines']))
        self.assertEqual(set(body['lines'][0]['account']), {'id', 'code', 'name'})
        self.assertEqual((body['debit'], body['credit']), (23118.75, 23118.75))
        self.assertEqual(
            body['warnings'],
            [{'code': 'unmapped_department', 'employee': {'id': self.e2.id, 'name': self.e2.name}}],
        )
        self.assertFalse(self.env['account.move'].search_count([('webvue_payroll_origin', '=', 'run')]))

    def test_per_employee_entry_lines(self):
        self.settings.entry_detail = 'per_employee'
        _run, move = self._posted()
        self.assertEqual(len(move.line_ids), 10)
        payable = self.accounts['salaries_payable']
        by_partner = {
            line.partner_id: line.credit for line in move.line_ids if line.account_id == payable
        }
        self.assertEqual(by_partner, {self.e1.work_contact_id: 12281.25, self.e2.work_contact_id: 8000.00})
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh, self.e1).debit, 10000.00)
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh, self.e1).name, self.e1.name)

    def test_setting_change_does_not_rewrite_posted_runs(self):
        _october, october_move = self._posted('2026-10')
        count = len(october_move.line_ids)
        self.settings.entry_detail = 'per_employee'
        _november, november_move = self._posted(MONTH)
        self.assertEqual(len(october_move.line_ids), count)
        self.assertEqual(count, 8)
        self.assertEqual(len(november_move.line_ids), 10)

    def test_advance_recovery_credits_employee_receivable_with_partner(self):
        _run, move = self._posted(advance_recovery_amount=500)
        advance = self._line(move, 'advance')
        self.assertEqual(advance.credit, 500.00)
        self.assertEqual(advance.partner_id, self.e1.work_contact_id)
        self.assertEqual(self._line(move, 'salaries_payable').credit, 19781.25)
        self.assertEqual(sum(move.line_ids.mapped('debit')), sum(move.line_ids.mapped('credit')))

    def test_preview_and_posting_refuse_a_missing_journal(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.settings.journal_id = False
        self.login_as(self.poster)
        preview = self.api('GET', f"{RUNS}/{run['id']}/posting-preview")
        posted = self._post(run['id'])
        for res in (preview, posted):
            self.assertEqual(res.status_code, 422, res.text)
            self.assertEqual(res.json()['code'], 'settings_incomplete')
            self.assertEqual(res.json()['field'], 'journal_id')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'approved')
        self.assertFalse(self.env['account.move'].search_count([('webvue_payroll_origin', '=', 'run')]))

    def test_posting_journal_must_be_in_the_company_currency(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        foreign = self.env['res.currency'].search([('id', '!=', self.company.currency_id.id)], limit=1)
        foreign.active = True
        # The settings refuse a foreign journal, so it only gets there when the journal changes after the save.
        self.settings.journal_id.currency_id = foreign
        self.login_as(self.poster)
        preview = self.api('GET', f"{RUNS}/{run['id']}/posting-preview")
        posted = self._post(run['id'])
        for res in (preview, posted):
            self.assertEqual(res.status_code, 422, res.text)
            self.assertEqual(res.json()['code'], 'invalid')
            self.assertEqual(res.json()['field'], 'journal_id')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'approved')
        self.assertFalse(self.env['account.move'].search_count([('webvue_payroll_origin', '=', 'run')]))

    def test_post_refuses_locked_period(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.company.hard_lock_date = date(2026, 11, 30)
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'period_locked')
        self.assertEqual(res.json()['field'], 'date')
        self.assertFalse(self.env['account.move'].search_count([('webvue_payroll_origin', '=', 'run')]))
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'approved')

    def test_posting_uses_payslip_department_snapshot(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.e1.department_id = self.dept_b
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        move = self.env['account.move'].browse(res.json()['finance']['entry_id'])
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh).debit, 10000.00)

    def test_post_needs_both_capabilities(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        reader = self.user_with('pp_reader', list(PAYROLL_READ))
        accountant = self.user_with('pp_accountant', list(POSTING))
        for user in (reader, accountant, self.payroll_approver):
            res = self._post(run['id'], user)
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(res.json()['code'], 'forbidden')
            self.login_as(user)
            self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}/posting-preview").status_code, 403)
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'posted')

    def test_only_an_approved_run_posts_once(self):
        self.login_as(self.payroll_officer)
        draft_id = self.api('POST', RUNS, json={'month': MONTH}).json()['id']
        res = self._post(draft_id)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'transition_forbidden')
        run, _move = self._posted('2026-10')
        again = self._post(run['id'])
        self.assertEqual(again.status_code, 403, again.text)

    def test_posted_run_is_listed_and_offers_only_the_provision_action(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.login_as(self.poster)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['post'])
        self.assertEqual(self._post(run['id']).status_code, 200)
        self.assertEqual(self.api('GET', f'{RUNS}?state=posted').json()['total'], 1)
        self.assertEqual(self.api('GET', f'{RUNS}?state=approved').json()['total'], 0)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['eos_provision'])

    def test_no_finance_action_is_offered_while_finance_is_off(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.login_as(self.poster)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['post'])
        set_hr_feature(self, 'finance.enabled', False)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], [])

    def test_entry_name_needs_entries_read(self):
        run, move = self._posted()
        self.assertEqual(run['finance'], {
            'entry_id': move.id, 'entry_name': move.name, 'payment_id': None, 'payment_name': None,
        })
        self.login_as(self.user_with('pp_reader_only', list(PAYROLL_READ)))
        finance = self.api('GET', f"{RUNS}/{run['id']}").json()['finance']
        self.assertEqual(finance['entry_id'], move.id)
        self.assertIsNone(finance['entry_name'])

    def test_payroll_move_cannot_be_reset_or_deleted(self):
        _run, move = self._posted()
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        res = self.api('POST', f'/api/v1/finance/entries/{move.id}/reset-to-draft')
        self.assertEqual(res.status_code, 422, res.text)
        with self.assertRaises(UserError):
            move.button_cancel()
        with self.assertRaises(UserError):
            move.unlink()
        self.assertEqual(move.state, 'posted')

    def test_missing_cost_center_without_default(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.settings.default_analytic_account_id = False
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'missing_cost_center')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'approved')


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollAccountingRace(TransactionCase):
    """The posting and the payment of one run under two real, independent transactions.

    The HTTP test classes run in Odoo's registry test mode, where ``registry.cursor()`` hands back a
    ``TestCursor`` over the test transaction itself (``odoo/tests/test_cursor.py``), so no statement
    of a second transaction can ever conflict. These tests therefore leave that mode, commit their
    own payroll fixture, and let two real REPEATABLE READ transactions run the accounting steps of
    one run: the first commits, and the second must fail on the row the first wrote -- the
    serialization failure ``odoo.service.model.retrying`` re-runs a request on -- and be refused on
    the re-run by the same "only an approved/posted run" guard the routes answer. The payment is the
    second accounting step of the same run, so both tests share this committed fixture.
    """

    def _fixture(self, month, posted=False):
        """Commit an approved (or already posted) run of the main company with its own ledger."""
        self.assertTrue(
            self.env.cr.dbname.startswith('webvue_scratch_'),
            'committed concurrency fixtures require a scratch database',
        )
        company_id = self.env.ref('base.main_company').id
        tag = uuid4().hex[:8]
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {'allowed_company_ids': [company_id]})
            company = env['res.company'].browse(company_id)
            code_base = 900000 + (int(tag[:4], 16) % 90) * 100
            accounts = [
                env['account.account'].create({
                    'code': str(code_base + offset), 'name': f'Payroll race {tag} {role}',
                    'account_type': account_type, 'reconcile': reconcile,
                    'company_ids': [(6, 0, company.ids)],
                })
                for offset, (role, (account_type, reconcile)) in enumerate(RACE_ACCOUNTS.items(), start=1)
            ]
            journal = env['account.journal'].create({
                'name': f'Payroll race {tag}', 'code': 'R' + tag[:4].upper(), 'type': 'general',
                'company_id': company.id,
            })
            bank = env['account.journal'].create({
                'name': f'Payroll bank {tag}', 'code': 'B' + tag[:4].upper(), 'type': 'bank',
                'company_id': company.id,
            })
            plan = env['account.analytic.plan'].create({'name': f'Payroll race {tag}'})
            center = env['account.analytic.account'].create({
                'name': f'Payroll race {tag}', 'plan_id': plan.id, 'company_id': company.id,
            })
            env['webvue.hr.payroll.finance.settings'].create({
                'company_id': company.id, 'journal_id': journal.id,
                'default_analytic_account_id': center.id,
                **{f'{role}_account_id': account.id for role, account in zip(RACE_ACCOUNTS, accounts)},
            })
            structure = env.ref('webvue_hr.structure_saudi').copy({'company_id': company.id})
            env['webvue.hr.payroll.settings']._webvue_save(company, {'structure_id': structure.id})
            department = env['hr.department'].create({
                'name': f'Payroll race {tag}', 'company_id': company.id,
            })
            env['webvue.hr.payroll.cost.center'].create({
                'company_id': company.id, 'department_id': department.id, 'analytic_account_id': center.id,
            })
            employee = env['hr.employee'].create({
                'name': f'Payroll race {tag}', 'company_id': company.id, 'department_id': department.id,
            })
            employee.version_id.write({
                'contract_date_start': date(2026, 1, 1), 'country_id': env.ref('base.sa').id,
            })
            env['webvue.hr.compensation'].create({
                'employee_id': employee.id, 'basic_wage': 10000, 'housing_allowance': 2500,
                'transport_allowance': 1000, 'iban': VALID_IBAN, 'gosi_registration_date': date(2020, 1, 1),
            })
            run = env['hr.payslip.run']._webvue_create_month(date.fromisoformat(f'{month}-01'))
            run._webvue_compute()
            run._webvue_approve()
            if posted:
                with race_request() as request_stub:
                    request_stub.env = env
                    env['webvue.hr.payroll.posting']._webvue_post(run)
            fixture = RaceFixture(
                company.id, run.id, run.name, journal.id, bank.id, department.id, employee.id,
                structure.id, plan.id, center.id, tuple(account.id for account in accounts),
            )
            self.assertEqual(env['hr.payslip.run'].browse(run.id).webvue_state, 'posted' if posted else 'approved')
            cursor.commit()
        return fixture

    def _cleanup(self, fixture):
        """Remove the committed fixture: the payroll records, then the ledger it was booked in."""
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {'allowed_company_ids': [fixture.company_id]})
            run = env['hr.payslip.run'].browse(fixture.run_id).exists()
            if run:
                run.write({'webvue_move_id': False, 'webvue_payment_id': False})
            payments = env['account.payment'].search([
                ('company_id', '=', fixture.company_id), ('memo', '=', fixture.run_name),
            ])
            # ``account.payment.unlink`` drafts its entry, which a payroll entry refuses; the row goes
            # first and the orphan entry is removed with the moves below.
            Model.unlink(payments)
            moves = env['account.move'].search([
                ('company_id', '=', fixture.company_id),
                ('webvue_payroll_origin', 'in', ('run', 'payment')),
            ])
            if moves:
                Model.unlink(env['account.partial.reconcile'].search([
                    '|', ('debit_move_id.move_id', 'in', moves.ids), ('credit_move_id.move_id', 'in', moves.ids),
                ]))
                super(PayrollMove, moves.with_context(force_delete=True)).unlink()
            if run:
                run.slip_ids.write({'state': 'draft'})
                Model.unlink(run.slip_ids)
                Model.unlink(run)
            employee = env['hr.employee'].browse(fixture.employee_id).exists()
            if employee:
                Model.unlink(env['webvue.hr.compensation'].search([('employee_id', 'in', employee.ids)]))
                Model.unlink(employee)
            env['webvue.hr.payroll.finance.settings'].search([
                ('company_id', '=', fixture.company_id), ('journal_id', '=', fixture.journal_id),
            ]).unlink()
            settings = env['webvue.hr.payroll.settings'].search([
                ('company_id', '=', fixture.company_id), ('structure_id', '=', fixture.structure_id),
            ])
            settings.unlink()
            structure = env['hr.payroll.structure'].browse(fixture.structure_id).exists()
            if structure:
                structure.unlink()
            env['webvue.hr.payroll.cost.center'].search([
                ('company_id', '=', fixture.company_id), ('department_id', '=', fixture.department_id),
            ]).unlink()
            env['hr.department'].browse(fixture.department_id).exists().unlink()
            env['account.journal'].browse([fixture.journal_id, fixture.bank_id]).exists().unlink()
            env['account.account'].browse(fixture.account_ids).exists().unlink()
            env['account.analytic.account'].browse(fixture.center_id).exists().unlink()
            plan = env['account.analytic.plan'].browse(fixture.plan_id).exists()
            if plan and not plan.account_ids:
                plan.unlink()
            cursor.commit()

    def _reading(self, fixture):
        """A committed reader of the run and of the entries and payments booked for it."""
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {'allowed_company_ids': [fixture.company_id]})
            return (
                env['hr.payslip.run'].browse(fixture.run_id).webvue_state,
                env['account.move'].search_count([
                    ('company_id', '=', fixture.company_id), ('webvue_payroll_origin', '=', 'run'),
                    ('ref', '=', fixture.run_name),
                ]),
                env['account.payment'].search_count([
                    ('company_id', '=', fixture.company_id), ('memo', '=', fixture.run_name),
                ]),
            )

    def test_concurrent_posting_books_one_entry(self):
        fixture = self._fixture(POST_RACE_MONTH)
        try:
            with race_request() as request_stub:
                with self.registry.cursor() as loser:
                    loser_env = api.Environment(loser, SUPERUSER_ID, {'allowed_company_ids': [fixture.company_id]})
                    request_stub.env = loser_env
                    loser_run = loser_env['hr.payslip.run'].browse(fixture.run_id)
                    self.assertEqual(loser_run.webvue_state, 'approved')  # the loser's own snapshot
                    with self.registry.cursor() as winner:
                        winner_env = api.Environment(
                            winner, SUPERUSER_ID, {'allowed_company_ids': [fixture.company_id]},
                        )
                        request_stub.env = winner_env
                        move = winner_env['webvue.hr.payroll.posting']._webvue_post(
                            winner_env['hr.payslip.run'].browse(fixture.run_id),
                        )
                        winner.commit()
                        self.assertEqual(move.state, 'posted')
                    request_stub.env = loser_env
                    with mute_logger('odoo.sql_db'), self.assertLogs('odoo.service.model', level='INFO') as logs:
                        with self.assertRaises(WebVueHrRule) as refusal:
                            service_model.retrying(
                                partial(loser_env['webvue.hr.payroll.posting']._webvue_post, loser_run),
                                env=loser_env,
                            )
                    self.assertEqual(refusal.exception.status, 403)
                    self.assertEqual(refusal.exception.code, 'transition_forbidden')
                    self.assertTrue(
                        any('SERIALIZATION_FAILURE' in line for line in logs.output), logs.output,
                    )
            self.assertEqual(self._reading(fixture), ('posted', 1, 0))
        finally:
            self._cleanup(fixture)

    def test_concurrent_payment_books_one_payment(self):
        fixture = self._fixture(PAYMENT_RACE_MONTH, posted=True)
        try:
            with race_request() as request_stub:
                with self.registry.cursor() as loser:
                    loser_env = api.Environment(loser, SUPERUSER_ID, {'allowed_company_ids': [fixture.company_id]})
                    request_stub.env = loser_env
                    loser_run = loser_env['hr.payslip.run'].browse(fixture.run_id)
                    self.assertEqual(loser_run.webvue_state, 'posted')  # the loser's own snapshot
                    with self.registry.cursor() as winner:
                        winner_env = api.Environment(
                            winner, SUPERUSER_ID, {'allowed_company_ids': [fixture.company_id]},
                        )
                        request_stub.env = winner_env
                        payment = winner_env['webvue.hr.payroll.posting']._webvue_record_payment(
                            winner_env['hr.payslip.run'].browse(fixture.run_id),
                            winner_env['account.journal'].browse(fixture.bank_id), date(2027, 8, 1),
                        )
                        winner.commit()
                        self.assertEqual(payment.state, 'in_process')
                    request_stub.env = loser_env
                    with mute_logger('odoo.sql_db'), self.assertLogs('odoo.service.model', level='INFO') as logs:
                        with self.assertRaises(WebVueHrRule) as refusal:
                            service_model.retrying(
                                partial(
                                    loser_env['webvue.hr.payroll.posting']._webvue_record_payment,
                                    loser_run, loser_env['account.journal'].browse(fixture.bank_id), date(2027, 8, 1),
                                ),
                                env=loser_env,
                            )
                    self.assertEqual(refusal.exception.status, 403)
                    self.assertEqual(refusal.exception.code, 'transition_forbidden')
                    self.assertTrue(
                        any('SERIALIZATION_FAILURE' in line for line in logs.output), logs.output,
                    )
            self.assertEqual(self._reading(fixture), ('paid', 1, 1))
        finally:
            self._cleanup(fixture)
