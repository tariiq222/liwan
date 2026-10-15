# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Retire the charter state 'final': a finalized charter was the manager's
approval, so it becomes 'approved'. Approver and dates stay empty (unknown).
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        "UPDATE project_project SET nasq_charter_state = 'approved' WHERE nasq_charter_state = 'final'",
    )
