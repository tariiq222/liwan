# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day


def _account(account, company):
    return {'id': account.id, 'code': account.with_company(company).code or '', 'name': account.name}


def _items(rows, company):
    return [{'account': _account(account, company), 'amount': amount} for account, amount in rows]


def dump_cash_flow(company, date_from, date_to, figures):
    """The statement: three sections of account lines, their totals and the check against the cash accounts."""
    return {
        'date_from': dump_day(date_from),
        'date_to': dump_day(date_to),
        'currency': figures['currency'],
        'basis': 'indirect',
        'statutory': False,
        'opening_cash': figures['opening_cash'],
        'closing_cash': figures['closing_cash'],
        'net_change': figures['net_change'],
        'operating': {
            'net_income': figures['net_income'],
            'adjustments': [{'key': key, 'amount': amount} for key, amount in figures['adjustments']],
            'items': _items(figures['operating'], company),
            'total': figures['operating_total'],
        },
        'investing': {
            'items': _items(figures['investing'], company),
            'depreciation_reclass': figures['investing_adjustment'],
            'total': figures['investing_total'],
        },
        'financing': {'items': _items(figures['financing'], company), 'total': figures['financing_total']},
        'total_change': figures['total_change'],
        'difference': figures['difference'],
    }
