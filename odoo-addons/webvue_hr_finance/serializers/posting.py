# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_hr.serializers.assets.common import ref


def _dump_line(env, line):
    analytic = env['account.analytic.account'].browse(int(next(iter(line.get('analytic_distribution', {})), 0)))
    account = env['account.account'].browse(line['account_id'])
    return {
        'account': {'id': account.id, 'code': account.code, 'name': account.name},
        'analytic_account': ref(analytic),
        'employee': ref(env['hr.employee'].browse(line['employee_id'])),
        'debit': line['debit'],
        'credit': line['credit'],
    }


def dump_posting_preview(run, settings, lines, warnings):
    env = run.env
    currency = run.company_id.currency_id
    return {
        'entry_detail': settings.entry_detail,
        'date': run.date_end.isoformat(),
        'journal': ref(settings.journal_id),
        'lines': [_dump_line(env, line) for line in lines],
        'debit': currency.round(sum(line['debit'] for line in lines)),
        'credit': currency.round(sum(line['credit'] for line in lines)),
        'warnings': [{'code': warning['code'], 'employee': ref(warning['employee'])} for warning in warnings],
    }
