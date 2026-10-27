# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, time
from itertools import islice

import pytz
from dateutil.rrule import MONTHLY, WEEKLY, rrule

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .meeting_context import _CALENDAR_IMPORT, _SERIES_GENERATION, _occurrence_key
from odoo.addons.calendar.models.calendar_recurrence import weekday_to_field

MAX_OCCURRENCES = 60


class WebVueMeetingSeries(models.Model):
    _name = 'webvue.meeting.series'
    _description = 'Meeting series'
    _webvue_scope = 'company'
    _order = 'name, id'
    _check_company_auto = True

    name = fields.Char(required=True)
    # False once the series is ended: its occurrences and minutes stay, no new one can be added.
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        'res.company', required=True, index=True,
        default=lambda self: self.env.company,
    )
    organizer_id = fields.Many2one(
        'res.users', required=True, default=lambda self: self.env.user,
        domain="[('share', '=', False)]", check_company=True,
    )
    secretary_id = fields.Many2one(
        'res.users', domain="[('share', '=', False)]", check_company=True,
    )
    attendee_ids = fields.Many2many(
        'res.users', 'webvue_meeting_series_attendee_rel', 'series_id', 'user_id',
        domain="[('share', '=', False)]", check_company=True,
    )
    recurrence = fields.Selection(
        [('none', 'On demand'), ('weekly', 'Weekly'), ('biweekly', 'Every two weeks'), ('monthly', 'Monthly')],
        default='none', required=True,
    )
    until_date = fields.Date()
    until_count = fields.Integer()
    location = fields.Char()
    meeting_url = fields.Char()
    meeting_ids = fields.One2many('webvue.meeting.minute', 'series_id')

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            for vals in vals_list:
                company = self.env['res.company'].browse(vals.get('company_id')) if vals.get('company_id') else self.env.company
                if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'meetings.create', company=company):
                    msg = 'forbidden'
                    raise AccessError(msg)
                if not self._webvue_is_manager(company=company):
                    vals['organizer_id'] = self.env.user.id
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su:
            if any(not series._webvue_is_editor() for series in self):
                raise AccessError(self.env._("Only the organizer, secretary or a meetings manager may edit this series."))
            if any(not series._webvue_is_manager() for series in self):
                vals = dict(vals)
                vals.pop('organizer_id', None)
        return super().write(vals)

    def _webvue_is_manager(self, company=None):
        if self and not self.env.su and not self.has_access('read'):
            return False
        company = company or (self.company_id if self else self.env.company)
        return self.env.su or self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'meetings.manage', company=company,
        )

    def _webvue_is_editor(self):
        self.ensure_one()
        return self._webvue_is_manager() or self.env.user in (self.organizer_id | self.secretary_id)

    def _webvue_assert_open(self):
        """An ended series takes no new meeting, however the link is made."""
        self.ensure_one()
        if not self.active:
            raise UserError(self.env._("This series has ended; no meetings can be added to it."))

    def _webvue_participants(self):
        self.ensure_one()
        return self.organizer_id | self.secretary_id | self.attendee_ids

    def _webvue_timezone(self):
        """The organizer's timezone: occurrence days, weekdays and month days are read in it."""
        self.ensure_one()
        return pytz.timezone(self.organizer_id.tz or self.env.user.tz or 'UTC')

    def _webvue_local_start(self, value):
        """A stored UTC datetime as an aware datetime in the series timezone."""
        return pytz.utc.localize(fields.Datetime.to_datetime(value)).astimezone(self._webvue_timezone())

    def _webvue_extra_meeting_defaults(self):
        """Occurrence defaults other applications add through super(); none here."""
        self.ensure_one()
        return {}

    def _webvue_meeting_defaults(self):
        self.ensure_one()
        attendees = self.attendee_ids
        if self.secretary_id:
            attendees -= self.secretary_id
        return {
            'name': self.name,
            'state': 'draft',
            'company_id': self.company_id.id,
            'series_id': self.id,
            'organizer_id': self.organizer_id.id,
            'secretary_id': self.secretary_id.id,
            'attendee_ids': [(6, 0, attendees.ids)],
            'location': self.location or False,
            'meeting_url': self.meeting_url or False,
            **self._webvue_extra_meeting_defaults(),
        }

    @api.constrains('recurrence', 'until_date', 'until_count')
    def _check_recurrence_end(self):
        for series in self:
            if series.recurrence == 'none':
                continue
            if bool(series.until_date) == bool(series.until_count):
                raise ValidationError(self.env._("Set either an end date or a number of meetings, not both."))
            if series.until_count and (series.until_count < 1 or series.until_count > MAX_OCCURRENCES):
                raise ValidationError(self.env._("Occurrence count must be between 1 and %s.", MAX_OCCURRENCES))

    def action_add_occurrence(self, start=None, stop=None, name=None):
        self.ensure_one()
        if self.company_id != self.env.company:
            raise AccessError(self.env._("The meeting series is outside the current company."))
        if not self._webvue_is_editor():
            raise AccessError(self.env._("Only the organizer, secretary or a meetings manager may add meetings."))
        vals = self._webvue_meeting_defaults()
        if name:
            vals['name'] = name
        if start and stop:
            vals['start_datetime'] = start
            vals['end_datetime'] = stop
            vals['meeting_date'] = self._webvue_local_start(start).date()
        return self.env['webvue.meeting.minute'].create(vals)

    def action_cancel_series(self):
        """End the series: cancel every upcoming open occurrence, then archive it.

        Held, cancelled and past occurrences, their minutes and their versions are kept as they are.
        """
        self.ensure_one()
        if self.company_id != self.env.company:
            raise AccessError(self.env._("The meeting series is outside the current company."))
        if not self._webvue_is_editor():
            raise AccessError(self.env._("Only the organizer, secretary or a meetings manager may end this series."))
        if not self.active:
            return self
        now = fields.Datetime.now()
        today = fields.Date.context_today(self)

        def upcoming(meeting):
            if meeting.state in meeting._LOCKED_STATES:
                return False
            if meeting.start_datetime:
                return meeting.start_datetime > now
            return not meeting.meeting_date or meeting.meeting_date >= today

        pending = self.meeting_ids.filtered(upcoming)
        if pending:
            if not self._webvue_is_manager():
                raise AccessError(self.env._("Only a meetings manager may cancel the upcoming meetings of a series."))
            min(pending, key=_occurrence_key).action_cancel_scope('this_and_following')
        self.active = False
        return self

    def action_generate_occurrences(self, start, stop):
        self.ensure_one()
        if self.company_id != self.env.company:
            raise AccessError(self.env._("The meeting series is outside the current company."))
        if not self._webvue_is_editor():
            raise AccessError(self.env._(
                "Only the organizer, secretary or a meetings manager may generate meetings.",
            ))
        if self.recurrence == 'none':
            raise UserError(self.env._("On-demand series do not generate recurrences."))
        if self.meeting_ids:
            raise UserError(self.env._("This series already has meetings."))
        if not start or not stop:
            raise UserError(self.env._("Set start and end before generating the series."))
        start_dt = fields.Datetime.to_datetime(start)
        stop_dt = fields.Datetime.to_datetime(stop)
        if not start_dt or not stop_dt or stop_dt <= start_dt:
            raise ValidationError(self.env._("The meeting end time must be after its start time."))
        timezone = self._webvue_timezone()
        local_start = self._webvue_local_start(start_dt)
        if self.until_date:
            if self.until_date < local_start.date():
                raise ValidationError(self.env._("The recurrence end date must be on or after the first meeting."))
            frequency = MONTHLY if self.recurrence == 'monthly' else WEEKLY
            recurrence = rrule(
                frequency, dtstart=local_start,
                until=timezone.localize(datetime.combine(self.until_date, time.max)),
                interval=2 if self.recurrence == 'biweekly' else 1,
            )
            if len(list(islice(recurrence, MAX_OCCURRENCES + 1))) > MAX_OCCURRENCES:
                raise ValidationError(self.env._(
                    "A recurrence may contain at most %s meetings.", MAX_OCCURRENCES,
                ))
        weekday = weekday_to_field(local_start.weekday())
        event_vals = {
            'name': self.name,
            'start': start,
            'stop': stop,
            'location': self.location or False,
            'user_id': self.organizer_id.id,
            'partner_ids': [(6, 0, self._webvue_participants().mapped('partner_id').ids)],
            'privacy': 'confidential',
            'recurrency': True,
            'follow_recurrence': True,
            'rrule_type': 'monthly' if self.recurrence == 'monthly' else 'weekly',
            'interval': 2 if self.recurrence == 'biweekly' else 1,
            'event_tz': timezone.zone,
            weekday: True,
        }
        if self.until_date:
            event_vals.update(end_type='end_date', until=self.until_date)
        else:
            event_vals.update(end_type='count', count=self.until_count)
        if self.recurrence == 'monthly':
            event_vals['month_by'] = 'date'
            event_vals['day'] = local_start.day
        token = _CALENDAR_IMPORT.set(True)
        generation = _SERIES_GENERATION.set(True)
        try:
            event = self.env['calendar.event'].create(event_vals)
            recurrence = event.recurrence_id or self.env['calendar.recurrence'].search([
                '|', ('base_event_id', '=', event.id), ('calendar_event_ids', 'in', event.ids),
            ], limit=1)
            occurrences = (recurrence.calendar_event_ids if recurrence else event).filtered('active').sorted('start')
            meetings = self.env['webvue.meeting.minute']
            for occurrence in occurrences:
                vals = self._webvue_meeting_defaults()
                vals.update(
                    start_datetime=occurrence.start,
                    end_datetime=occurrence.stop,
                    meeting_date=self._webvue_local_start(occurrence.start).date(),
                )
                meeting = self.env['webvue.meeting.minute'].create(vals)
                meeting._webvue_link_calendar_event(occurrence)
                meetings |= meeting
        finally:
            _SERIES_GENERATION.reset(generation)
            _CALENDAR_IMPORT.reset(token)
        # One invitation names the series instead of one per occurrence.
        meetings[:1]._webvue_notify_partners(
            self._webvue_participants().mapped('partner_id') - self.env.user.partner_id,
            'meeting_series_invite', self.name, key=f'meeting-series-invite:{self.id}',
        )
        return meetings


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.private
    def _webvue_meeting_series_access_domain(self, company_id, company_ids):
        """Series are visible to their owning-company managers or actual participants."""
        self.ensure_one()
        actor = self.with_context(allowed_company_ids=[company_id, *[item for item in company_ids if item != company_id]])
        service = actor.env['webvue.access.service']
        companies = self.env['res.company'].browse(company_ids)
        readable = [company.id for company in companies
                    if service._webvue_has_capability(actor, 'meetings.read', company=company)]
        occurrence_visibility = self._webvue_meeting_access_domain(company_id, company_ids)
        return [
            ('company_id', 'in', readable), '|',
            *self._webvue_meeting_manager_domain(company_id, company_ids), '|', '|', '|',
            ('organizer_id', '=', self.id),
            ('secretary_id', '=', self.id),
            ('attendee_ids', 'in', self.ids),
            ('meeting_ids', 'any', occurrence_visibility),
        ]
