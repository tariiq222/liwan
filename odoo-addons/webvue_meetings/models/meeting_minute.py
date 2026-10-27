# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Original author: Cyan (cyan_meeting_minutes 19.0.1.3.0, LGPL-3), absorbed into webvue_meetings.
# See PROVENANCE.md.
# SPDX-License-Identifier: LGPL-3
"""The meeting minute record: fields, access, create/write guards, constraints and state actions."""
from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .meeting_context import (
    _CALENDAR_IMPORT,
    _SCOPE_SCHEDULE_WRITE,
    _SERIES_GENERATION,
    _SNAPSHOT_FIELDS,
    _SNAPSHOT_WRITE,
)
from .meeting_workspace import _WORKSPACE_WRITE


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

    def _webvue_is_manager(self, company=None):
        if self and not self.env.su and not self.has_access('read'):
            return False
        company = company or (self.company_id if self else self.env.company)
        return self.env.su or self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'meetings.manage', company=company,
        )

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

    @api.depends('state', 'company_id', 'organizer_id', 'secretary_id')
    @api.depends_context('uid', 'allowed_company_ids')
    def _compute_can_flags(self):
        user = self.env.user
        for meeting in self:
            is_manager = meeting._webvue_is_manager()
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
        sequence = self.env['ir.sequence']
        prepared = []
        for vals in vals_list:
            vals = dict(vals)
            if not self.env.su:
                company = self.env['res.company'].browse(vals.get('company_id')) if vals.get('company_id') else self.env.company
                if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'meetings.create', company=company):
                    msg = 'forbidden'
                    raise AccessError(msg)
                if 'state' in vals and vals['state'] != 'draft':
                    raise UserError(_('New meetings must start in draft.'))
                if vals.get('reference') and vals['reference'] != _('New'):
                    raise AccessError(_('You cannot set internal meeting fields.'))
                if vals.get('calendar_event_id'):
                    raise AccessError(_('You cannot set internal meeting fields.'))
                for name in self._INTERNAL_FIELDS:
                    vals.pop(name, None)
                vals['state'] = 'draft'
                if not self._webvue_is_manager(company=company):
                    vals['organizer_id'] = self.env.user.id
            vals.setdefault('state', 'draft')
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

    def _webvue_check_human_write(self, vals):
        if not self:
            return
        if any(not meeting._webvue_is_editor() for meeting in self):
            raise AccessError(_('Only the organizer, secretary or a Meeting Manager may edit this meeting.'))
        new_state = vals.get('state')
        content_keys = self._CONTENT_FIELDS.intersection(vals) | ({'active'} & set(vals))
        extra = set(vals) - {'state'} - self._INTERNAL_FIELDS
        for meeting in self:
            if meeting.state in self._LOCKED_STATES:
                if new_state == 'draft':
                    if extra or content_keys:
                        raise UserError(_('Reopen a completed or cancelled meeting before changing its content.'))
                    if not meeting._webvue_is_manager():
                        raise UserError(_('Only a Meeting Manager may reopen completed or cancelled meetings.'))
                    continue
                if new_state and new_state != meeting.state:
                    raise UserError(_('Only a Meeting Manager may reopen completed or cancelled meetings.'))
                if content_keys or (set(vals) - {'state'}):
                    raise UserError(_('Completed and cancelled meetings are immutable.'))
            elif new_state:
                self._webvue_check_transition(meeting, new_state)
            elif content_keys and not meeting._webvue_is_editor():
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
        if new_state in {'done', 'cancelled'} and not meeting._webvue_is_manager():
            raise UserError(_('Only a Meeting Manager may complete or cancel meetings.'))
        if new_state == 'confirmed' and not meeting._webvue_is_editor():
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
        version_count = self.env['webvue.meeting.minutes.version'].search_count([
            ('meeting_id', 'in', self.ids),
        ])
        if version_count:
            raise AccessError(self.env._('Meetings with finalized minutes versions cannot be deleted.'))
        if not self.env.su:
            if any(meeting.state in self._LOCKED_STATES for meeting in self):
                raise UserError(_('Completed and cancelled meetings cannot be deleted.'))
            if any(not meeting._webvue_is_manager() for meeting in self):
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
