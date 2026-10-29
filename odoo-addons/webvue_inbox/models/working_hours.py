# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Working hours of the inbox: weekly ranges and holidays in a timezone, owned by the company settings or a department."""
from datetime import date, timezone
from zoneinfo import ZoneInfo

from odoo import api, fields, models

from .constants import DEFAULT_TIMEZONE

DAY_MINUTES = 24 * 60


def clock(minutes):
    """'HH:MM' of a minute of the day (1440 is '24:00')."""
    return f'{minutes // 60:02d}:{minutes % 60:02d}'


def minutes_of(value):
    """The minute of the day of an 'HH:MM' clock (the contract validates the shape)."""
    hour, minute = value.split(':')
    return int(hour) * 60 + int(minute)


class WebVueInboxHoursRange(models.Model):
    """One weekly range (Monday is 0) of the working hours of the company settings or of a department."""
    _name = 'webvue.inbox.hours.range'
    _description = 'Customer Inbox working hours range'
    _order = 'weekday, start_minute, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', compute='_compute_company', store=True, index=True)
    settings_id = fields.Many2one('webvue.inbox.settings', index=True, ondelete='cascade')
    department_id = fields.Many2one('webvue.inbox.department', index=True, ondelete='cascade')
    weekday = fields.Integer(required=True)
    start_minute = fields.Integer(required=True)
    end_minute = fields.Integer(required=True)

    _owner_check = models.Constraint('CHECK((settings_id IS NULL) <> (department_id IS NULL))', 'A range has one owner.')
    _range_check = models.Constraint(
        f'CHECK(weekday BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= {DAY_MINUTES} AND start_minute < end_minute)',
        'A range is within one day and ends after it starts.',
    )

    @api.depends('settings_id.company_id', 'department_id.company_id')
    def _compute_company(self):
        for row in self:
            row.company_id = row.settings_id.company_id or row.department_id.company_id


class WebVueInboxHoursHoliday(models.Model):
    """A holiday of the working hours: whole local days, from `date_from` to `date_to` inclusive."""
    _name = 'webvue.inbox.hours.holiday'
    _description = 'Customer Inbox working hours holiday'
    _order = 'date_from, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', compute='_compute_company', store=True, index=True)
    settings_id = fields.Many2one('webvue.inbox.settings', index=True, ondelete='cascade')
    department_id = fields.Many2one('webvue.inbox.department', index=True, ondelete='cascade')
    name = fields.Char(required=True)
    date_from = fields.Date(required=True)
    date_to = fields.Date(required=True)

    _owner_check = models.Constraint('CHECK((settings_id IS NULL) <> (department_id IS NULL))', 'A holiday has one owner.')
    _dates_check = models.Constraint('CHECK(date_from <= date_to)', 'A holiday ends on or after its start.')

    @api.depends('settings_id.company_id', 'department_id.company_id')
    def _compute_company(self):
        for row in self:
            row.company_id = row.settings_id.company_id or row.department_id.company_id


class WebVueInboxWorkingHours(models.AbstractModel):
    """Reads, stores and evaluates the working hours of an owner (company settings or department)."""
    _name = 'webvue.inbox.working.hours'
    _description = 'Customer Inbox working hours'
    _webvue_scope = 'global'

    @api.model
    def _webvue_dump(self, owner):
        """The contract's working hours: timezone, weekly ranges and holidays."""
        return {
            'timezone': owner.hours_timezone,
            'days': [
                {'weekday': row.weekday, 'from': clock(row.start_minute), 'to': clock(row.end_minute)}
                for row in owner.hours_range_ids
            ],
            'holidays': [
                {'name': row.name, 'date_from': row.date_from.isoformat(), 'date_to': row.date_to.isoformat()}
                for row in owner.holiday_ids
            ],
        }

    @api.model
    def _webvue_write(self, owner, data):
        """Replace the working hours of `owner` with validated contract `data`; a department then has hours of its own."""
        values = {
            'hours_timezone': data['timezone'],
            'hours_range_ids': [(5, 0, 0), *((0, 0, {
                'weekday': day['weekday'], 'start_minute': minutes_of(day['from']), 'end_minute': minutes_of(day['to']),
            }) for day in data['days'])],
            'holiday_ids': [(5, 0, 0), *((0, 0, {
                'name': holiday['name'], 'date_from': holiday['date_from'], 'date_to': holiday['date_to'],
            }) for holiday in data['holidays'])],
        }
        if 'hours_own' in owner._fields:
            values['hours_own'] = True
        owner.write(values)

    @api.model
    def _webvue_clear(self, department):
        """Drop the department's own hours: it follows the company's again."""
        department.write({
            'hours_own': False, 'hours_range_ids': [(5, 0, 0)], 'holiday_ids': [(5, 0, 0)],
            'hours_timezone': DEFAULT_TIMEZONE,
        })

    @api.model
    def _webvue_is_open(self, owner, at):
        """Whether the UTC moment `at` is inside the owner's hours: no ranges means always open, a holiday closes its local days."""
        if not owner.hours_range_ids:
            return True
        local = at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(owner.hours_timezone))
        day = date(local.year, local.month, local.day)
        if any(holiday.date_from <= day <= holiday.date_to for holiday in owner.holiday_ids):
            return False
        minute = local.hour * 60 + local.minute
        return any(row.weekday == local.weekday() and row.start_minute <= minute < row.end_minute for row in owner.hours_range_ids)
