# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, models
from odoo.exceptions import AccessError

from odoo.addons.webvue_core.models.protected_write import is_marked_write, marked

SAUDI_COUNTRY_CODE = 'SA'
SAUDI_TIMEZONE = 'Asia/Riyadh'
# Tenant data in the default locale (Arabic), like the seeded leave types; not a translated UI string.
SAUDI_SCHEDULE_NAME = 'دوام الأحد إلى الخميس'
# Odoo numbers the week from Monday (0), so Sunday is 6.
SAUDI_WORK_DAYS = ('6', '0', '1', '2', '3')
SAUDI_WORK_HOURS = (('morning', 8.0, 12.0), ('afternoon', 13.0, 17.0))
DEFAULT_CALENDAR_MARKER = 'webvue_hr.default_calendar_company_ids'
DEFAULT_CALENDAR_FIELDS = frozenset({'resource_calendar_id'})


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        # A new company's stock schedule was made for it a moment ago and nothing uses it yet.
        companies._webvue_ensure_saudi_schedule(drop_replaced=True)
        return companies

    def write(self, vals):
        if (
            'resource_calendar_id' in vals and not self.env.is_superuser()
            and not is_marked_write(self, DEFAULT_CALENDAR_MARKER, DEFAULT_CALENDAR_FIELDS, vals)
        ):
            raise AccessError(self.env._('use_protected_webvue_default_schedule_operation'))
        result = super().write(vals)
        if 'country_id' in vals and self.env.is_superuser():
            self._webvue_ensure_saudi_schedule()
        return result

    @api.model
    def _webvue_marked_write_fields(self):
        return {**super()._webvue_marked_write_fields(), DEFAULT_CALENDAR_MARKER: DEFAULT_CALENDAR_FIELDS}

    def _webvue_write_default_schedule(self, calendar):
        """Set the company's default work schedule; the caller has already validated ``calendar``."""
        self.ensure_one()
        self.env['webvue.access.service']._webvue_require_capability('hr.shifts.manage')
        if self != self.env.company:
            raise AccessError(self.env._('forbidden'))
        with marked(self.env, {DEFAULT_CALENDAR_MARKER: {self.id}}):
            return self.write({'resource_calendar_id': calendar.id})

    def _webvue_ensure_saudi_schedule(self, drop_replaced=False):
        """Give each Saudi company the Sunday to Thursday schedule as its default, once.

        The xmlid records that a company was provisioned, so a default the company later
        changes is never replaced and a second run creates nothing. Other countries keep
        Odoo's stock default.
        """
        data = self.env['ir.model.data']
        for company in self.filtered(lambda c: c.country_id.code == SAUDI_COUNTRY_CODE):
            name = f'saudi_work_week_{company.id}'
            if data.search_count([('module', '=', 'webvue_hr'), ('name', '=', name)]):
                continue
            calendar = self.env['resource.calendar'].create({
                'name': SAUDI_SCHEDULE_NAME,
                'tz': SAUDI_TIMEZONE,
                'company_id': company.id,
                'attendance_ids': [
                    Command.create({
                        'name': f'{hour_from:g} - {hour_to:g}', 'dayofweek': day, 'day_period': period,
                        'hour_from': hour_from, 'hour_to': hour_to,
                    })
                    for day in SAUDI_WORK_DAYS for period, hour_from, hour_to in SAUDI_WORK_HOURS
                ],
            })
            data.create({
                'module': 'webvue_hr', 'name': name, 'model': 'resource.calendar',
                'res_id': calendar.id, 'noupdate': True,
            })
            replaced = company.resource_calendar_id
            with marked(self.env, {DEFAULT_CALENDAR_MARKER: {company.id}}):
                company.write({'resource_calendar_id': calendar.id})
            if drop_replaced and replaced.company_id == company:
                replaced.unlink()
