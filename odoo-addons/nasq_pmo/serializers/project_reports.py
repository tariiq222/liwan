# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import ROUND_HALF_UP, Decimal

from odoo import fields

from odoo.addons.nasq_pmo.serializers.project import STATUS_TO_API
from odoo.addons.nasq_pmo.serializers.project_charter import dump_currency
from odoo.addons.nasq_pmo.serializers.project_finance import (
    build_finance_summary,
    currency_quantum,
    to_decimal,
)
from odoo.addons.project.models.project_task import CLOSED_STATES

_CLOSED_STATES = list(CLOSED_STATES)


def today_utc():
    now = fields.Datetime.now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _task_counts(project, today):
    Task = project.env['project.task']
    base_domain = [('project_id', '=', project.id)]
    task_count = Task.search_count(base_domain)
    closed_task_count = Task.search_count([*base_domain, ('state', 'in', _CLOSED_STATES)])
    overdue_task_count = Task.search_count([
        *base_domain, ('state', 'not in', _CLOSED_STATES),
        ('date_deadline', '!=', False), ('date_deadline', '<', today),
    ])
    return task_count, closed_task_count, overdue_task_count


def dump_report_row(project, today, can_read_tasks):
    if can_read_tasks:
        task_count, closed_task_count, overdue_task_count = _task_counts(project, today)
        progress = round((closed_task_count / task_count) * 100) if task_count else 0
    else:
        task_count = closed_task_count = overdue_task_count = None
        progress = None
    return {
        'project': {
            'id': project.id, 'name': project.name,
            'status': STATUS_TO_API.get(project.last_update_status),
        },
        'finance': build_finance_summary(project),
        'task_count': task_count,
        'closed_task_count': closed_task_count,
        'overdue_task_count': overdue_task_count,
        'progress': progress,
    }


def build_report_totals(projects):
    """Per-currency totals across every filtered, visible project.

    Accumulated as exact `Decimal`, not float, and only rounded to the
    currency's precision once at the very end: summing many already-rounded
    per-project floats with plain `+=` can still drift (float addition is not
    associative), and totals must be exactly reproducible from their rows.
    """
    buckets = {}
    order = []
    for project in projects:
        currency = project.currency_id
        key = currency.id if currency else None
        if key not in buckets:
            buckets[key] = {
                'currency': dump_currency(currency),
                'project_count': 0, 'budgeted_project_count': 0,
                'planned': Decimal('0'), 'actual': Decimal('0'), 'remaining': Decimal('0'),
                'over_budget_count': 0, '_currency': currency,
            }
            order.append(key)
        bucket = buckets[key]
        summary = build_finance_summary(project)
        bucket['project_count'] += 1
        bucket['actual'] += to_decimal(summary['actual'])
        if summary['planned'] is not None:
            bucket['budgeted_project_count'] += 1
            bucket['planned'] += to_decimal(summary['planned'])
            bucket['remaining'] += to_decimal(summary['remaining'])
        if summary['over_budget']:
            bucket['over_budget_count'] += 1
    result = []
    for key in order:
        bucket = buckets[key]
        quantum = currency_quantum(bucket['_currency'])
        result.append({
            'currency': bucket['currency'],
            'project_count': bucket['project_count'],
            'budgeted_project_count': bucket['budgeted_project_count'],
            'planned': float(bucket['planned'].quantize(quantum, rounding=ROUND_HALF_UP)),
            'actual': float(bucket['actual'].quantize(quantum, rounding=ROUND_HALF_UP)),
            'remaining': float(bucket['remaining'].quantize(quantum, rounding=ROUND_HALF_UP)),
            'over_budget_count': bucket['over_budget_count'],
        })
    return result
