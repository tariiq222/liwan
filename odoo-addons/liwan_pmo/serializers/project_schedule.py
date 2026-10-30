# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

STATE_TO_API = {
    '01_in_progress': 'in_progress',
    '02_changes_requested': 'changes_requested',
    '03_approved': 'approved',
    '04_waiting_normal': 'waiting',
    '1_done': 'done',
    '1_canceled': 'cancelled',
}


def _date(value):
    return fields.Date.to_string(value) if value else None


def dump_schedule_task(task, visible_dependency_ids=None):
    visible_dependency_ids = visible_dependency_ids or set()
    return {
        'id': task.id,
        'name': task.name,
        'start': _date(task.liwan_planned_start),
        'end': _date(fields.Date.to_date(task.date_deadline)),
        'state': STATE_TO_API.get(task.state, 'waiting'),
        'dependency_ids': [
            dependency_id for dependency_id in task.depend_on_ids.ids
            if dependency_id in visible_dependency_ids
        ],
        'milestone_id': task.milestone_id.id or None,
    }


def dump_schedule_milestone(milestone):
    return {
        'id': milestone.id,
        'name': milestone.name,
        'start_date': _date(milestone.liwan_start_date),
        'deadline': _date(milestone.deadline),
    }
