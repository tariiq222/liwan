# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from odoo.addons.liwan_api.models.public_limit import IDLE_ROW_AGE, PUBLIC_LIMIT_WINDOW
from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan')
class TestPublicLimit(LiwanApiCase):

    def setUp(self):
        super().setUp()
        self.limits = self.env['liwan.api.public.limit']
        self.now = fields.Datetime.now()

    def test_reads_count_up_inside_the_window(self):
        counts = [self.limits._liwan_count_read('t.page', 7, self.now) for _ in range(3)]
        self.assertEqual(counts, [1, 2, 3])

    def test_each_scope_and_record_keeps_its_own_count(self):
        self.limits._liwan_count_read('t.page', 7, self.now)
        self.assertEqual(self.limits._liwan_count_read('t.other', 7, self.now), 1)
        self.assertEqual(self.limits._liwan_count_read('t.page', 8, self.now), 1)
        self.assertEqual(self.limits._liwan_count_read('t.page', 7, self.now), 2)

    def test_the_count_restarts_when_the_window_turns(self):
        for _ in range(3):
            self.limits._liwan_count_read('t.page', 7, self.now)
        later = self.now + PUBLIC_LIMIT_WINDOW + timedelta(seconds=1)
        self.assertEqual(self.limits._liwan_count_read('t.page', 7, later), 1)
        self.assertEqual(self.limits._liwan_count_read('t.page', 7, later), 2)

    def test_the_vacuum_drops_only_idle_rows(self):
        self.limits._liwan_count_read('t.old', 1, self.now - IDLE_ROW_AGE - timedelta(hours=1))
        self.limits._liwan_count_read('t.new', 1, self.now)
        self.limits._gc_idle_counters()
        self.assertEqual(self.limits.search([('scope', 'in', ['t.old', 't.new'])]).mapped('scope'), ['t.new'])
