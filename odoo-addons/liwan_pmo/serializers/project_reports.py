# Part of Odoo. See LICENSE file for full copyright and licensing details.
from decimal import ROUND_HALF_UP, Decimal

from odoo import fields

from odoo.addons.project.models.project_task import CLOSED_STATES
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_pmo.serializers.project import STATUS_TO_API
from odoo.addons.liwan_pmo.serializers.project_charter import dump_currency
from odoo.addons.liwan_pmo.serializers.project_finance import (
    build_finance_summary,
    currency_quantum,
    to_decimal,
)

_CLOSED_STATES = list(CLOSED_STATES)
_ATTENTION_STATUSES = {'at_risk', 'off_track', 'on_hold'}
_STATUS_ORDER = ('on_track', 'at_risk', 'off_track', 'on_hold', 'done', None)


def today_utc():
    now = fields.Datetime.now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def task_counts_by_project(projects, today):
    """Aggregate readable task counts with the caller's task ACLs and rules."""
    if not projects:
        return {}
    project_ids = projects.ids
    Task = projects.env['project.task']
    all_counts = Task._read_group(
        [('project_id', 'in', project_ids)], ['project_id', 'state'], ['__count'],
    )
    overdue_counts = Task._read_group(
        [
            ('project_id', 'in', project_ids), ('state', 'not in', _CLOSED_STATES),
            ('date_deadline', '!=', False), ('date_deadline', '<', today),
        ],
        ['project_id'], ['__count'],
    )
    counts = {}
    for project, state, value in all_counts:
        if project:
            values = counts.setdefault(project.id, [0, 0, 0])
            values[0] += value
            if state in _CLOSED_STATES:
                values[1] += value
    for project, value in overdue_counts:
        if project:
            counts.setdefault(project.id, [0, 0, 0])[2] = value
    return {
        project_id: tuple(counts.get(project_id, (0, 0, 0)))
        for project_id in project_ids
    }


def dump_report_row(project, can_read_tasks, task_values, finance_summary):
    if can_read_tasks:
        task_count, closed_task_count, overdue_task_count = task_values
        progress = round((closed_task_count / task_count) * 100) if task_count else 0
    else:
        task_count = closed_task_count = overdue_task_count = None
        progress = None
    return {
        'project': {
            'id': project.id, 'name': project.name,
            'status': STATUS_TO_API.get(project.last_update_status),
        },
        'finance': finance_summary,
        'task_count': task_count,
        'closed_task_count': closed_task_count,
        'overdue_task_count': overdue_task_count,
        'progress': progress,
    }


def finance_summaries_by_project(projects):
    """Build one finance summary per project from a single readable search."""
    Finance = projects.env['liwan.project.finance.entry']
    entry_ids_by_project = {project.id: [] for project in projects}
    if projects:
        for entry in Finance.search([('project_id', 'in', projects.ids)]):
            entry_ids_by_project[entry.project_id.id].append(entry.id)
    externals = projects.env['liwan.project.actual.source']._liwan_actual_totals(projects)
    return {
        project.id: build_finance_summary(project, Finance.browse(entry_ids_by_project[project.id]), externals)
        for project in projects
    }


def build_dashboard_summary(projects, today, can_read_tasks, task_counts=None, finance_summaries=None):
    """Build the unpaginated project dashboard summary from visible projects."""
    if finance_summaries is None:
        finance_summaries = finance_summaries_by_project(projects)
    if can_read_tasks:
        task_counts = task_counts_by_project(projects, today) if task_counts is None else task_counts
    else:
        task_counts = {}
    status_counts = {}
    attention = []
    overdue_total = 0
    for project in projects:
        status = STATUS_TO_API.get(project.last_update_status)
        status_counts[status] = status_counts.get(status, 0) + 1
        task_values = task_counts.get(project.id, (0, 0, 0)) if can_read_tasks else None
        overdue = task_values[2] if task_values else 0
        if can_read_tasks:
            overdue_total += overdue
        finance = finance_summaries[project.id]
        if status in _ATTENTION_STATUSES or finance['over_budget'] or overdue > 0:
            attention.append((overdue, project.name, project.id, project, task_values))

    attention.sort(key=lambda item: (-item[0], item[1], item[2]))
    attention_rows = []
    for _, _, _, project, task_values in attention[:10]:
        attention_rows.append(dump_report_row(
            project, can_read_tasks, task_values,
            finance_summaries[project.id],
        ))
    return {
        'project_count': len(projects),
        'attention_project_count': len(attention),
        'overdue_task_count': overdue_total if can_read_tasks else None,
        'status_counts': [
            {'status': status, 'count': status_counts[status]}
            for status in _STATUS_ORDER if status in status_counts
        ],
        'totals': build_report_totals(projects, finance_summaries),
        'attention': attention_rows,
    }


def build_project_dashboard_analytics(projects, today, can_read_tasks):
    """Build the full project dashboard payload from one filtered recordset.

    The project recordset is already constrained by the controller's normal
    company, active, visibility and capability checks. Task counts are grouped
    once and explicitly default to zero for projects with no readable tasks.
    """
    task_counts = task_counts_by_project(projects, today) if can_read_tasks else {}
    finance_summaries = finance_summaries_by_project(projects)
    rows = [
        dump_report_row(
            project, can_read_tasks,
            task_counts.get(project.id, (0, 0, 0)) if can_read_tasks else None,
            finance_summaries[project.id],
        )
        for project in projects
    ]
    recent_projects = sorted(
        projects,
        key=lambda project: (
            fields.Datetime.to_datetime(project.write_date)
            if project.write_date else fields.Datetime.to_datetime('1970-01-01 00:00:00'),
            project.id,
        ),
        reverse=True,
    )[:5]
    recent_rows = [
        {
            **dump_report_row(
                project, can_read_tasks,
                task_counts.get(project.id, (0, 0, 0)) if can_read_tasks else None,
                finance_summaries[project.id],
            ),
            'updated_at': iso(project.write_date),
        }
        for project in recent_projects
    ]
    summary = build_dashboard_summary(
        projects, today, can_read_tasks, task_counts, finance_summaries,
    )
    return {**summary, 'projects': rows, 'recent_projects': recent_rows}


def build_report_totals(projects, finance_summaries):
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
        summary = finance_summaries[project.id]
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
