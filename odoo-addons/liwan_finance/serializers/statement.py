# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shapes of the statement reports: trial balance, general ledger, aged partner balance, partner statement.

The OCA report models return large dictionaries meant for their QWeb templates; only the figures listed
here are copied out (the general ledger and the aged balance come as plain rows from the statement model), rounded to the company currency.
"""
from .common import dump_day
from odoo.addons.liwan_finance.models.statement_report import AGED_BUCKET_NAMES

# The same buckets in the partner statement report.
STATEMENT_BUCKETS = (
    ('current', 'current'), ('days_1_30', 'b_1_30'), ('days_31_60', 'b_30_60'),
    ('days_61_90', 'b_60_90'), ('days_91_120', 'b_90_120'), ('days_over_120', 'b_over_120'),
)
TRIAL_BALANCE_AMOUNTS = ('initial_balance', 'debit', 'credit', 'balance', 'ending_balance')


def _account(row):
    return {'id': row['id'], 'code': row['code'], 'name': row['name']}


def _account_record(account):
    return {'id': account.id, 'code': account.code, 'name': account.name}


def _partner(partner_id, name):
    return {'id': partner_id, 'name': name} if partner_id else None


def _kind(account_type):
    return 'receivable' if account_type == 'asset_receivable' else 'payable'


def _period(date_from, date_to, only_posted, currency):
    return {
        'date_from': dump_day(date_from),
        'date_to': dump_day(date_to),
        'target_move': 'posted' if only_posted else 'all',
        'currency': currency.name,
    }


def dump_trial_balance(company, date_from, date_to, only_posted, values):
    currency = company.currency_id
    accounts = [
        {'account': _account(row), **{key: currency.round(row[key]) for key in TRIAL_BALANCE_AMOUNTS}}
        for row in values['trial_balance']
    ]
    return {
        **_period(date_from, date_to, only_posted, currency),
        'accounts': accounts,
        'totals': {key: currency.round(sum(row[key] for row in accounts)) for key in TRIAL_BALANCE_AMOUNTS},
    }


def _ledger_label(line):
    """The journal item's reference and label, joined unless one repeats or lacks the other."""
    if not line.ref or line.ref == line.name:
        return line.name or ''
    return f'{line.ref} - {line.name}' if line.name else line.ref


def _dump_ledger_line(entry, currency):
    line = entry['line']
    return {
        'id': line.id,
        'date': dump_day(line.date),
        'entry': line.move_name,
        'journal': line.journal_id.code,
        'partner': _partner(line.partner_id.id, line.partner_id.display_name),
        'label': _ledger_label(line),
        'debit': currency.round(line.debit),
        'credit': currency.round(line.credit),
        'balance': currency.round(entry['balance']),
    }


def dump_general_ledger(company, date_from, date_to, only_posted, rows):
    """Per account: the opening balance, the period debit and credit, the closing balance and one page of lines.

    ``rows`` come from ``_liwan_general_ledger``: ``lines`` holds the page only and ``total`` the count of the
    period's lines (a ledger without ``account_id`` lists no lines). A line's ``balance`` is the running
    balance of its account after the line.
    """
    currency = company.currency_id
    return {
        **_period(date_from, date_to, only_posted, currency),
        'accounts': [
            {
                'account': _account_record(row['account']),
                'initial_balance': currency.round(row['initial_balance']),
                'debit': currency.round(row['debit']),
                'credit': currency.round(row['credit']),
                'ending_balance': currency.round(row['ending_balance']),
                'lines': {'items': [_dump_ledger_line(entry, currency) for entry in row['lines']], 'total': row['total']},
            }
            for row in rows
        ],
    }


def _dump_buckets(source, keys, currency):
    return {name: currency.round(source[key]) for name, key in keys}


def _sum_buckets(rows, currency):
    return {
        **{name: currency.round(sum(row[name] for row in rows)) for name in AGED_BUCKET_NAMES},
        'total': currency.round(sum(row['total'] for row in rows)),
    }


def dump_aged_partner_balance(company, date_at, only_posted, account_type, values):
    """Open receivable (or payable) balances aged from their due date to ``date_at``, per account and partner.

    ``values`` are the ``(account, partner, buckets)`` triples of ``_liwan_aged_partner_balance``.
    """
    currency = company.currency_id
    by_account = {}
    for account, partner, buckets in values:
        amounts = {name: currency.round(buckets[name]) for name in AGED_BUCKET_NAMES}
        by_account.setdefault(account, []).append({
            'partner': _partner(partner.id, partner.display_name),
            **amounts,
            'total': currency.round(sum(amounts.values())),
        })
    accounts = []
    for account in sorted(by_account, key=lambda found: found.code):
        partners = sorted(by_account[account], key=lambda row: (row['partner'] is None, row['partner']['name'] if row['partner'] else ''))
        accounts.append({
            'account': _account_record(account),
            **_sum_buckets(partners, currency),
            'partners': partners,
        })
    return {
        'date_to': dump_day(date_at),
        'kind': _kind(account_type),
        'target_move': 'posted' if only_posted else 'all',
        'currency': currency.name,
        'accounts': accounts,
        'totals': _sum_buckets(accounts, currency),
    }


def _dump_statement_line(line, move_line, activity):
    return {
        'date': dump_day(move_line.date),
        'date_due': dump_day(move_line.date_maturity or move_line.date),
        'entry': line['move_id'],
        'ref': line['ref'],
        'label': line['name'],
        'debit': line['debit'],
        'credit': line['credit'],
        'open_amount': line['open_amount'],
        'balance': line['balance'] if activity else None,
    }


def statement_line_ids(values):
    """The journal item ids behind the statement lines (an activity line may merge several; its first dates it)."""
    ids = []
    for partner in values['data'].values():
        for block in partner['currencies'].values():
            ids += [line['ids'][0] if 'ids' in line else line['id'] for line in block['lines']]
    return ids


def dump_partner_statement(company, partner, account_type, date_from, date_to, values, move_lines):
    """One block per currency of the partner's items, in that currency (a statement is a document sent to the partner).

    ``move_lines`` maps a journal item id to its record, for the ISO dates the report only gives formatted.
    ``date_from`` is None for an outstanding statement.
    """
    activity = date_from is not None
    currencies = values['Currencies']
    blocks = []
    for currency_id, block in values['data'][partner.id]['currencies'].items():
        currency = currencies[currency_id]
        lines = [
            _dump_statement_line(line, move_lines[line['ids'][0] if 'ids' in line else line['id']], activity)
            for line in block['lines']
        ]
        buckets = block.get('buckets') or {}
        blocks.append({
            'currency': currency.name,
            'balance_forward': currency.round(block['balance_forward']),
            'amount_due': currency.round(block['amount_due']),
            'ending_balance': currency.round(block['ending_balance']),
            'lines': lines,
            'buckets': {
                **_dump_buckets(buckets, STATEMENT_BUCKETS, currency),
                'total': currency.round(buckets['balance']),
            } if buckets else None,
        })
    return {
        'type': 'activity' if activity else 'outstanding',
        'kind': _kind(account_type),
        'partner': _partner(partner.id, partner.display_name),
        'date_from': dump_day(date_from),
        'date_to': dump_day(date_to),
        'currencies': blocks,
    }
