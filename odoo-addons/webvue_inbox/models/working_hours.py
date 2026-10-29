# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Working hours of the inbox on stock resource calendars: weekly attendances, holidays as time off, a timezone."""
from datetime import datetime, time, timedelta

import pytz

from odoo import api, models

DEFAULT_TIMEZONE = 'Asia/Riyadh'
END_OF_DAY = time(23, 59, 59)


def clock(hours):
    """'HH:MM' of a float hour (24.0 is '24:00')."""
    minutes = round(hours * 60)
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


def hours_of(value):
    """The float hour of an 'HH:MM' clock (the contract validates the shape)."""
    hour, minute = value.split(':')
    return int(hour) + int(minute) / 60


class WebVueInboxWorkingHours(models.AbstractModel):
    _name = 'webvue.inbox.working.hours'
    _description = 'Customer Inbox working hours'
    _webvue_scope = 'global'

    @api.model
    def _webvue_dump(self, calendar):
        """The contract's working hours of a calendar; no calendar is the default timezone with no days (always open)."""
        if not calendar:
            return {'timezone': DEFAULT_TIMEZONE, 'days': [], 'holidays': []}
        zone = pytz.timezone(calendar.tz)
        attendances = calendar.attendance_ids.filtered(lambda attendance: not attendance.display_type)
        return {
            'timezone': calendar.tz,
            'days': [
                {'weekday': int(attendance.dayofweek), 'from': clock(attendance.hour_from), 'to': clock(attendance.hour_to)}
                for attendance in attendances.sorted(lambda attendance: (attendance.dayofweek, attendance.hour_from))
            ],
            'holidays': [
                {
                    'name': leave.name or '',
                    'date_from': pytz.utc.localize(leave.date_from).astimezone(zone).date().isoformat(),
                    'date_to': pytz.utc.localize(leave.date_to).astimezone(zone).date().isoformat(),
                }
                for leave in calendar.leave_ids.filtered(lambda leave: not leave.resource_id).sorted('date_from')
            ],
        }

    @api.model
    def _webvue_calendar_values(self, data):
        """Calendar values (replacing its timezone and weekly hours) for validated contract working hours."""
        return {
            'tz': data['timezone'],
            'attendance_ids': [(5, 0, 0), *(
                (0, 0, {
                    'name': f"{day['weekday']} {day['from']}-{day['to']}", 'dayofweek': str(day['weekday']),
                    'hour_from': hours_of(day['from']), 'hour_to': hours_of(day['to']),
                    'day_period': 'morning' if hours_of(day['from']) < 12 else 'afternoon',
                }) for day in data['days']
            )],
        }

    @api.model
    def _webvue_utc(self, day, moment, zone):
        local = zone.localize(datetime.combine(datetime.strptime(day, '%Y-%m-%d').date(), moment))
        return local.astimezone(pytz.utc).replace(tzinfo=None)

    @api.model
    def _webvue_replace_holidays(self, calendar, holidays):
        """Store the holidays as global time off of the calendar: each covers its local days, from midnight to 23:59:59.

        With the HR time-off application installed, Odoo reads the dates given to a new global time off as the
        user's local time and shifts them to the calendar's timezone; writing them again stores the exact UTC window.
        """
        zone = pytz.timezone(calendar.tz)
        calendar.leave_ids.unlink()
        windows = [{
            'date_from': self._webvue_utc(holiday['date_from'], time.min, zone),
            'date_to': self._webvue_utc(holiday['date_to'], END_OF_DAY, zone),
        } for holiday in holidays]
        leaves = self.env['resource.calendar.leaves'].create([
            {'name': holiday['name'], 'calendar_id': calendar.id, **window} for holiday, window in zip(holidays, windows)
        ])
        for leave, window in zip(leaves, windows):
            leave.write(window)

    @api.model
    def _webvue_write(self, owner, name, data):
        """Store `data` as the working hours of `owner` (settings or a department), creating its calendar on first use."""
        values = self._webvue_calendar_values(data)
        if owner.calendar_id:
            owner.calendar_id.write(values)
        else:
            # In the owner's company, so Odoo's defaults (the full-time hours) read that company's calendar, not the session's.
            owner.calendar_id = self.env['resource.calendar'].with_company(owner.company_id).create({
                'name': name, 'company_id': owner.company_id.id, **values,
            })
        self._webvue_replace_holidays(owner.calendar_id, data['holidays'])
        return owner.calendar_id

    @api.model
    def _webvue_clear(self, owner):
        """Remove the working hours of `owner`: it follows the company's (or, for the company, is always open)."""
        calendar = owner.calendar_id
        owner.calendar_id = False
        calendar.unlink()

    @api.model
    def _webvue_is_open(self, calendar, at):
        """Whether the UTC moment `at` falls in the calendar's work intervals; without hours the inbox is always open."""
        if not calendar or not calendar.attendance_ids.filtered(lambda attendance: not attendance.display_type):
            return True
        zone = pytz.timezone(calendar.tz)
        local = pytz.utc.localize(at).astimezone(zone)
        day_start = zone.localize(datetime.combine(local.date(), time.min))
        day_end = zone.localize(datetime.combine(local.date() + timedelta(days=1), time.min))
        intervals = calendar._work_intervals_batch(day_start, day_end, tz=zone)[False]
        return any(start <= local < stop for start, stop, _meta in intervals)
