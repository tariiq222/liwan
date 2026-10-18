# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shapes of the MIS reports: every figure is a ``{code, label, value}`` line in the company currency."""
from .common import dump_day


def dump_report_lines(amounts):
    """The figures of a MIS template: ``code`` is the stable KPI name, ``label`` its description."""
    return [{'code': kpi.name, 'label': kpi.description, 'value': amount} for kpi, amount in amounts]


def _header(company, only_posted):
    return {'target_move': 'posted' if only_posted else 'all', 'currency': company.currency_id.name}


def dump_profit_loss(company, date_from, date_to, only_posted, amounts):
    return {
        'date_from': dump_day(date_from),
        'date_to': dump_day(date_to),
        **_header(company, only_posted),
        'lines': dump_report_lines(amounts),
    }


def dump_balance_sheet(company, date_to, only_posted, amounts):
    return {'date_to': dump_day(date_to), **_header(company, only_posted), 'lines': dump_report_lines(amounts)}


def dump_zakat_base(company, date_to, only_posted, template, amounts):
    """The lines plus the three results at the top level; ``disclaimer`` is the template's description."""
    lines = dump_report_lines(amounts)
    figures = {line['code']: line['value'] for line in lines}
    return {
        'date_to': dump_day(date_to),
        **_header(company, only_posted),
        'lines': lines,
        'base': figures['zakat_base'],
        'rate': figures['zakat_rate'],
        'zakat_due': figures['zakat_due'],
        'disclaimer': template.description,
    }
