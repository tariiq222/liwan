# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict
from datetime import date, timedelta

from odoo import api, models

# The aged balance buckets: not yet due, then the days overdue each one reaches, then the rest.
AGED_BUCKET_NAMES = ('current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_91_120', 'days_over_120')
AGED_BUCKET_DAYS = (30, 60, 90, 120)
NOTE_DISPLAY_TYPES = ('line_section', 'line_subsection', 'line_note')
# an item without an entry name sorts first among the items of its day, so the "before" domain below can say so
LEDGER_ORDER = 'date, move_name NULLS FIRST, id'


def _blank_ledger_figures():
    return {'initial_balance': 0.0, 'debit': 0.0, 'credit': 0.0, 'balance': 0.0, 'count': 0}


class WebVueFinanceStatementReport(models.AbstractModel):
    """The statement figures for the API: the trial balance and partner statements run the OCA engines, the
    general ledger and the aged partner balance are grouped sums in SQL (the OCA engines build every move
    line in Python and stay the parity reference of the tests).

    Each OCA report is a transient wizard (its filters) plus a report model whose
    ``_get_report_values(docids, data)`` computes the figures the HTML/PDF/XLSX renderers show. The
    wizard here is only a virtual record (``new``), so a read route writes nothing, and the dates of the
    report data are ISO strings exactly as they reach the report after the client's JSON round trip.
    Everything runs in the caller's environment: no ``sudo()``.
    """
    _name = 'webvue.finance.statement.report'
    _description = 'WebVue finance statements over the OCA reports'

    @api.model
    def _webvue_report_values(self, wizard, report_model, prepare='_prepare_report_data'):
        data = {
            key: value.isoformat() if isinstance(value, date) else value
            for key, value in getattr(wizard, prepare)().items()
        }
        return self.env[report_model]._get_report_values(wizard.ids, data)

    @api.model
    def _webvue_trial_balance(self, company, date_from, date_to, only_posted):
        wizard = self.env['trial.balance.report.wizard'].new({
            'company_id': company.id, 'date_from': date_from, 'date_to': date_to,
            'target_move': 'posted' if only_posted else 'all',
        })
        return self._webvue_report_values(wizard, 'report.account_financial_report.trial_balance')

    @api.model
    def _webvue_general_ledger(self, company, date_from, date_to, only_posted, account=None, partner=None,
                               limit=0, offset=0):
        """The ledger from grouped sums and one SQL page of lines; the OCA engine is not run.

        Per account: the opening balance (balance sheet accounts: every earlier item; profit and loss
        accounts: those of the fiscal year; the earlier fiscal years of the latter sit on the unaffected
        earnings account, which is listed when no account is named), the period debit and credit, the item
        count and, for the one named ``account`` only, the ``limit`` items from ``offset`` in date order
        with their running balance. Returns rows sorted by account code.
        """
        lines = self.env['account.move.line']
        base = self._webvue_ledger_domain(company, only_posted, partner)
        fiscal_start = company.compute_fiscalyear_dates(date_from)['date_from']
        account_domain = [('account_id', '=', account.id)] if account else []
        opening = lines._read_group(
            base + account_domain + [
                '|', '&', ('date', '<', date_from), ('account_id.include_initial_balance', '=', True),
                '&', '&', ('date', '<', date_from), ('date', '>=', fiscal_start),
                ('account_id.include_initial_balance', '=', False),
            ],
            groupby=['account_id'], aggregates=['balance:sum'],
        )
        period = lines._read_group(
            base + account_domain + [('date', '>=', date_from), ('date', '<=', date_to)],
            groupby=['account_id'], aggregates=['debit:sum', 'credit:sum', 'balance:sum', '__count'],
        )
        figures = defaultdict(_blank_ledger_figures)
        for found, balance in opening:
            figures[found]['initial_balance'] = balance
        for found, debit, credit, balance, count in period:
            figures[found].update(debit=debit, credit=credit, balance=balance, count=count)
        if not account or account.account_type == 'equity_unaffected':
            self._webvue_add_earlier_earnings(company, base, fiscal_start, figures, account)
        rows = [
            {
                'account': found, 'initial_balance': row['initial_balance'], 'debit': row['debit'],
                'credit': row['credit'], 'ending_balance': row['initial_balance'] + row['balance'],
                'total': row['count'], 'lines': [],
            }
            for found, row in figures.items()
        ]
        if account and rows:
            rows[0]['lines'] = self._webvue_ledger_page(
                base + [('account_id', '=', account.id)], date_from, date_to, rows[0]['initial_balance'], limit, offset,
            )
        return sorted(rows, key=lambda row: row['account'].code)

    @api.model
    def _webvue_ledger_domain(self, company, only_posted, partner):
        domain = [
            ('company_id', '=', company.id),
            ('parent_state', 'in', ['posted'] if only_posted else ['posted', 'draft']),
            ('display_type', 'not in', NOTE_DISPLAY_TYPES),
        ]
        return domain + [('partner_id', 'in', partner.ids)] if partner else domain

    @api.model
    def _webvue_add_earlier_earnings(self, company, base, fiscal_start, figures, account):
        """The profit and loss of the fiscal years before ``fiscal_start`` becomes the opening balance of the
        company's unaffected earnings account, which is listed even when it has no item of its own. Asking for
        that account alone gives the same row as the full ledger (the OCA engine leaves the add-back out then)."""
        earnings = account or self.env['account.account'].search([
            ('company_ids', 'in', company.ids), ('account_type', '=', 'equity_unaffected'),
        ], limit=1)
        if not earnings:
            return
        earlier = self.env['account.move.line']._read_group(
            base + [('date', '<', fiscal_start), ('account_id.include_initial_balance', '=', False)],
            aggregates=['balance:sum'],
        )
        figures[earnings]['initial_balance'] += earlier[0][0]

    @api.model
    def _webvue_ledger_page(self, domain, date_from, date_to, initial_balance, limit, offset):
        """``[{'line': record, 'balance': running balance after it}]`` for one page of an account's period."""
        domain = domain + [('date', '>=', date_from), ('date', '<=', date_to)]
        page = self.env['account.move.line'].search(domain, order=LEDGER_ORDER, limit=limit, offset=offset)
        if not page:
            return []
        balance = initial_balance
        if offset:
            # the sum of every item that sorts before the first of the page, in one grouped read
            before = self.env['account.move.line']._read_group(
                domain + self._webvue_before_domain(page[0]), aggregates=['balance:sum'],
            )
            balance += before[0][0]
        entries = []
        for line in page:
            balance += line.balance
            entries.append({'line': line, 'balance': balance})
        return entries

    @api.model
    def _webvue_before_domain(self, first):
        """The items that sort before ``first`` in ``LEDGER_ORDER`` (day, entry name with the nameless first, id)."""
        if first.move_name:
            same_day = ['|', ('move_name', '=', False), '|', ('move_name', '<', first.move_name),
                        '&', ('move_name', '=', first.move_name), ('id', '<', first.id)]
        else:
            same_day = ['&', ('move_name', '=', False), ('id', '<', first.id)]
        return ['|', ('date', '<', first.date), '&', ('date', '=', first.date), *same_day]

    @api.model
    def _webvue_aged_partner_balance(self, company, date_at, only_posted, account_type, partner=None):
        """Open balances at ``date_at`` aged from their due date: ``[(account, partner, buckets)]``.

        ``account_type`` is ``asset_receivable`` or ``liability_payable``; ``partner`` is an empty record
        for an item without one; ``buckets`` maps each name of ``AGED_BUCKET_NAMES`` to its sum. Items are
        grouped in SQL, one read per bucket on ``amount_residual``. A reconciliation made after
        ``date_at`` still counts the amount as open, so the few items it touched are aged one by one.
        """
        accounts = self.env['account.account'].search([
            ('account_type', '=', account_type), ('company_ids', 'in', company.ids),
        ])
        base = self._webvue_ledger_domain(company, only_posted, partner) + [
            ('account_id', 'in', accounts.ids), ('date', '<=', date_at),
        ]
        lines = self.env['account.move.line']
        figures = defaultdict(lambda: dict.fromkeys(AGED_BUCKET_NAMES, 0.0))
        # items a reconciliation dated after ``date_at`` touched are aged below with their amount added back
        untouched = [('matched_debit_ids', 'not any', [('max_date', '>', date_at)]),
                     ('matched_credit_ids', 'not any', [('max_date', '>', date_at)])]
        for name, due in self._webvue_bucket_domains(date_at):
            groups = lines._read_group(
                base + untouched + [('amount_residual', '!=', 0)] + due,
                groupby=['account_id', 'partner_id'], aggregates=['amount_residual:sum'],
            )
            for found, found_partner, residual in groups:
                figures[found, found_partner][name] += residual
        later = self._webvue_later_reconciled(date_at, base)
        for line in lines.search_fetch(
            base + ['|', ('matched_debit_ids', 'any', [('max_date', '>', date_at)]),
                    ('matched_credit_ids', 'any', [('max_date', '>', date_at)])],
            ['amount_residual', 'date_maturity'],
        ):
            residual = line.amount_residual + later.get(line.id, 0.0)
            if not company.currency_id.is_zero(residual):
                figures[line.account_id, line.partner_id][self._webvue_bucket(line.date_maturity, date_at)] += residual
        return [(found, found_partner, buckets) for (found, found_partner), buckets in figures.items()]

    @api.model
    def _webvue_later_reconciled(self, date_at, items):
        """``{item id: amount to add back}``: what reconciliations dated after ``date_at`` took off the items
        of the domain ``items``; the partial reconciles are selected in SQL by the items they touch."""
        partials = self.env['account.partial.reconcile']
        added = {}
        for side, sign in (('debit_move_id', 1), ('credit_move_id', -1)):
            domain = [('max_date', '>', date_at), (side, 'any', items)]
            for line, amount in partials._read_group(domain, [side], ['amount:sum']):
                added[line.id] = added.get(line.id, 0.0) + sign * amount
        return added

    @api.model
    def _webvue_bucket_domains(self, date_at):
        """``[(bucket name, due date domain)]``: not yet due, then the days overdue at ``date_at``."""
        domains = [(AGED_BUCKET_NAMES[0], ['|', ('date_maturity', '=', False), ('date_maturity', '>=', date_at)])]
        newer = 0
        for name, days in zip(AGED_BUCKET_NAMES[1:], AGED_BUCKET_DAYS):
            domains.append((name, [
                ('date_maturity', '<', date_at - timedelta(days=newer)),
                ('date_maturity', '>=', date_at - timedelta(days=days)),
            ]))
            newer = days
        domains.append((AGED_BUCKET_NAMES[-1], [('date_maturity', '<', date_at - timedelta(days=newer))]))
        return domains

    @api.model
    def _webvue_bucket(self, due, date_at):
        overdue = (date_at - due).days if due else 0
        for name, days in zip(AGED_BUCKET_NAMES[:-1], (0, *AGED_BUCKET_DAYS)):
            if overdue <= days:
                return name
        return AGED_BUCKET_NAMES[-1]

    @api.model
    def _webvue_partner_statement(self, company, partner, account_type, date_end, date_start=None):
        """The partner statement: ``date_start`` set is the activity statement, else the outstanding one.

        The partner is named explicitly, so the report's own filters that hide a partner without due
        entries or with a negative balance are switched off, and no account is excluded.
        """
        activity = bool(date_start)
        values = {
            'company_id': company.id, 'date_end': date_end, 'account_type': account_type, 'aging_type': 'days',
            'filter_partners_non_due': False, 'filter_negative_balances': False,
        }
        if activity:
            values['date_start'] = date_start
        wizard = self.env['activity.statement.wizard' if activity else 'outstanding.statement.wizard'].with_context(
            active_ids=partner.ids,
        ).new(values)
        report = 'report.partner_statement.%s' % ('activity_statement' if activity else 'outstanding_statement')
        data = {
            key: value.isoformat() if isinstance(value, date) else value
            for key, value in wizard._prepare_statement().items()
        }
        data['excluded_accounts_ids'] = []
        return self.env[report]._get_report_values(partner.ids, data)
