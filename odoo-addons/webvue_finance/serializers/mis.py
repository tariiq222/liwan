# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shapes of the MIS reports: every figure is a ``{code, label, value}`` line in the company currency."""
from .common import dump_day
from odoo.addons.webvue_api.serializers.common import iso


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
        'statutory': False,
        'status': 'management_information',
        'lines': dump_report_lines(amounts),
    }


def dump_balance_sheet(company, date_to, only_posted, amounts):
    return {
        'date_to': dump_day(date_to),
        **_header(company, only_posted),
        'statutory': False,
        'status': 'management_information',
        'lines': dump_report_lines(amounts),
    }


def dump_zakat_adjustment(item):
    return {
        'id': item.id, 'date_to': dump_day(item.date_to), 'kind': item.kind, 'label': item.label,
        'amount': item.amount, 'note': item.note or '',
    }


def dump_zakat_review(review, current):
    return {
        'id': review.id,
        'date_to': dump_day(review.date_to),
        'reviewer': {'id': review.create_uid.id, 'name': review.create_uid.name},
        'credential': review.credential,
        'note': review.note or '',
        'reviewed_at': iso(review.create_date),
        'base': review.base,
        'zakat_due': review.zakat_due,
        'current': current,
    }


def dump_zakat_base(company, date_to, only_posted, template, amounts, workpaper):
    """The template's lines, the base and the Zakat due after the company's adjustments, and the review status.

    ``status`` is ``management_information`` until a review exists, ``reviewed`` while the latest review still matches the
    figures and the adjustments, ``review_stale`` once either has changed. ``filed`` is always false.
    """
    adjustments, base, zakat_due, review, fingerprint = workpaper
    lines = dump_report_lines(amounts)
    figures = {line['code']: line['value'] for line in lines}
    current = bool(review) and review.fingerprint == fingerprint
    status = 'management_information' if not review else ('reviewed' if current else 'review_stale')
    return {
        'date_to': dump_day(date_to),
        **_header(company, only_posted),
        'lines': lines,
        'template_base': figures['zakat_base'],
        'adjustments': [dump_zakat_adjustment(item) for item in adjustments],
        'adjustments_total': company.currency_id.round(base - figures['zakat_base']),
        'base': base,
        'rate': figures['zakat_rate'],
        'zakat_due': zakat_due,
        'status': status,
        'filed': False,
        'review': dump_zakat_review(review, current) if review else None,
        'disclaimer': template.description,
    }
