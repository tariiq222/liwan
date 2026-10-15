# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextvars import ContextVar
from datetime import date, datetime

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError
from odoo.tools import format_datetime, html2plaintext

from odoo.addons.nasq_api.serializers.common import iso
from odoo.addons.nasq_meetings.serializers.meeting import (
    dump_minutes_form,
    dump_snapshot_payload,
)

_SNAPSHOT_WRITE = ContextVar('nasq_meeting_snapshot_write', default=False)
_SNAPSHOT_FIELDS = frozenset({'minutes_snapshot', 'minutes_snapshot_data', 'minutes_snapshot_at'})


def _snapshot_person(user):
    return {'id': user.id, 'name': user.name} if user else None


class NasqMeetingHistory(models.Model):
    _inherit = 'cyan.meeting.minute'

    minutes_snapshot_data = fields.Json(
        copy=False, readonly=True, groups='base.group_system',
    )
    minutes_snapshot_at = fields.Datetime(
        copy=False, readonly=True, groups='base.group_system',
    )
    minutes_snapshot = fields.Json(
        compute='_compute_minutes_snapshot', compute_sudo=False, readonly=True,
    )
    minutes_form = fields.Json(
        compute='_compute_minutes_form', compute_sudo=False, readonly=True,
    )

    @api.depends('minutes_form_data')
    @api.depends_context('uid', 'company')
    def _compute_minutes_form(self):
        for meeting in self:
            meeting.check_access('read')
            meeting.minutes_form = dump_minutes_form(
                meeting, meeting.sudo().minutes_form_data,
            )

    def _nasq_format_snapshot_datetime(self, value):
        """Render a stored UTC instant in the current report user's locale."""
        self.ensure_one()
        if isinstance(value, str):
            value = value.replace('T', ' ').removesuffix('Z')
        parsed = fields.Datetime.to_datetime(value) if value else None
        return format_datetime(self.env, parsed, dt_format='medium') if parsed else ''

    @api.depends('state', 'minutes_snapshot_data', 'minutes_snapshot_at')
    @api.depends_context('uid', 'company')
    def _compute_minutes_snapshot(self):
        for meeting in self:
            meeting.check_access('read')
            data = (
                meeting.minutes_snapshot_data
                if self.env.user.has_group('base.group_system')
                else meeting.sudo().minutes_snapshot_data
            )
            meeting.minutes_snapshot = (
                dump_snapshot_payload(meeting, data) if meeting.state == 'done' else None
            ) or False

    def _nasq_completion_gap(self):
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

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        for field_name in _SNAPSHOT_FIELDS:
            values.pop(field_name, None)
        return values

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if _SNAPSHOT_FIELDS.intersection(vals):
                raise AccessError(self.env._('Historical meeting snapshots are server generated.'))
        return super().create(vals_list)

    def copy(self, default=None):
        default = dict(default or {})
        for field_name in _SNAPSHOT_FIELDS:
            default.pop(field_name, None)
        return super().copy(default)

    def write(self, vals):
        vals = dict(vals)
        if _SNAPSHOT_FIELDS.intersection(vals) and not _SNAPSHOT_WRITE.get():
            raise AccessError(self.env._('Historical meeting snapshots are server generated.'))

        if vals.get('state') == 'done' and len(self) > 1:
            # Every row gets its own graph snapshot, while this savepoint keeps
            # a mixed batch atomic if a later transition is unauthorized.
            with self.env.cr.savepoint():
                for meeting in self:
                    meeting.write(vals)
            return True

        if vals.get('state') == 'done' and self.state == 'confirmed':
            return self._nasq_complete_with_snapshot(vals)

        return super().write(vals)

    def _nasq_complete_with_snapshot(self, vals):
        self.ensure_one()
        # Preserve Cyan's transition authorization before writing any content.
        self._cyan_check_transition(self, 'done')
        pending = {key: value for key, value in vals.items() if key != 'state'}
        captured_at = fields.Datetime.now()
        with self.env.cr.savepoint():
            if pending:
                # Persist and sanitize the final authorized graph first. This
                # applies M2M/O2M commands against the existing record graph.
                super().write(pending)
                self.invalidate_recordset()
            gap = None if self.env.su else self._nasq_completion_gap()
            if gap:
                raise UserError(gap[1])
            snapshot = self._nasq_build_minutes_snapshot(captured_at)
            marker = _SNAPSHOT_WRITE.set(True)
            try:
                # Complete through the caller's ordinary authorization first.
                result = super().write({'state': 'done'})
                # Only the protected backing fields use this narrow internal
                # write; the public transition has already passed all checks.
                self.sudo().write({
                    'minutes_snapshot_data': snapshot,
                    'minutes_snapshot_at': captured_at,
                })
                return result
            finally:
                _SNAPSHOT_WRITE.reset(marker)

    def _nasq_build_minutes_snapshot(self, captured_at=None):
        self.ensure_one()
        captured_at = captured_at or fields.Datetime.now()
        origins = [(self, resolution) for resolution in self.resolution_ids]
        if self.series_id:
            def occurrence_key(meeting):
                meeting_date = fields.Date.to_date(meeting.meeting_date) if meeting.meeting_date else date.min
                start = fields.Datetime.to_datetime(meeting.start_datetime) if meeting.start_datetime else datetime.min
                return meeting_date, start, meeting.id

            current_key = occurrence_key(self)
            previous = self.series_id.meeting_ids.filtered(
                lambda meeting: meeting.id != self.id and occurrence_key(meeting) < current_key,
            ).sorted(key=occurrence_key)
            origins = [
                (meeting, resolution)
                for meeting in previous
                for resolution in meeting.resolution_ids
            ] + origins

        all_resolution_ids = [resolution.id for _origin, resolution in origins]
        links = self.env['nasq.meeting.links']
        readable = {}
        if all_resolution_ids:
            resolutions = self.env['cyan.meeting.resolution'].browse(all_resolution_ids).exists()
            readable = links._nasq_readable_links(self, resolutions)

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
                'project_id': links._nasq_project_id(resolution),
                'task_provenance': provenance,
            })
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
            'minutes_form': self.sudo().minutes_form_data if isinstance(self.sudo().minutes_form_data, dict) else None,
        }
