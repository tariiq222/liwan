# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shapes of the statement reports: trial balance, general ledger, aged partner balance, partner statement.

The OCA report models return large dictionaries meant for their QWeb templates; only the figures listed
here are copied out, rounded to the company currency.
"""
from .common import dump_day

# The overdue buckets of the aged partner balance, by the key the OCA report uses.
AGED_BUCKETS = (
    ('current', 'current'), ('days_1_30', '30_days'), ('days_31_60', '60_days'),
    ('days_61_90', '90_days'), ('days_91_120', '120_days'), ('days_over_120', 'older'),
)
# The same buckets in the partner statement report.
STATEMENT_BUCKETS = (
    ('current', 'current'), ('days_1_30', 'b_1_30'), ('days_31_60', 'b_30_60'),
    ('days_61_90', 'b_60_90'), ('days_91_120', 'b_90_120'), ('days_over_120', 'b_over_120'),
)
TRIAL_BALANCE_AMOUNTS = ('initial_balance', 'debit', 'credit', 'balance', 'ending_balance')


def _account(row):
    return {'id': row['id'], 'code': row['code'], 'name': row['name']}


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


def _dump_ledger_line(line, journals, currency):
    return {
        'id': line['id'],
        'date': dump_day(line['date']),
        'entry': line['entry'],
        'journal': journals[line['journal_id']]['code'],
        'partner': _partner(line['partner_id'], line['partner_name']),
        'label': line['ref_label'] or '',
        'debit': currency.round(line['debit']),
        'credit': currency.round(line['credit']),
        'balance': currency.round(line['balance']),
    }


def dump_general_ledger(company, date_from, date_to, only_posted, values, limit, offset):
    """Per account: the opening balance, the period debit and credit, the closing balance and one page of lines.

    A line's ``balance`` is the running balance of its account after the line.
    """
    currency = company.currency_id
    accounts = []
    for account in values['general_ledger']:
        lines = account.get('move_lines', [])
        accounts.append({
            'account': _account(account),
            'initial_balance': currency.round(account['init_bal']['balance']),
            'debit': currency.round(sum(line['debit'] for line in lines)),
            'credit': currency.round(sum(line['credit'] for line in lines)),
            'ending_balance': currency.round(account['fin_bal']['balance']),
            'lines': {
                'items': [_dump_ledger_line(line, values['journals_data'], currency) for line in lines[offset:offset + limit]],
                'total': len(lines),
            },
        })
    return {**_period(date_from, date_to, only_posted, currency), 'accounts': accounts}


def _dump_buckets(source, keys, currency):
    return {name: currency.round(source[key]) for name, key in keys}


def dump_aged_partner_balance(company, date_at, only_posted, account_type, values):
    """Open receivable (or payable) balances aged from their due date to ``date_at``, per account and partner."""
    currency = company.currency_id
    accounts = []
    for account in values['aged_partner_balance']:
        partners = []
        for partner in account['partners']:
            record = partner['move_lines'][0]['line_rec'].partner_id
            partners.append({
                'partner': _partner(record.id, partner['name']),
                **_dump_buckets(partner, AGED_BUCKETS, currency),
                'total': currency.round(partner['residual']),
            })
        accounts.append({
            'account': _account(account),
            **_dump_buckets(account, AGED_BUCKETS, currency),
            'total': currency.round(account['residual']),
            'partners': partners,
        })
    return {
        'date_to': dump_day(date_at),
        'kind': _kind(account_type),
        'target_move': 'posted' if only_posted else 'all',
        'currency': currency.name,
        'accounts': accounts,
        'totals': {
            **{name: currency.round(sum(account[name] for account in accounts)) for name, _key in AGED_BUCKETS},
            'total': currency.round(sum(account['total'] for account in accounts)),
        },
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
