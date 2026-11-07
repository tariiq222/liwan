# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.serializers.common import iso


@tagged('post_install', '-at_install', 'liwan')
class TestCommonSerializer(TransactionCase):

    def test_iso_default_seconds_dates_and_empty(self):
        self.assertEqual(iso(datetime(2030, 1, 15, 12, 30, 45, 123456)), '2030-01-15T12:30:45Z')
        self.assertEqual(iso(date(2030, 1, 15)), '2030-01-15T00:00:00Z')
        self.assertIsNone(iso(False))
        self.assertIsNone(iso(None))

    def test_iso_microseconds_distinguishes_writes_in_same_second(self):
        first = datetime(2030, 1, 15, 12, 30, 45, 123456)
        second = first.replace(microsecond=123457)
        self.assertEqual(iso(first, timespec='microseconds'), '2030-01-15T12:30:45.123456Z')
        self.assertNotEqual(iso(first, timespec='microseconds'), iso(second, timespec='microseconds'))
        self.assertEqual(iso(first.replace(microsecond=0), timespec='microseconds'), '2030-01-15T12:30:45.000000Z')
