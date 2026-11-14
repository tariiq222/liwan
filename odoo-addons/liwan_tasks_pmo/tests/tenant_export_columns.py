# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The columns this addon adds to a tenant export dataset of another addon, pinned.

The dataset derives its columns from the model, so a field this addon or its dependencies define on it reaches the export. The test that
compares them with this file fails until someone decides whether a new column belongs in an export a tenant takes away.
"""
ADDED = {
    'tasks': (
        'liwan_completion_pending',
        'liwan_completion_requested_at',
        'liwan_completion_requested_by',
        'liwan_completion_return_note',
        'liwan_completion_revision',
        'liwan_deliverables',
        'liwan_percent_complete',
        'liwan_planned_start',
    ),
}
