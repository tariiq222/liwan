# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref


def _dump_account(account):
    return {'id': account.id, 'code': account.code or '', 'name': account.name}


def dump_fiscal_year(plan):
    return {
        'year': plan['year'],
        'date_from': dump_day(plan['date_from']),
        'date_to': dump_day(plan['date_to']),
        'state': plan['state'],
        'result': plan['result'],
        'closing_entry': dump_ref(plan['closing_entry']),
    }


def dump_closing_preview(plan, blockers):
    currency = plan['currency']
    lines = [
        {'account': _dump_account(account), 'debit': debit, 'credit': credit}
        for account, debit, credit in plan['lines']
    ]
    return {
        'year': plan['year'],
        'date_from': dump_day(plan['date_from']),
        'date_to': dump_day(plan['date_to']),
        'journal': dump_ref(plan['journal']),
        'retained_earnings_account': _dump_account(plan['retained_earnings']) if plan['retained_earnings'] else None,
        'lines': lines,
        'total_debit': currency.round(sum(line['debit'] for line in lines)),
        'total_credit': currency.round(sum(line['credit'] for line in lines)),
        'result': plan['result'],
        'blockers': [{'code': code, 'message': message, 'details': details} for code, message, details in blockers],
    }
