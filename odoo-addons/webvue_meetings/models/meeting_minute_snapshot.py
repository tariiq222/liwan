# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Completion of a meeting: the historical snapshot and the immutable minutes version."""
from odoo import api, fields, models
from odoo.exceptions import UserError
from odoo.tools import format_datetime, html2plaintext

from .meeting_context import _SNAPSHOT_WRITE, _occurrence_key
from .meeting_workspace import _WORKSPACE_WRITE
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_meetings.serializers.meeting import dump_snapshot_payload


def _snapshot_person(user):
    return {'id': user.id, 'name': user.name} if user else None


class WebVueMeetingMinuteSnapshot(models.Model):
    _inherit = 'webvue.meeting.minute'

    def _webvue_format_snapshot_datetime(self, value):
        """Render a stored UTC instant in the current report user's locale."""
        self.ensure_one()
        if isinstance(value, str):
            value = value.replace('T', ' ').removesuffix('Z')
        parsed = fields.Datetime.to_datetime(value) if value else None
        return format_datetime(self.env, parsed, dt_format='medium') if parsed else ''

    @api.depends('state', 'minutes_snapshot_data')
    @api.depends_context('uid', 'company')
    def _compute_minutes_snapshot(self):
        for meeting in self:
            meeting.check_access('read')
            meeting.minutes_snapshot = (
                dump_snapshot_payload(meeting, meeting.sudo().minutes_snapshot_data)
                if meeting.state == 'done' else None
            ) or False

    def _webvue_completion_gap(self):
        """``(field, message)`` of what a meeting still lacks before it can be completed, else None."""
        self.ensure_one()
        if not self.start_datetime or not self.end_datetime:
            return 'start_datetime', self.env._("Set the meeting start and end before completing it.")
        form = self.minutes_form
        has_form = isinstance(form, dict) and (
            any((form.get(key) or '').strip() for key in ('opening', 'closing')) or bool(form.get('topics'))
        )
        if not html2plaintext(self.minutes or '').strip() and not has_form:
            return 'minutes', self.env._("Write the minutes or fill in the minutes form before completing the meeting.")
        return None

    def _webvue_complete_with_snapshot(self, vals):
        self.ensure_one()
        # Check the transition authorization before writing any content.
        self._webvue_check_transition(self, 'done')
        pending = {key: value for key, value in vals.items() if key != 'state'}
        captured_at = fields.Datetime.now()
        with self.env.cr.savepoint():
            if pending:
                # Persist and sanitize the final authorized graph first. This
                # applies M2M/O2M commands against the existing record graph.
                self._webvue_write_with_effects(pending)
                self.invalidate_recordset()
            gap = None if self.env.su else self._webvue_completion_gap()
            if gap:
                raise UserError(gap[1])
            snapshot = self._webvue_build_minutes_snapshot(captured_at)
            marker = _SNAPSHOT_WRITE.set(True)
            try:
                # Complete through the caller's ordinary authorization first.
                result = self._webvue_write_with_effects({'state': 'done'})
                # Only the protected backing fields use this narrow internal
                # write; the public transition has already passed all checks.
                self.sudo().write({'minutes_snapshot_data': snapshot})
                return result
            finally:
                _SNAPSHOT_WRITE.reset(marker)

    def _webvue_build_minutes_snapshot(self, captured_at=None):
        self.ensure_one()
        captured_at = captured_at or fields.Datetime.now()
        origins = [(self, resolution) for resolution in self.resolution_ids]
        if self.series_id:
            current_key = _occurrence_key(self)
            previous = self.series_id.meeting_ids.filtered(
                lambda meeting: meeting.id != self.id and _occurrence_key(meeting) < current_key,
            ).sorted(key=_occurrence_key)
            origins = [
                (meeting, resolution)
                for meeting in previous
                for resolution in meeting.resolution_ids
            ] + origins

        all_resolution_ids = [resolution.id for _origin, resolution in origins]
        links = self.env['webvue.meeting.links']
        readable = {}
        if all_resolution_ids:
            resolutions = self.env['webvue.meeting.resolution'].browse(all_resolution_ids).exists()
            readable = links._webvue_readable_links(resolutions)

        resolutions = []
        for origin, resolution in origins:
            link = readable.get(resolution.id)
            provenance = None
            projected_state = resolution.state
            if link:
                provenance = {
                    'task_id': link['task_id'],
                    'company_id': link['company_id'],
                    'project_id': link['project_id'],
                }
                projected_state = link['state']
            resolutions.append({
                'id': resolution.id,
                'name': resolution.name,
                'deadline': str(resolution.deadline) if resolution.deadline else None,
                'priority': resolution.priority,
                'state': resolution.state,
                'projected_state': projected_state,
                'responsible': _snapshot_person(resolution.responsible_id),
                'result': resolution.result or '',
                'meeting_name': origin.name,
                'execution_period': resolution.execution_period or '',
                'project_id': links._webvue_project_id(resolution),
                'task_provenance': provenance,
            })
        minutes_form = self.sudo().minutes_form_data
        return {
            'captured_at': iso(captured_at),
            'name': self.name,
            'meeting_date': str(self.meeting_date) if self.meeting_date else None,
            'start_datetime': iso(self.start_datetime),
            'end_datetime': iso(self.end_datetime),
            'location': self.location or '',
            'organizer': _snapshot_person(self.organizer_id),
            'secretary': _snapshot_person(self.secretary_id),
            'attendees': [_snapshot_person(user) for user in self.attendee_ids],
            'agenda': self.agenda or '',
            'minutes': self.minutes or '',
            'resolutions': resolutions,
            'minutes_form': minutes_form if isinstance(minutes_form, dict) else None,
        }

    def _webvue_capture_minutes_version(self):
        """Store the immutable minutes version of a meeting that was just completed."""
        self.ensure_one()
        Version = self.env['webvue.meeting.minutes.version'].sudo()
        number = Version.search_count([('meeting_id', '=', self.id)]) + 1
        token = _WORKSPACE_WRITE.set(True)
        try:
            Version.create({
                'meeting_id': self.id,
                'number': number,
                'captured_at': fields.Datetime.now(),
                'actor_id': self.env.user.id,
                'snapshot': self._webvue_build_minutes_snapshot(),
            })
        finally:
            _WORKSPACE_WRITE.reset(token)
