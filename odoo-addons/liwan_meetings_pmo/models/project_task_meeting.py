# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tasks converted from meeting recommendations (the meetings/PMO bridge)."""
from odoo import api, fields, models

ORIGIN_FIELDS = frozenset({'meeting_id', 'resolution_id'})
# Cursor-local marker set only around the checked conversion; never a context flag.
CONVERT_MARKER = 'liwan_meetings_pmo.resolution_convert_depth'


class ProjectTaskMeetingOrigin(models.Model):
    _inherit = 'project.task'

    # Opaque origin ids of the meeting and the recommendation a task was converted from.
    meeting_id = fields.Integer(copy=False, index=True)
    resolution_id = fields.Integer(copy=False, index=True)
    _liwan_resolution_task_unique = models.UniqueIndex(
        '(resolution_id) WHERE resolution_id IS NOT NULL AND resolution_id > 0',
    )

    @api.model
    def _liwan_extra_create_fields(self):
        extra = super()._liwan_extra_create_fields()
        if self.env.cr.precommit.data.get(CONVERT_MARKER):
            extra = extra | ORIGIN_FIELDS
        return extra
