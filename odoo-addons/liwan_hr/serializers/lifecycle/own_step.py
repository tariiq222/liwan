# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The wire shape of an onboarding step in the employee's own list."""
from .fields import date_str


def dump_own_step(run, activity):
    return {
        'id': activity.id,
        'run_id': run.id,
        'summary': activity.summary or '',
        'date_deadline': date_str(activity.date_deadline),
        'state': activity.state,
    }
