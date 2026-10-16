# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (cyan_meeting_minutes 19.0.1.3.0, LGPL-3), absorbed into webvue_meetings.
# See PROVENANCE.md.
# SPDX-License-Identifier: LGPL-3
from contextvars import ContextVar
from datetime import date, datetime, timedelta

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import format_datetime, html2plaintext

from .meeting_workspace import _WORKSPACE_WRITE
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_meetings.serializers.meeting import (
    dump_minutes_form,
    dump_snapshot_payload,
)

_CALENDAR_IMPORT = ContextVar('webvue_calendar_import', default=False)
_CALENDAR_OUTBOUND = ContextVar('webvue_calendar_outbound', default=frozenset())
_SCOPE_SCHEDULE_WRITE = ContextVar('webvue_scope_schedule_write', default=False)
# Set by a series while it creates its occurrences: the series sends one invite per participant.
_SERIES_GENERATION = ContextVar('webvue_series_generation', default=False)
_SNAPSHOT_WRITE = ContextVar('webvue_meeting_snapshot_write', default=False)
_SNAPSHOT_FIELDS = frozenset({'minutes_snapshot', 'minutes_snapshot_data'})


def _occurrence_key(meeting):
    """Order key of a series occurrence: its day, its start, then its id."""
    meeting_date = fields.Date.to_date(meeting.meeting_date) if meeting.meeting_date else date.min
    start = fields.Datetime.to_datetime(meeting.start_datetime) if meeting.start_datetime else datetime.min
    return meeting_date, start, meeting.id


def _snapshot_person(user):
    return {'id': user.id, 'name': user.name} if user else None


class WebVueMeetingMinute(models.Model):
    _name = 'webvue.meeting.minute'
    _description = 'Internal Meeting Minutes'
    _inherit = ['mail.thread']
    _rec_name = 'reference'
    _order = 'meeting_date desc, id desc'
    _webvue_scope = 'company'
    _check_company_auto = True
    _mail_post_access = 'read'

    _INTERNAL_FIELDS = frozenset({
        'calendar_event_id',
        'open_resolution_count', 'overdue_resolution_count', 'can_edit', 'can_manage',
        'reference',
    })
    _CONTENT_FIELDS = frozenset({
        'name', 'company_id', 'meeting_date', 'start_datetime', 'end_datetime',
        'location', 'organizer_id', 'secretary_id', 'attendee_ids', 'agenda',
        'minutes', 'meeting_url', 'series_id', 'minutes_form_data',
    })
    _LOCKED_STATES = frozenset({'done', 'cancelled'})

    reference = fields.Char(
        string='Reference', required=True, readonly=True, copy=False,
        default=lambda self: _('New'), index='btree', tracking=True,
    )
    name = fields.Char(string='Meeting Title', required=True, tracking=True)
    company_id = fields.Many2one(
        'res.company', required=True, index=True, default=lambda self: self.env.company,
        tracking=True,
    )
    meeting_date = fields.Date(required=True, default=fields.Date.context_today, tracking=True, index=True)
    start_datetime = fields.Datetime(string='Start', tracking=True)
    end_datetime = fields.Datetime(string='End', tracking=True)
    location = fields.Char(tracking=True)
    meeting_url = fields.Char()
    organizer_id = fields.Many2one(
        'res.users', string='Organizer', required=True, default=lambda self: self.env.user,
        domain="[('share', '=', False)]", check_company=True, tracking=True,
    )
    secretary_id = fields.Many2one(
        'res.users', string='Secretary', domain="[('share', '=', False)]",
        check_company=True, tracking=True,
    )
    attendee_ids = fields.Many2many(
        'res.users', 'webvue_meeting_attendee_rel', 'meeting_id', 'user_id',
        string='Attendees', domain="[('share', '=', False)]", check_company=True,
        tracking=True,
    )
    series_id = fields.Many2one(
        'webvue.meeting.series', index=True, ondelete='restrict', check_company=True,
    )
    calendar_event_id = fields.Many2one(
        'calendar.event', string='Calendar Event', copy=False, readonly=True,
        ondelete='restrict', index=True, tracking=True,
    )
    agenda = fields.Html(sanitize=True)
    minutes = fields.Html(string='Meeting Minutes', sanitize=True)
    minutes_form_data = fields.Json(copy=False, readonly=True, groups='base.group_system')
    minutes_snapshot_data = fields.Json(
        copy=False, readonly=True, groups='base.group_system',
    )
    minutes_snapshot = fields.Json(
        compute='_compute_minutes_snapshot', compute_sudo=False, readonly=True,
    )
    minutes_form = fields.Json(
        compute='_compute_minutes_form', compute_sudo=False, readonly=True,
    )
    resolution_ids = fields.One2many('webvue.meeting.resolution', 'meeting_id', string='Resolutions')
    state = fields.Selection(
        [('draft', 'Draft'), ('confirmed', 'Confirmed'), ('done', 'Completed'), ('cancelled', 'Cancelled')],
        default='draft', required=True, index=True, tracking=True, copy=False,
    )
    active = fields.Boolean(default=True)
    open_resolution_count = fields.Integer(compute='_compute_resolution_counts', string='Open Resolutions')
    overdue_resolution_count = fields.Integer(compute='_compute_resolution_counts', string='Overdue Resolutions')
    can_edit = fields.Boolean(compute='_compute_can_flags')
    can_manage = fields.Boolean(compute='_compute_can_flags')

    _reference_unique = models.Constraint('unique(reference)', 'Meeting reference must be unique.')
    _calendar_event_unique = models.Constraint(
        'unique(calendar_event_id)',
        'A Calendar Event can only be linked to one Meeting Minutes record.',
    )

    # ----- access -----

    def _webvue_is_manager(self):
        return self.env.su or self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'meetings.manage')

    def _webvue_participant_users(self):
        self.ensure_one()
        return self.organizer_id | self.secretary_id | self.attendee_ids

    def _webvue_is_editor(self):
        self.ensure_one()
        if self._webvue_is_manager():
            return True
        return self.env.user in (self.organizer_id | self.secretary_id)

    def _webvue_assert_internal_user(self, user, company):
        if not user:
            return
        if user.share or not user.active:
            raise ValidationError(_('Meeting participants must be active internal users.'))
        if company and company not in user.company_ids:
            raise ValidationError(_('Organizer, secretary and attendees must have access to the meeting company.'))

    @api.depends('state', 'organizer_id', 'secretary_id')
    @api.depends_context('uid', 'allowed_company_ids')
    def _compute_can_flags(self):
        is_manager = self._webvue_is_manager()
        user = self.env.user
        for meeting in self:
            meeting.can_manage = is_manager
            meeting.can_edit = meeting.state not in self._LOCKED_STATES and (
                is_manager or user in (meeting.organizer_id | meeting.secretary_id)
            )

    # ----- create -----

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        for name in self._INTERNAL_FIELDS | {'state'} | _SNAPSHOT_FIELDS:
            values.pop(name, None)
        return values

    @api.model_create_multi
    def create(self, vals_list):
        if not _WORKSPACE_WRITE.get() and any('minutes_form_data' in vals for vals in vals_list):
            raise AccessError(self.env._('Minutes form is server controlled.'))
        if any(_SNAPSHOT_FIELDS.intersection(vals) for vals in vals_list):
            raise AccessError(self.env._('Historical meeting snapshots are server generated.'))
        for vals in vals_list:
            self._webvue_apply_series_defaults(vals)
        if not self.env.su:
            self.env['webvue.access.service']._webvue_require_capability('meetings.create')
        sequence = self.env['ir.sequence']
        prepared = []
        for vals in vals_list:
            vals = dict(vals)
            if not self.env.su:
                if 'state' in vals and vals['state'] != 'draft':
                    raise UserError(_('New meetings must start in draft.'))
                if vals.get('reference') and vals['reference'] != _('New'):
                    raise AccessError(_('You cannot set internal meeting fields.'))
                if vals.get('calendar_event_id'):
                    raise AccessError(_('You cannot set internal meeting fields.'))
                for name in self._INTERNAL_FIELDS:
                    vals.pop(name, None)
                vals['state'] = 'draft'
                if not self._webvue_is_manager():
                    vals['organizer_id'] = self.env.user.id
            if vals.get('reference', _('New')) == _('New'):
                vals['reference'] = sequence.next_by_code('webvue.meeting.minute') or _('New')
            prepared.append(vals)
        records = super().create(prepared)
        records._webvue_sync_followers()
        for meeting in records:
            if not _CALENDAR_IMPORT.get():
                meeting._webvue_sync_calendar()
            if _SERIES_GENERATION.get():
                continue
            partners = meeting._webvue_participant_users().mapped('partner_id') - meeting.env.user.partner_id
            meeting._webvue_notify_partners(partners, 'meeting_invite', meeting.name, key=f'meeting-invite:{meeting.id}')
        if not _WORKSPACE_WRITE.get():
            for record in records:
                record._webvue_event('meeting_created', self.env._('Meeting created.'))
        return records

    def _webvue_apply_series_defaults(self, vals):
        series = self.env['webvue.meeting.series'].browse(vals.get('series_id')) if vals.get('series_id') else self.env['webvue.meeting.series']
        if not series:
            return
        self._webvue_check_series_link(series)
        series.check_access('read')
        for field, value in series._webvue_extra_meeting_defaults().items():
            if value:
                vals.setdefault(field, value)
        vals.setdefault('organizer_id', series.organizer_id.id)
        if series.secretary_id:
            vals.setdefault('secretary_id', series.secretary_id.id)
        if series.location:
            vals.setdefault('location', series.location)
        if series.meeting_url:
            vals.setdefault('meeting_url', series.meeting_url)
        if 'attendee_ids' not in vals:
            attendees = series.attendee_ids
            if series.secretary_id:
                attendees -= series.secretary_id
            vals['attendee_ids'] = [(6, 0, attendees.ids)]

    def _webvue_check_series_link(self, series):
        """Require an editor for every user-controlled series association."""
        series.ensure_one()
        if series.company_id != self.env.company:
            raise AccessError(self.env._('The meeting series is outside the current company.'))
        if not self.env.su and not series._webvue_is_editor():
            raise AccessError(self.env._(
                'Only the organizer, secretary or a meetings manager may link a meeting to this series.',
            ))

    # ----- write -----

    def write(self, vals):
        vals = dict(vals)
        if 'minutes_form_data' in vals and not _WORKSPACE_WRITE.get():
            raise AccessError(self.env._('Minutes form is server controlled.'))
        if self.ids:
            self.env.cr.execute(
                'SELECT id FROM %s WHERE id IN %%s ORDER BY id FOR UPDATE' % self._table,
                (tuple(sorted(self.ids)),),
            )
            self.invalidate_recordset()
        previous_state = {record.id: record.state for record in self}
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
            result = self._webvue_complete_with_snapshot(vals)
        else:
            result = self._webvue_write_with_effects(vals)
        if not _WORKSPACE_WRITE.get():
            self._webvue_record_write_events(vals, previous_state)
        return result

    def _webvue_write_with_effects(self, vals):
        """Write through the human guards, then sync the calendar and notify participants."""
        if vals.get('series_id'):
            series = self.env['webvue.meeting.series'].browse(vals['series_id']).exists()
            if not series:
                raise ValidationError(self.env._('The meeting series does not exist.'))
            self._webvue_check_series_link(series)
            series.check_access('read')
        previous = {meeting.id: meeting._webvue_participant_users() for meeting in self}
        previous_state = {meeting.id: meeting.state for meeting in self}
        result = self._webvue_write_guarded(vals)
        if {'start_datetime', 'end_datetime', 'meeting_url', 'location', 'name', 'attendee_ids', 'secretary_id', 'organizer_id'} & set(vals):
            for meeting in self:
                meeting._webvue_sync_calendar()
        if {'attendee_ids', 'secretary_id'} & set(vals):
            for meeting in self:
                added = meeting._webvue_participant_users() - previous[meeting.id]
                meeting._webvue_notify_partners(
                    added.mapped('partner_id'), 'meeting_invite', meeting.name,
                    key=f'meeting-invite:{meeting.id}',
                )
        if {'start_datetime', 'end_datetime', 'location'} & set(vals):
            for meeting in self:
                partners = meeting._webvue_participant_users().mapped('partner_id') - meeting.env.user.partner_id
                meeting._webvue_notify_partners(partners, 'meeting_changed', meeting.name)
        if vals.get('state') == 'cancelled':
            for meeting in self:
                if previous_state[meeting.id] == 'cancelled':
                    continue
                meeting._webvue_set_calendar_event_active(False)
                partners = meeting._webvue_participant_users().mapped('partner_id') - meeting.env.user.partner_id
                meeting._webvue_notify_partners(
                    partners, 'meeting_cancelled', meeting.name,
                )
        if vals.get('state') == 'draft':
            for meeting in self:
                if previous_state[meeting.id] == 'cancelled':
                    meeting._webvue_set_calendar_event_active(True)
        return result

    def _webvue_write_guarded(self, vals):
        vals = dict(vals)
        if not self.env.su:
            illicit = self._INTERNAL_FIELDS.intersection(vals)
            if illicit:
                raise AccessError(_('You cannot set internal meeting fields.'))
            self._webvue_check_human_write(vals)
        previous = {meeting.id: meeting._webvue_follower_partners() for meeting in self} if not self.env.su else {}
        result = super().write(vals)
        if not self.env.su:
            self._webvue_sync_followers(previous)
        return result

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
                number = self.env['webvue.meeting.minutes.version'].sudo().search_count([('meeting_id', '=', record.id)]) + 1
                token = _WORKSPACE_WRITE.set(True)
                try:
                    self.env['webvue.meeting.minutes.version'].sudo().create({
                        'meeting_id': record.id,
                        'number': number,
                        'captured_at': fields.Datetime.now(),
                        'actor_id': self.env.user.id,
                        'snapshot': record._webvue_build_minutes_snapshot(),
                    })
                finally:
                    _WORKSPACE_WRITE.reset(token)

    def _webvue_check_human_write(self, vals):
        if not self:
            return
        if not self._webvue_is_manager() and any(not meeting._webvue_is_editor() for meeting in self):
            raise AccessError(_('Only the organizer, secretary or a Meeting Manager may edit this meeting.'))
        new_state = vals.get('state')
        content_keys = self._CONTENT_FIELDS.intersection(vals) | ({'active'} & set(vals))
        extra = set(vals) - {'state'} - self._INTERNAL_FIELDS
        for meeting in self:
            if meeting.state in self._LOCKED_STATES:
                if new_state == 'draft':
                    if extra or content_keys:
                        raise UserError(_('Reopen a completed or cancelled meeting before changing its content.'))
                    if not self._webvue_is_manager():
                        raise UserError(_('Only a Meeting Manager may reopen completed or cancelled meetings.'))
                    continue
                if new_state and new_state != meeting.state:
                    raise UserError(_('Only a Meeting Manager may reopen completed or cancelled meetings.'))
                if content_keys or (set(vals) - {'state'}):
                    raise UserError(_('Completed and cancelled meetings are immutable.'))
            elif new_state:
                self._webvue_check_transition(meeting, new_state)
            elif content_keys and not meeting._webvue_is_editor() and not self._webvue_is_manager():
                raise AccessError(_('Only the organizer, secretary or a Meeting Manager may edit this meeting.'))

    def _webvue_check_transition(self, meeting, new_state):
        if new_state == meeting.state:
            return
        allowed = {
            'draft': {'confirmed', 'cancelled'},
            'confirmed': {'done', 'cancelled'},
            'done': {'draft'},
            'cancelled': {'draft'},
        }
        if new_state not in allowed.get(meeting.state, ()):
            raise UserError(_('This meeting state change is not allowed.'))
        if new_state in {'done', 'cancelled'} and not self._webvue_is_manager():
            raise UserError(_('Only a Meeting Manager may complete or cancel meetings.'))
        if new_state == 'confirmed' and not (self._webvue_is_manager() or meeting._webvue_is_editor()):
            raise AccessError(_('Only the organizer, secretary or a Meeting Manager may confirm this meeting.'))

    def copy(self, default=None):
        default = dict(default or {})
        default['state'] = 'draft'
        default['calendar_event_id'] = False
        default['reference'] = _('New')
        for field_name in _SNAPSHOT_FIELDS:
            default.pop(field_name, None)
        return super().copy(default)

    def unlink(self):
        version_count = self.env['webvue.meeting.minutes.version'].sudo().search_count([
            ('meeting_id', 'in', self.ids),
        ])
        if version_count:
            raise AccessError(self.env._('Meetings with finalized minutes versions cannot be deleted.'))
        if not self.env.su:
            if any(meeting.state in self._LOCKED_STATES for meeting in self):
                raise UserError(_('Completed and cancelled meetings cannot be deleted.'))
            if not self._webvue_is_manager():
                raise AccessError(_('Only a Meeting Manager may delete meetings.'))
        return super().unlink()

    # ----- constraints and computes -----

    @api.constrains('start_datetime', 'end_datetime')
    def _check_datetime_order(self):
        for meeting in self:
            if meeting.start_datetime and meeting.end_datetime and meeting.end_datetime < meeting.start_datetime:
                raise ValidationError(_('The meeting end time cannot be earlier than its start time.'))

    @api.constrains('organizer_id', 'secretary_id', 'attendee_ids', 'company_id')
    def _check_user_companies(self):
        for meeting in self:
            users = meeting._webvue_participant_users()
            for user in users:
                meeting._webvue_assert_internal_user(user, meeting.company_id)
            for resolution in meeting.resolution_ids:
                if resolution.responsible_id and resolution.responsible_id not in meeting._webvue_participant_users():
                    raise ValidationError(_('Reassign the responsible user before removing them from the meeting.'))

    @api.constrains('start_datetime', 'end_datetime', 'organizer_id', 'state')
    def _webvue_check_organizer_overlap(self):
        for meeting in self:
            if _SCOPE_SCHEDULE_WRITE.get():
                continue
            if meeting.state == 'cancelled' or not meeting.start_datetime or not meeting.end_datetime:
                continue
            # Scheduling is a company-wide invariant, including meetings the
            # current editor cannot otherwise read.
            clash = self.sudo().search_count([
                ('id', '!=', meeting.id),
                ('company_id', '=', meeting.company_id.id),
                ('organizer_id', '=', meeting.organizer_id.id),
                ('state', '!=', 'cancelled'),
                ('start_datetime', '<', meeting.end_datetime),
                ('end_datetime', '>', meeting.start_datetime),
            ], limit=1)
            if clash:
                raise ValidationError(self.env._('This time overlaps another meeting for the organizer.'))

    @api.depends('resolution_ids.state', 'resolution_ids.deadline')
    def _compute_resolution_counts(self):
        for meeting in self:
            meeting.open_resolution_count = 0
            meeting.overdue_resolution_count = 0

        origin_meetings = self._origin
        if not origin_meetings:
            return

        values = {meeting.id: [0, 0] for meeting in origin_meetings}
        open_domain = [
            ('meeting_id', 'in', origin_meetings.ids),
            ('state', 'not in', ('done', 'cancelled')),
        ]
        today = fields.Date.context_today(self)
        Resolution = self.env['webvue.meeting.resolution']
        for meeting, count in Resolution._read_group(open_domain, ['meeting_id'], ['__count']):
            values[meeting.id][0] = count
        for meeting, count in Resolution._read_group(
            open_domain + [('deadline', '<', today)], ['meeting_id'], ['__count'],
        ):
            values[meeting.id][1] = count
        for meeting in self:
            if meeting._origin:
                meeting.open_resolution_count, meeting.overdue_resolution_count = values[meeting._origin.id]

    # ----- state actions -----

    def action_confirm(self):
        for meeting in self:
            if meeting.state != 'draft':
                raise UserError(_('Only draft meetings can be confirmed.'))
        self.write({'state': 'confirmed'})
        return True

    def action_done(self):
        for meeting in self:
            if meeting.state != 'confirmed':
                raise UserError(_('Only confirmed meetings can be completed.'))
        self.write({'state': 'done'})
        return True

    def action_cancel(self):
        self.filtered(lambda meeting: meeting.state != 'cancelled').write({'state': 'cancelled'})
        return True

    def action_reset_draft(self):
        self.write({'state': 'draft'})
        return True

    # ----- schedule scope -----

    def _webvue_scope_meetings(self, scope):
        self.ensure_one()
        if scope != 'this_and_following' or not self.series_id:
            return self

        current_key = _occurrence_key(self)
        return self.series_id.meeting_ids.filtered(
            lambda meeting: _occurrence_key(meeting) >= current_key,
        ).sorted(key=_occurrence_key)

    def action_apply_schedule_scope(self, vals, scope='this'):
        self.ensure_one()
        link_fields = self.env['webvue.meeting.links']._webvue_link_fields()
        allowed = {
            'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date',
            'agenda', 'minutes', 'attendee_ids', 'secretary_id',
        } | link_fields
        payload = {key: vals[key] for key in allowed if key in vals}
        targets = self._webvue_scope_meetings(scope)
        locked = targets.filtered(lambda meeting: meeting.state in meeting._LOCKED_STATES)
        if scope == 'this' and locked:
            raise UserError(self.env._("Reopen the meeting before changing its schedule."))
        editable = targets - locked
        if scope != 'this_and_following':
            editable.write(payload)
            return editable

        schedule_fields = {'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date'}
        content_fields = {'agenda', 'minutes', 'attendee_ids', 'secretary_id'} | link_fields
        schedule_payload = {key: payload[key] for key in schedule_fields if key in payload}
        content_payload = {key: payload[key] for key in content_fields if key in payload}
        if scope == 'this_and_following' and self in locked and content_payload:
            raise UserError(self.env._("Reopen the meeting before changing its content."))
        needs_schedule_rewrite = bool({'start_datetime', 'end_datetime', 'meeting_date'} & payload.keys())
        start_provided = 'start_datetime' in schedule_payload
        end_provided = 'end_datetime' in schedule_payload
        date_provided = 'meeting_date' in schedule_payload
        start_cleared = start_provided and schedule_payload['start_datetime'] is False
        end_cleared = end_provided and schedule_payload['end_datetime'] is False
        new_start = (
            fields.Datetime.to_datetime(schedule_payload['start_datetime'])
            if start_provided and not start_cleared else None
        )
        new_end = (
            fields.Datetime.to_datetime(schedule_payload['end_datetime'])
            if end_provided and not end_cleared else None
        )
        old_start = fields.Datetime.to_datetime(self.start_datetime) if self.start_datetime else None
        old_end = fields.Datetime.to_datetime(self.end_datetime) if self.end_datetime else None
        delta = new_start - old_start if new_start is not None and old_start is not None else None
        duration = new_end - new_start if new_start is not None and new_end is not None else None
        end_delta = (
            new_end - old_end
            if new_end is not None and old_end is not None and (not start_provided or start_cleared)
            else None
        )
        old_date = fields.Date.to_date(self.meeting_date) if self.meeting_date else None
        new_date = fields.Date.to_date(schedule_payload['meeting_date']) if date_provided and schedule_payload['meeting_date'] else None
        # When the API supplies a calendar day alongside a shifted start,
        # propagate that explicit day delta. Deriving from the stored UTC
        # datetime would move near-midnight occurrences to the wrong day.
        date_delta = new_date - old_date if new_date and old_date else None
        source_date = new_date or old_date

        updates_by_id = {}
        for meeting in editable:
            updates = {
                key: value for key, value in schedule_payload.items()
                if key not in {'start_datetime', 'end_datetime', 'meeting_date'}
            }
            meeting_start = fields.Datetime.to_datetime(meeting.start_datetime) if meeting.start_datetime else None
            meeting_end = fields.Datetime.to_datetime(meeting.end_datetime) if meeting.end_datetime else None
            target_date = fields.Date.to_date(meeting.meeting_date) if meeting.meeting_date else None
            if target_date and date_delta is not None:
                target_date += date_delta
            anchored_start = (
                new_start + timedelta(days=(target_date - source_date).days)
                if new_start is not None and source_date and target_date else None
            )
            anchored_end = (
                new_end + timedelta(days=(target_date - source_date).days)
                if new_end is not None and source_date and target_date else None
            )

            # Each supplied schedule field has independent semantics. A
            # clear must remain a clear even when another field shifts the
            # occurrence; omitting a field preserves its existing value.
            if start_provided:
                if start_cleared:
                    updates['start_datetime'] = False
                elif delta is not None and meeting_start:
                    updates['start_datetime'] = meeting_start + delta
                elif delta is None and date_delta is not None and meeting_start:
                    # A date-only source has no prior instant from which to
                    # derive a time delta. Preserve the timed occurrence's
                    # local clock when an explicit day shift moves it.
                    updates['start_datetime'] = meeting_start + date_delta
                elif meeting == self:
                    updates['start_datetime'] = new_start
                elif meeting_start is None and anchored_start is not None:
                    # Date-only occurrences do not have an absolute instant
                    # to shift. Preserve the source's date-to-instant
                    # relationship on each occurrence's own calendar day.
                    updates['start_datetime'] = anchored_start
            elif delta is None and date_delta is not None and meeting_start:
                updates['start_datetime'] = meeting_start + date_delta

            if end_provided:
                if end_cleared:
                    updates['end_datetime'] = False
                elif duration is not None and (delta is not None or meeting == self) and (meeting_start or meeting == self):
                    base_start = updates.get('start_datetime', meeting_start)
                    if base_start:
                        updates['end_datetime'] = base_start + duration
                elif end_delta is not None and meeting_end:
                    updates['end_datetime'] = meeting_end + end_delta
                elif delta is None and date_delta is not None and meeting_end:
                    updates['end_datetime'] = meeting_end + date_delta
                elif meeting == self:
                    updates['end_datetime'] = new_end
                elif meeting_end is None and anchored_end is not None:
                    updates['end_datetime'] = anchored_end
            elif delta is None and date_delta is not None and meeting_end:
                updates['end_datetime'] = meeting_end + date_delta

            if not end_provided and delta is not None and meeting_end:
                updates['end_datetime'] = meeting_end + delta

            if date_provided:
                if new_date is None:
                    updates['meeting_date'] = False
                elif date_delta is not None and meeting.meeting_date:
                    updates['meeting_date'] = fields.Date.to_date(meeting.meeting_date) + date_delta
                elif meeting == self or not meeting.meeting_date:
                    updates['meeting_date'] = new_date
            elif delta is not None and meeting_start:
                # A start shift without an explicit calendar day keeps the
                # existing per-occurrence day; the API already validated the
                # current occurrence's day in this case.
                updates['meeting_date'] = meeting.meeting_date

            updates_by_id[meeting.id] = updates

        with self.env.cr.savepoint():
            token = _SCOPE_SCHEDULE_WRITE.set(needs_schedule_rewrite)
            try:
                for meeting in editable:
                    updates = updates_by_id[meeting.id]
                    if meeting == self:
                        updates = {**updates, **content_payload}
                    meeting.write(updates)
            finally:
                _SCOPE_SCHEDULE_WRITE.reset(token)
            if needs_schedule_rewrite:
                editable._webvue_check_organizer_overlap()
        return editable

    def action_cancel_scope(self, scope='this'):
        self.ensure_one()
        if self.state == 'done':
            raise UserError(self.env._("Reopen the completed meeting before cancelling it."))
        targets = self._webvue_scope_meetings(scope).filtered(lambda meeting: meeting.state not in ('done', 'cancelled'))
        targets.action_cancel()
        return targets

    # ----- calendar -----

    @api.private
    def _webvue_link_calendar_event(self, event):
        self.ensure_one()
        if not self.env.su:
            if self.state in self._LOCKED_STATES:
                raise UserError(_('Completed and cancelled meetings are immutable.'))
            if not self._webvue_is_editor() and not self._webvue_is_manager():
                raise AccessError(_('Only the organizer, secretary or a Meeting Manager may link a calendar event.'))
            event.check_access('read')
        return super().write({'calendar_event_id': event.id})

    @api.private
    def _webvue_write_calendar_schedule(self, values):
        self.ensure_one()
        # Only the server-local outbound call may suppress the calendar round-trip.
        if self.id in _CALENDAR_OUTBOUND.get():
            return True
        values = dict(values)
        if 'attendee_ids' in values and self.secretary_id:
            attendee_ids = values['attendee_ids'][0][2]
            if self.secretary_id.id in attendee_ids:
                values['attendee_ids'] = [(6, 0, [uid for uid in attendee_ids if uid != self.secretary_id.id])]
            elif self.secretary_id.id != values.get('organizer_id'):
                values['secretary_id'] = False
        if self.state in self._LOCKED_STATES:
            raise UserError(_('Completed and cancelled meetings are immutable.'))
        if not self._webvue_is_manager() and not self._webvue_is_editor():
            raise AccessError(_('Updating the calendar event cannot change meeting minutes you cannot edit.'))
        previous = {self.id: self._webvue_follower_partners()}
        result = super().write(values)
        self._webvue_sync_followers(previous)
        return result

    def action_open_calendar_event(self):
        self.ensure_one()
        if not self.calendar_event_id:
            raise UserError(_('This meeting is not linked to a Calendar Event.'))
        self.calendar_event_id.check_access('read')
        return {
            'type': 'ir.actions.act_window',
            'name': _('Calendar Event'),
            'res_model': 'calendar.event',
            'res_id': self.calendar_event_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_schedule_calendar_event(self):
        self.ensure_one()
        if self.calendar_event_id:
            return self.action_open_calendar_event()
        if self.state in self._LOCKED_STATES:
            raise UserError(_('Completed and cancelled meetings are immutable.'))
        if not self._webvue_is_editor() and not self._webvue_is_manager():
            raise AccessError(_('Only the organizer, secretary or a Meeting Manager may schedule this meeting.'))
        if not self.start_datetime or not self.end_datetime:
            raise UserError(_('Set Start and End before scheduling this meeting in Calendar.'))
        partners = self._webvue_participant_users().mapped('partner_id')
        event = self.env['calendar.event'].create({
            'name': self.name,
            'start': self.start_datetime,
            'stop': self.end_datetime,
            'location': self.location,
            'user_id': self.organizer_id.id,
            'partner_ids': [(6, 0, partners.ids)],
            'privacy': 'confidential',
        })
        self._webvue_link_calendar_event(event)
        self.message_post(
            body=_('Linked to Calendar event: %s', event.name),
            subtype_xmlid='mail.mt_note',
        )
        return self.action_open_calendar_event()

    def _webvue_sync_calendar(self):
        self.ensure_one()
        linked = bool(self.calendar_event_id)
        complete_schedule = bool(self.start_datetime and self.end_datetime)
        if not linked and not complete_schedule:
            return
        try:
            with self.env.cr.savepoint():
                if not self.calendar_event_id:
                    self.action_schedule_calendar_event()
                event = self.calendar_event_id
                if event:
                    values = {
                        'name': self.name,
                        'location': self.location,
                        'user_id': self.organizer_id.id,
                        'videocall_location': self.meeting_url or False,
                    }
                    # A linked event still needs membership revocation when
                    # meeting dates are cleared. Keep its last valid schedule.
                    if complete_schedule:
                        values.update(start=self.start_datetime, stop=self.end_datetime)
                    changes = {key: value for key, value in values.items()
                               if (event[key].id if key == 'user_id' else event[key]) != value}
                    partner_ids = self._webvue_participant_users().mapped('partner_id').ids
                    if set(event.partner_ids.ids) != set(partner_ids):
                        changes['partner_ids'] = [(6, 0, partner_ids)]
                    if changes:
                        token = _CALENDAR_OUTBOUND.set(_CALENDAR_OUTBOUND.get() | {self.id})
                        try:
                            event.write(changes)
                        finally:
                            _CALENDAR_OUTBOUND.reset(token)
        except (AccessError, UserError):
            if linked:
                raise
            return

    def _webvue_set_calendar_event_active(self, active):
        """A cancelled meeting leaves its attendees' calendars; a reopened one returns to them."""
        self.ensure_one()
        event = self.calendar_event_id
        if event and event.active != active:
            event.write({'active': active})

    # ----- followers and mail -----

    def _webvue_allowed_follower_partners(self):
        self.ensure_one()
        service = self.env['webvue.access.service']
        # sudo READ: meeting-manager group members, narrowed by actual company grants; no meeting fields.
        candidates = self.env.ref('webvue_meetings.group_cap_meetings_manage').sudo().user_ids
        managers = candidates.filtered(lambda user: user.active and not user.share
            and self.company_id in user.company_ids
            and service._webvue_has_capability(user, 'meetings.manage', company=self.company_id))
        return (self._webvue_participant_users() | managers).mapped('partner_id')

    def _webvue_follower_partners(self):
        return self._webvue_allowed_follower_partners()

    def message_subscribe(self, partner_ids=None, subtype_ids=None):
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._webvue_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_('You cannot add followers who cannot access this record.'))
        return super().message_subscribe(partner_ids=partner_ids, subtype_ids=subtype_ids)

    def _webvue_assert_mail_post_kwargs(self, kwargs):
        if self.env.su:
            return
        allowed_docs = {(self._name, record.id) for record in self}
        attachment_ids = kwargs.get('attachment_ids') or []
        if attachment_ids:
            attachments = self.env['ir.attachment'].browse(attachment_ids).exists()
            attachments.check_access('read')
            allowed_unbound = {False, '', 'mail.compose.message', 'mail.scheduled.message'}
            for attachment in attachments:
                bound = (attachment.res_model, attachment.res_id) in allowed_docs
                own_unbound = (
                    not attachment.res_id
                    and attachment.create_uid == self.env.user
                    and (attachment.res_model or False) in allowed_unbound
                )
                if not bound and not own_unbound:
                    raise AccessError(_('You cannot attach files from another record.'))
        parent_id = kwargs.get('parent_id')
        if parent_id:
            parent = self.env['mail.message'].browse(parent_id)
            if parent.exists() and (parent.model, parent.res_id) not in allowed_docs:
                raise AccessError(_('You cannot reply to a message from another record.'))
        kwargs.pop('author_id', None)

    def message_post(self, **kwargs):
        partner_ids = kwargs.get('partner_ids') or []
        if partner_ids and not self.env.su:
            allowed = set()
            for record in self:
                allowed.update(record._webvue_allowed_follower_partners().ids)
            if set(partner_ids) - allowed:
                raise AccessError(_('You cannot notify partners who cannot access this record.'))
        self._webvue_assert_mail_post_kwargs(kwargs)
        return super().message_post(**kwargs)

    def _notify_get_recipients(self, message, msg_vals=False, **kwargs):
        recipients = super()._notify_get_recipients(message, msg_vals=msg_vals, **kwargs)
        allowed = set()
        for record in self:
            allowed.update(record._webvue_allowed_follower_partners().ids)
        return [recipient for recipient in recipients if recipient.get('id') in allowed]

    def _webvue_sync_followers(self, previous=None):
        previous = previous or {}
        for meeting in self:
            allowed = meeting._webvue_follower_partners()
            extra = meeting.message_partner_ids - allowed
            extra = extra.filtered(lambda partner: partner.user_ids)
            if extra:
                meeting.message_unsubscribe(partner_ids=extra.ids)
            stale = previous.get(meeting.id)
            if stale:
                removed = stale - allowed
                if removed:
                    meeting.message_unsubscribe(partner_ids=removed.ids)

    # ----- notifications -----

    def _webvue_notify_partners(self, partners, kind, body, key=None):
        self.ensure_one()
        service = self.env['webvue.notify.service']
        for partner in partners:
            # The per-recipient suffix keeps the pre-split key format, so a
            # producer that runs again after an upgrade delivers nothing new.
            service._webvue_deliver(
                self._name, self.id, kind, partner, body,
                key=f'{key}:{partner.id}' if key else None,
                values={'webvue_meeting_id': self.id},
            )

    @api.model
    def _webvue_run_meeting_reminders(self):
        now = fields.Datetime.now()
        soon = now + timedelta(hours=24)
        for meeting in self.search([
            ('state', 'in', ('draft', 'confirmed')),
            ('start_datetime', '>=', now),
            ('start_datetime', '<=', soon),
        ]):
            meeting._webvue_notify_partners(
                meeting._webvue_participant_users().mapped('partner_id'),
                'meeting_reminder', meeting.name,
                key=f'meeting-reminder:{meeting.id}:{fields.Datetime.to_string(meeting.start_datetime)}',
            )
        today = fields.Date.context_today(self)
        Resolution = self.env['webvue.meeting.resolution']
        resolutions = Resolution.search([
            ('state', 'not in', ('done', 'cancelled')),
            ('meeting_id.state', '!=', 'cancelled'),
            ('deadline', '<', today),
        ])
        # A recommendation followed on a linked record (a converted task) gets no overdue reminder.
        linked_ids = self.env['webvue.meeting.links']._webvue_linked_resolution_ids(resolutions)
        for resolution in resolutions.filtered(lambda item: item.id not in linked_ids):
            if resolution.responsible_id:
                resolution.meeting_id._webvue_notify_partners(
                    resolution.responsible_id.partner_id,
                    'meeting_resolution_overdue',
                    resolution.name,
                    key=f'meeting-res-overdue:{resolution.id}',
                )

    # ----- minutes form and activity feed -----

    @api.model
    def _webvue_validate_minutes_form(self, form):
        if not isinstance(form, dict):
            raise ValidationError(self.env._('minutes_form must be an object.'))
        required = ('opening', 'closing', 'chairperson', 'approver_name', 'approver_title', 'topics')
        if set(form) != set(required):
            raise ValidationError(self.env._('minutes_form contains unsupported fields.'))
        for field in required[:-1]:
            if not isinstance(form[field], str) or len(form[field]) > (500 if field in ('chairperson', 'approver_name', 'approver_title') else 50000):
                raise ValidationError(self.env._('Invalid minutes form field: %s', field))
        topics = form['topics']
        if not isinstance(topics, list) or len(topics) > 100:
            raise ValidationError(self.env._('minutes_form topics must contain at most 100 items.'))
        keys = set()
        resolution_ids = []
        total_text = sum(len(form[field]) for field in required[:-1])
        for topic in topics:
            if not isinstance(topic, dict) or set(topic) != {'key', 'title', 'discussion', 'project_id', 'resolution_ids'}:
                raise ValidationError(self.env._('Each minutes topic must have the supported fields.'))
            key = topic['key']
            if not isinstance(key, str) or not key.strip() or len(key) > 200 or key in keys:
                raise ValidationError(self.env._('Minutes topic keys must be unique.'))
            keys.add(key)
            if not isinstance(topic['title'], str) or len(topic['title']) > 500:
                raise ValidationError(self.env._('Minutes topic titles must be at most 500 characters.'))
            if not isinstance(topic['discussion'], str) or len(topic['discussion']) > 50000:
                raise ValidationError(self.env._('Minutes topic discussion is too long.'))
            total_text += len(topic['title']) + len(topic['discussion'])
            if topic['project_id'] is not None:
                if isinstance(topic['project_id'], bool) or not isinstance(topic['project_id'], int) or topic['project_id'] <= 0:
                    raise ValidationError(self.env._('Minutes topic project is invalid.'))
                self.env['webvue.meeting.links']._webvue_check_topic_project(topic['project_id'])
            ids = topic['resolution_ids']
            if not isinstance(ids, list) or len(ids) > 200 or any(isinstance(item, bool) or not isinstance(item, int) or item <= 0 for item in ids):
                raise ValidationError(self.env._('Minutes topic recommendations are invalid.'))
            resolution_ids.extend(ids)
        if total_text > 50000:
            raise ValidationError(self.env._('The minutes form text is too long.'))
        if len(resolution_ids) != len(set(resolution_ids)):
            raise ValidationError(self.env._('A recommendation may only be assigned to one topic.'))
        if resolution_ids:
            resolutions = self.env['webvue.meeting.resolution'].browse(resolution_ids).exists()
            if len(resolutions) != len(set(resolution_ids)) or any(item.meeting_id != self for item in resolutions):
                raise ValidationError(self.env._('Minutes form contains a recommendation from another meeting.'))
        return form

    def _webvue_set_minutes_form(self, form):
        self.ensure_one()
        self.check_access('read')
        self._webvue_validate_minutes_form(form)
        self._webvue_check_human_write({'minutes_form_data': form})
        # The wire form redacts an unreadable topic project to null. Editing
        # visible minutes must not silently clear that server-owned association.
        # Read only after the ordinary record/content checks above, using the
        # same documented elevation that writes this protected JSON field.
        meeting_sudo = self.sudo()
        previous = meeting_sudo.minutes_form_data or {}
        projects_by_key = {topic['key']: topic.get('project_id') for topic in previous.get('topics', [])}
        form = {**form, 'topics': [dict(topic) for topic in form['topics']]}
        links = self.env['webvue.meeting.links']
        for topic in form['topics']:
            previous_project = projects_by_key.get(topic['key'])
            if topic['project_id'] is None and previous_project and not links._webvue_project_ref_by_id(self, previous_project):
                topic['project_id'] = previous_project
        was_internal = _WORKSPACE_WRITE.get()
        token = _WORKSPACE_WRITE.set(True)
        try:
            result = meeting_sudo.with_context(webvue_workspace_write=True).write({'minutes_form_data': form})
        finally:
            _WORKSPACE_WRITE.reset(token)
        if not was_internal:
            self._webvue_event('minutes_saved', self.env._('Meeting minutes updated.'))
        return result

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

    # ----- completion snapshot -----

    @api.depends('minutes_form_data')
    @api.depends_context('uid', 'company')
    def _compute_minutes_form(self):
        for meeting in self:
            meeting.check_access('read')
            meeting.minutes_form = dump_minutes_form(
                meeting, meeting.sudo().minutes_form_data,
            )

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
            data = (
                meeting.minutes_snapshot_data
                if self.env.user.has_group('base.group_system')
                else meeting.sudo().minutes_snapshot_data
            )
            meeting.minutes_snapshot = (
                dump_snapshot_payload(meeting, data) if meeting.state == 'done' else None
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
