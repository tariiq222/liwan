# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import BaseCase, tagged

from odoo.addons.liwan_inbox.models.hours_text import ALWAYS_OPEN, hours_sentence
from odoo.addons.liwan_inbox.models.presets import fill_hours

# Monday is 0, so Sunday is 6.
SUN, MON, TUE, WED, THU, FRI, SAT = 6, 0, 1, 2, 3, 4, 5
NINE_TO_NINE = (9 * 60, 21 * 60)


@tagged('post_install', '-at_install', 'liwan')
class TestHoursText(BaseCase):

    def test_no_ranges_means_always_open(self):
        self.assertEqual(hours_sentence([]), ALWAYS_OPEN)

    def test_consecutive_days_with_the_same_hours_are_grouped_from_sunday(self):
        week = [(day, *NINE_TO_NINE) for day in (MON, THU, SUN, TUE, WED)]
        self.assertEqual(hours_sentence(week), 'من الأحد إلى الخميس، من 9:00 إلى 21:00')

    def test_one_and_two_days_are_named(self):
        self.assertEqual(hours_sentence([(SAT, 8 * 60, 12 * 60 + 30)]), 'السبت، من 8:00 إلى 12:30')
        self.assertEqual(hours_sentence([(SUN, *NINE_TO_NINE), (MON, *NINE_TO_NINE)]), 'الأحد والاثنين، من 9:00 إلى 21:00')

    def test_different_hours_and_gaps_make_separate_groups(self):
        ranges = [(SUN, *NINE_TO_NINE), (MON, *NINE_TO_NINE), (TUE, *NINE_TO_NINE), (THU, 9 * 60, 15 * 60), (SAT, *NINE_TO_NINE)]
        self.assertEqual(
            hours_sentence(ranges),
            'من الأحد إلى الثلاثاء، من 9:00 إلى 21:00؛ الخميس، من 9:00 إلى 15:00؛ السبت، من 9:00 إلى 21:00',
        )

    def test_several_ranges_in_one_day_are_listed_in_time_order(self):
        ranges = [(SUN, 16 * 60, 21 * 60), (SUN, 9 * 60, 13 * 60)]
        self.assertEqual(hours_sentence(ranges), 'الأحد، من 9:00 إلى 13:00 ومن 16:00 إلى 21:00')

    def test_identical_ranges_in_one_day_print_once(self):
        self.assertEqual(hours_sentence([(SUN, *NINE_TO_NINE), (SUN, *NINE_TO_NINE)]), 'الأحد، من 9:00 إلى 21:00')

    def test_a_range_ending_at_midnight_prints_as_24_00(self):
        self.assertEqual(hours_sentence([(SUN, 8 * 60, 24 * 60)]), 'الأحد، من 8:00 إلى 24:00')

    def test_saturday_does_not_join_sunday_across_the_week_start(self):
        self.assertEqual(
            hours_sentence([(SAT, *NINE_TO_NINE), (SUN, *NINE_TO_NINE)]),
            'الأحد، من 9:00 إلى 21:00؛ السبت، من 9:00 إلى 21:00',
        )

    def test_the_placeholder_is_replaced_in_every_nested_text(self):
        value = {'a': ['x {hours}', ('s', 'y {hours}.')], 'b': 3}
        self.assertEqual(fill_hours(value, 'H'), {'a': ['x H', ('s', 'y H.')], 'b': 3})
