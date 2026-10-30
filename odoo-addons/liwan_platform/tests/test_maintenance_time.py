# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pure scheduling tests also runnable directly without an Odoo database."""
import importlib.util
from datetime import datetime
from pathlib import Path
from unittest import TestCase, main

_spec = importlib.util.spec_from_file_location(
    'maintenance_time', Path(__file__).parents[1] / 'models' / 'maintenance_time.py',
)


class TestMaintenanceTime(TestCase):
    def setUp(self):
        self.time = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(self.time)

    def test_iana_wall_time_is_converted_to_utc(self):
        self.assertEqual(self.time.local_to_utc('2030-01-01T02:30', 'Asia/Riyadh'), datetime(2029, 12, 31, 23, 30))

    def test_nonexistent_and_ambiguous_dst_time_rejected(self):
        for value in ('2030-03-31T01:30', '2030-10-27T01:30'):
            with self.assertRaises(ValueError):
                self.time.local_to_utc(value, 'Europe/London')

    def test_invalid_zone_and_non_wall_input_rejected(self):
        for value, zone in [('2030-01-01T00:00', 'Mars/Unknown'), ('2030-01-01T00:00Z', 'UTC')]:
            with self.assertRaises(ValueError):
                self.time.local_to_utc(value, zone)

    def test_recurring_window_uses_next_week_and_meets_deadline(self):
        now = datetime(2030, 1, 1, 0, 0)
        result = self.time.next_window(now, 'Asia/Riyadh', 1, 240, 60, datetime(2030, 1, 2))
        self.assertEqual(result, datetime(2030, 1, 1, 1, 0))
        with self.assertRaises(ValueError):
            self.time.next_window(now, 'Asia/Riyadh', 2, 240, 60, datetime(2030, 1, 1, 1))

    def test_window_must_finish_by_deadline(self):
        with self.assertRaises(ValueError):
            self.time.validate_window(datetime(2030, 1, 1, 1), 60, 120, datetime(2030, 1, 1, 1, 30), datetime(2030, 1, 1))
        with self.assertRaises(ValueError):
            self.time.validate_window(datetime(2030, 1, 1, 1), 1, 120, datetime(2030, 1, 2), datetime(2030, 1, 1))


if __name__ == '__main__':
    main()
