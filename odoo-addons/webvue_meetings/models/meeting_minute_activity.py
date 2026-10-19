# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Activity feed of a meeting."""
from odoo import fields, models

from .meeting_workspace import _WORKSPACE_WRITE


class WebVueMeetingMinuteActivity(models.Model):
    _inherit = 'webvue.meeting.minute'

    def _webvue_event(self, kind, summary):
        self.ensure_one()
        token = _WORKSPACE_WRITE.set(True)
        try:
            return self.env['webvue.meeting.event'].sudo().create({
                'meeting_id': self.id,
                'occurred_at': fields.Datetime.now(),
                'actor_id': self.env.user.id if self.env.user else False,
                'kind': kind,
                'summary': summary[:500],
            })
        finally:
            _WORKSPACE_WRITE.reset(token)

    def _webvue_record_write_events(self, vals, previous_state):
        """Log the activity feed and capture a minutes version when a meeting is completed."""
        changed = set(vals) - {'state', 'minutes_snapshot_data'}
        for record in self:
            if changed:
                record._webvue_event('meeting_edited', self.env._('Meeting details updated.'))
            if previous_state.get(record.id) != record.state:
                kind = {'confirmed': 'meeting_confirmed', 'done': 'meeting_completed', 'draft': 'meeting_reopened', 'cancelled': 'meeting_cancelled'}.get(record.state, 'meeting_state_changed')
                record._webvue_event(kind, self.env._('Meeting state changed to %s.', record.state))
            if previous_state.get(record.id) == 'confirmed' and record.state == 'done':
                record._webvue_capture_minutes_version()
