# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_platform.models.usage_window import (
    DEFAULT_TIMEZONE,
    month_label,
    month_window,
    tenant_timezone,
    trial_window,
)

RIYADH = 'Asia/Riyadh'  # UTC+3 all year
TRIAL_START = datetime(2026, 11, 1, 6, 0)
TRIAL_END = TRIAL_START + timedelta(days=12)  # windows: days 0-5, 5-10, then a short one of 2 days


@tagged('post_install', '-at_install', 'liwan')
class TestUsageWindow(TransactionCase):

    def test_the_month_changes_at_local_midnight(self):
        # 2026-10-31 21:00 UTC is already 2026-11-01 in Riyadh.
        self.assertEqual(
            month_window(datetime(2026, 10, 31, 21, 0), RIYADH),
            (datetime(2026, 10, 31, 21, 0), datetime(2026, 11, 30, 21, 0)),
        )
        self.assertEqual(month_window(datetime(2026, 10, 31, 20, 59, 59), RIYADH)[0], datetime(2026, 9, 30, 21, 0))
        self.assertEqual(month_window(datetime(2026, 11, 30, 20, 59, 59), RIYADH)[1], datetime(2026, 11, 30, 21, 0))

    def test_the_month_follows_other_zones_and_the_year_end(self):
        self.assertEqual(month_window(datetime(2026, 12, 15), 'UTC'), (datetime(2026, 12, 1), datetime(2027, 1, 1)))
        # New York is UTC-5 in winter: the January window starts at 05:00 UTC.
        self.assertEqual(month_window(datetime(2026, 12, 31, 12), 'America/New_York')[1], datetime(2027, 1, 1, 5, 0))

    def test_the_month_label_is_the_local_month(self):
        self.assertEqual(month_label(datetime(2026, 10, 31, 21, 0), RIYADH), '2026-11')
        self.assertEqual(month_label(datetime(2026, 10, 31, 20, 59), RIYADH), '2026-10')

    def test_trial_windows_are_five_days_from_the_start(self):
        for now, window in (
            (TRIAL_START, (TRIAL_START, TRIAL_START + timedelta(days=5))),
            (TRIAL_START + timedelta(days=4, hours=23), (TRIAL_START, TRIAL_START + timedelta(days=5))),
            (TRIAL_START + timedelta(days=5), (TRIAL_START + timedelta(days=5), TRIAL_START + timedelta(days=10))),
            (TRIAL_START + timedelta(days=10), (TRIAL_START + timedelta(days=10), TRIAL_END)),
        ):
            with self.subTest(now=now):
                self.assertEqual(trial_window(now, TRIAL_START, TRIAL_END), window)

    def test_the_last_trial_window_is_cut_at_the_end(self):
        last = trial_window(TRIAL_END - timedelta(seconds=1), TRIAL_START, TRIAL_END)
        self.assertEqual(last, (TRIAL_START + timedelta(days=10), TRIAL_END))

    def test_there_is_no_trial_window_outside_the_trial(self):
        self.assertIsNone(trial_window(TRIAL_END, TRIAL_START, TRIAL_END))
        self.assertIsNone(trial_window(TRIAL_END + timedelta(days=30), TRIAL_START, TRIAL_END))
        self.assertIsNone(trial_window(TRIAL_START - timedelta(seconds=1), TRIAL_START, TRIAL_END))
        self.assertIsNone(trial_window(TRIAL_START, None, None))

    def test_the_tenant_timezone_is_the_root_companys_or_riyadh(self):
        partner = self.env['liwan.entitlement.service']._liwan_profile().root_company_id.partner_id
        partner.tz = False
        self.assertEqual(tenant_timezone(self.env), DEFAULT_TIMEZONE)
        partner.tz = 'Europe/London'
        self.assertEqual(tenant_timezone(self.env), 'Europe/London')
        partner.flush_recordset()
        self.env.cr.execute('UPDATE res_partner SET tz = %s WHERE id = %s', ['Not/AZone', partner.id])
        self.env.invalidate_all()
        self.assertEqual(tenant_timezone(self.env), DEFAULT_TIMEZONE)
