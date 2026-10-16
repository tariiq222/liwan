# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


def _date(value):
    return fields.Date.to_string(value) if value else None


def dump_milestone(project, milestone):
    total, done = project._webvue_milestone_task_counts(milestone)
    return {
        'id': milestone.id, 'name': milestone.name, 'deadline': _date(milestone.deadline),
        'start_date': _date(milestone.webvue_start_date),
        'deliverables': milestone.webvue_deliverables or [],
        'is_reached': milestone.is_reached, 'reached_date': _date(milestone.reached_date),
        'task_count': total, 'done_task_count': done,
    }
