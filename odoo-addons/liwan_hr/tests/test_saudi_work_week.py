# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase

SUNDAY = date(2026, 11, 1)
MONDAY = date(2026, 11, 2)
FRIDAY = date(2026, 11, 6)
SUN_THU = {'6', '0', '1', '2', '3'}


@tagged('post_install', '-at_install', 'liwan')
class TestSaudiWorkWeek(LiwanHrCase):
    """The company default schedule: Sunday to Thursday for a Saudi company, free to change per company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.saudi = cls.env['res.company'].create({'name': 'Saudi Week Co', 'country_id': cls.env.ref('base.sa').id})
        cls.abroad = cls.env['res.company'].create({'name': 'Abroad Week Co', 'country_id': cls.env.ref('base.ae').id})
        cls.sick = cls.env.ref('hr_holidays.l10n_sa_leave_type_sick_leave_0')
        cls.manager = new_test_user(
            cls.env, login='hr_week_mgr', password='hr_week_mgr_pass_123', groups='liwan_core.group_employee',
            company_id=cls.saudi.id, company_ids=[(6, 0, cls.saudi.ids)],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id, 'company_id': cls.saudi.id,
        }])

    def _employee(self, company, name='Week Worker'):
        return self.env['hr.employee'].with_company(company).create({'name': name, 'company_id': company.id})

    def _as_manager(self):
        self.authenticate('hr_week_mgr', 'hr_week_mgr_pass_123')

    def _settings(self):
        return self.api('GET', '/api/v1/hr/shifts/settings').json()

    def _patch(self, **payload):
        return self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'company', **payload})

    def _calendar(self, company, days, name='Custom week'):
        return self.env['resource.calendar'].create({
            'name': name, 'company_id': company.id, 'tz': 'Asia/Riyadh',
            'attendance_ids': [(0, 0, {
                'name': '8 - 16', 'dayofweek': day, 'day_period': 'morning', 'hour_from': 8, 'hour_to': 16,
            }) for day in days],
        })

    def test_saudi_company_defaults_to_sunday_to_thursday_in_riyadh(self):
        calendar = self.saudi.resource_calendar_id
        self.assertEqual(calendar.name, 'دوام الأحد إلى الخميس')
        self.assertEqual(calendar.tz, 'Asia/Riyadh')
        self.assertEqual(calendar.company_id, self.saudi)
        self.assertEqual(set(calendar.attendance_ids.mapped('dayofweek')), SUN_THU)
        self.assertEqual(
            sorted({(line.hour_from, line.hour_to) for line in calendar.attendance_ids}), [(8.0, 12.0), (13.0, 17.0)],
        )

    def test_other_country_keeps_the_stock_default(self):
        # Odoo copies the current company's working days into a new company's stock schedule, so only
        # the LiwanOS provisioning is asserted here: no Saudi schedule and no provisioning marker.
        self.assertEqual(self.abroad.resource_calendar_id.name, 'Standard 40 hours/week')
        self.assertFalse(self.env['ir.model.data'].search_count([
            ('module', '=', 'liwan_hr'), ('name', '=', f'saudi_work_week_{self.abroad.id}'),
        ]))

    def test_country_set_after_creation_provisions_once_and_keeps_a_later_choice(self):
        company = self.env['res.company'].create({'name': 'Late Saudi Co'})
        self.assertEqual(company.resource_calendar_id.name, 'Standard 40 hours/week')
        company.country_id = self.env.ref('base.sa')
        provisioned = company.resource_calendar_id
        self.assertEqual(provisioned.name, 'دوام الأحد إلى الخميس')
        company._liwan_ensure_saudi_schedule()
        self.assertEqual(company.resource_calendar_id, provisioned)
        self.assertEqual(self.env['resource.calendar'].search_count([
            ('company_id', '=', company.id), ('name', '=', 'دوام الأحد إلى الخميس'),
        ]), 1)
        chosen = self._calendar(company, '0123456')
        company.resource_calendar_id = chosen
        company._liwan_ensure_saudi_schedule()
        self.assertEqual(company.resource_calendar_id, chosen)

    def test_sunday_to_monday_leave_counts_two_days_on_the_default(self):
        employee = self._employee(self.saudi)
        self.assertEqual(employee.resource_calendar_id, self.saudi.resource_calendar_id)
        leave = self.env['hr.leave'].with_company(self.saudi).create({
            'employee_id': employee.id, 'holiday_status_id': self.sick.id,
            'request_date_from': SUNDAY, 'request_date_to': MONDAY,
        })
        self.assertEqual(leave.number_of_days, 2)

    def test_a_monday_to_friday_schedule_counts_sunday_to_monday_as_one_day(self):
        employee = self._employee(self.abroad)
        employee.resource_calendar_id = self.env['resource.calendar'].create({
            'name': 'Monday to Friday', 'company_id': self.abroad.id, 'tz': 'UTC',
            'attendance_ids': [(0, 0, {'name': f'day {day}', 'dayofweek': day, 'day_period': 'morning', 'hour_from': 8, 'hour_to': 16})
                               for day in ('0', '1', '2', '3', '4')],
        })
        days = employee._get_work_days_data_batch(
            datetime(2026, 11, 1), datetime(2026, 11, 2, 23, 59, 59), compute_leaves=False,
        )[employee.id]['days']
        self.assertEqual(days, 1)

    def test_settings_expose_the_company_default_schedule(self):
        self._as_manager()
        body = self._settings()
        self.assertEqual(body['default_schedule'], {'id': self.saudi.resource_calendar_id.id, 'name': 'دوام الأحد إلى الخميس'})
        self.assertEqual(body['company_timezone'], 'Asia/Riyadh')

    def test_manager_changes_the_default_and_a_seven_day_week_counts_friday(self):
        self._as_manager()
        friday_employee = self._employee(self.saudi, 'Friday Before')
        friday = (datetime(2026, 11, 6), datetime(2026, 11, 6, 23, 59, 59))
        self.assertEqual(friday_employee._get_work_days_data_batch(*friday, compute_leaves=False)[friday_employee.id]['days'], 0)
        every_day = self._calendar(self.saudi, '0123456', 'Every day')
        saved = self._patch(default_schedule_id=every_day.id, revision=0)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['default_schedule'], {'id': every_day.id, 'name': 'Every day'})
        self.assertEqual(saved.json()['revision'], 1)
        self.assertEqual(self.saudi.resource_calendar_id, every_day)
        new_employee = self._employee(self.saudi, 'Friday After')
        self.assertEqual(new_employee._get_work_days_data_batch(*friday, compute_leaves=False)[new_employee.id]['days'], 1)
        # Odoo does not move existing employees: the one created before keeps its own schedule.
        self.assertNotEqual(friday_employee.resource_calendar_id, every_day)

    def test_patch_without_a_schedule_leaves_the_default_unchanged(self):
        self._as_manager()
        before = self.saudi.resource_calendar_id
        self.assertEqual(self._patch(revision=0).status_code, 200)
        self.assertEqual(self.saudi.resource_calendar_id, before)

    def test_foreign_archived_and_generated_schedules_are_refused(self):
        self._as_manager()
        before = self.saudi.resource_calendar_id
        archived = self._calendar(self.saudi, '0123', 'Archived')
        archived.active = False
        generated = self._calendar(self.saudi, '0123', 'Generated')
        generated.auto_generate = True
        for calendar in (self._calendar(self.abroad, '0123', 'Foreign'), archived, generated):
            response = self._patch(default_schedule_id=calendar.id, revision=0)
            self.assertEqual((response.status_code, response.json()['field']), (422, 'default_schedule_id'), response.text)
        self.assertEqual(self._patch(default_schedule_id=0, revision=0).status_code, 422)
        self.assertEqual(self.saudi.resource_calendar_id, before)
        self.assertFalse(self.env['liwan.hr.shift.settings'].search([('company_id', '=', self.saudi.id)]))

    def test_stale_revision_conflicts_and_keeps_the_default(self):
        self._as_manager()
        before = self.saudi.resource_calendar_id
        other = self._calendar(self.saudi, '0123456', 'Other week')
        self.assertEqual(self._patch(default_schedule_id=other.id, revision=0).status_code, 200)
        stale = self._patch(default_schedule_id=before.id, revision=0)
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        self.assertEqual(self.saudi.resource_calendar_id, other)

    def test_default_needs_the_manage_capability(self):
        new_test_user(
            self.env, login='hr_week_plain', password='hr_week_plain_pass_123', groups='liwan_core.group_employee',
            company_id=self.saudi.id, company_ids=[(6, 0, self.saudi.ids)],
        )
        self.authenticate('hr_week_plain', 'hr_week_plain_pass_123')
        other = self._calendar(self.saudi, '0123456', 'Denied week')
        self.assertEqual(self._patch(default_schedule_id=other.id, revision=0).status_code, 403)
        self.assertNotEqual(self.saudi.resource_calendar_id, other)

    def test_direct_orm_write_of_the_default_is_refused_outside_the_operation(self):
        other = self._calendar(self.saudi, '0123456', 'Direct week')
        with self.assertRaises(AccessError):
            self.saudi.with_user(self.manager).write({'resource_calendar_id': other.id})

    def test_a_shifts_manager_writes_no_other_company_field(self):
        # The company write ACL the shifts managers hold only serves the default-schedule operation.
        branch = self.env['res.company'].create({'name': 'Saudi Week Branch', 'parent_id': self.saudi.id})
        self.manager.write({'company_ids': [(4, branch.id)]})
        for company in (self.saudi, branch):
            for vals in ({'vat': '300000000000003'}, {'user_ids': [(4, self.manager.id)]}, {'currency_id': self.env.ref('base.USD').id}):
                with self.subTest(company=company.name, vals=vals), self.assertRaises(AccessError):
                    company.with_user(self.manager).with_company(self.saudi).write(vals)

    def test_the_replaced_stock_schedule_is_not_left_behind(self):
        calendars = self.env['resource.calendar'].search([('company_id', '=', self.saudi.id)])
        self.assertEqual(calendars, self.saudi.resource_calendar_id)
