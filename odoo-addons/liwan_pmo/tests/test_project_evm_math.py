# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged
from odoo.tests.common import BaseCase

from odoo.addons.liwan_pmo.models.project_evm_math import (
    CURVE_MAX_POINTS,
    EvmLine,
    compute_evm,
    planned_curve,
    planned_fraction,
)

D = date
TODAY = D(2026, 3, 15)


def worked_example_lines():
    """Four equal shares of a 120 000 budget, read on 2026-03-15; the PR body quotes this example."""
    return [
        EvmLine(0.25, D(2026, 3, 1), D(2026, 3, 11), 100),   # finished: planned 100%, earned 100%
        EvmLine(0.25, D(2026, 3, 5), D(2026, 3, 25), 40),    # half way through its dates, 40% earned
        EvmLine(0.25, D(2026, 3, 10), D(2026, 3, 20), 0),    # half way through its dates, nothing earned
        EvmLine(0.25, D(2026, 3, 20), D(2026, 3, 30), 0),    # not started
    ]


@tagged('post_install', '-at_install', 'liwan')
class TestProjectEvmMath(BaseCase):

    def test_planned_fraction_before_inside_and_after_the_dates(self):
        start, end = D(2026, 3, 1), D(2026, 3, 11)
        self.assertEqual(planned_fraction(start, end, D(2026, 2, 20)), 0.0)
        self.assertEqual(planned_fraction(start, end, start), 0.0)
        self.assertEqual(planned_fraction(start, end, D(2026, 3, 6)), 0.5)
        self.assertEqual(planned_fraction(start, end, end), 1.0)
        self.assertEqual(planned_fraction(start, end, D(2026, 4, 1)), 1.0)

    def test_planned_fraction_of_incomplete_dates(self):
        end = D(2026, 3, 11)
        self.assertEqual(planned_fraction(None, end, D(2026, 3, 10)), 0.0)
        self.assertEqual(planned_fraction(None, end, end), 1.0)
        self.assertEqual(planned_fraction(end, end, end), 1.0)
        self.assertIsNone(planned_fraction(D(2026, 3, 1), None, TODAY))
        self.assertIsNone(planned_fraction(None, None, TODAY))

    def test_worked_example(self):
        result = compute_evm(120000, 48000, worked_example_lines(), TODAY)
        self.assertEqual(
            {key: result[key] for key in ('bac', 'pv', 'ev', 'ac', 'sv', 'cv', 'spi', 'cpi', 'eac', 'etc', 'vac', 'tcpi')},
            {
                'bac': 120000.0, 'pv': 60000.0, 'ev': 42000.0, 'ac': 48000.0, 'sv': -18000.0, 'cv': -6000.0,
                'spi': 0.7, 'cpi': 0.88, 'eac': 137142.86, 'etc': 89142.86, 'vac': -17142.86, 'tcpi': 1.08,
            },
        )
        self.assertEqual(result['undated_count'], 0)

    def test_binary_progress_counts_only_finished_lines(self):
        lines = [EvmLine(line.share, line.start, line.end, 100 if line.percent == 100 else 0) for line in worked_example_lines()]
        result = compute_evm(120000, 48000, lines, TODAY)
        self.assertEqual((result['ev'], result['spi'], result['cpi']), (30000.0, 0.5, 0.63))

    def test_every_zero_divisor_answers_none(self):
        lines = worked_example_lines()
        before = compute_evm(120000, 0, lines, D(2026, 2, 1))
        self.assertIsNone(before['spi'])                       # nothing planned yet: PV is 0
        self.assertIsNone(before['cpi'])                       # nothing spent yet: AC is 0
        self.assertIsNone(before['eac'])
        self.assertIsNone(before['etc'])
        self.assertIsNone(before['vac'])
        nothing_earned = compute_evm(120000, 5000, [EvmLine(1.0, D(2026, 3, 1), D(2026, 3, 11), 0)], TODAY)
        self.assertEqual(nothing_earned['cpi'], 0.0)
        self.assertIsNone(nothing_earned['eac'])              # CPI 0: the forecast would be infinite
        spent_all = compute_evm(120000, 120000, lines, TODAY)
        self.assertIsNone(spent_all['tcpi'])                   # BAC - AC is 0
        overspent = compute_evm(120000, 130000, lines, TODAY)
        self.assertIsNone(overspent['tcpi'])                   # BAC - AC is negative

    def test_no_budget_keeps_the_schedule_index_only(self):
        result = compute_evm(0, 900, worked_example_lines(), TODAY)
        self.assertEqual(result['spi'], 0.7)
        self.assertEqual((result['pv'], result['ev'], result['sv']), (0.0, 0.0, 0.0))
        for key in ('cv', 'cpi', 'eac', 'etc', 'vac', 'tcpi'):
            self.assertIsNone(result[key], key)

    def test_undated_lines_leave_pv_and_ev_and_are_counted(self):
        lines = [*worked_example_lines(), EvmLine(0.0, None, None, 100)]
        result = compute_evm(120000, 48000, lines, TODAY)
        self.assertEqual((result['pv'], result['ev'], result['undated_count']), (60000.0, 42000.0, 1))
        done_without_dates = compute_evm(1000, 100, [EvmLine(1.0, None, None, 100)], TODAY)
        self.assertEqual((done_without_dates['ev'], done_without_dates['spi'], done_without_dates['undated_count']), (0.0, None, 1))

    def test_a_removed_task_keeps_its_planned_value_and_earns_nothing(self):
        lines = worked_example_lines()
        lines[0] = EvmLine(lines[0].share, lines[0].start, lines[0].end, 0)
        result = compute_evm(120000, 48000, lines, TODAY)
        self.assertEqual((result['pv'], result['ev']), (60000.0, 12000.0))

    def test_money_rounds_half_up_to_the_currency_decimals(self):
        lines = [EvmLine(1 / 3, D(2026, 3, 1), D(2026, 3, 11), 100), EvmLine(2 / 3, D(2026, 3, 1), D(2026, 3, 11), 0)]
        self.assertEqual(compute_evm(100, 10, lines, TODAY, decimals=2)['ev'], 33.33)
        self.assertEqual(compute_evm(100, 10, lines, TODAY, decimals=0)['ev'], 33.0)
        self.assertEqual(compute_evm(0.05, 0, [EvmLine(1.0, D(2026, 3, 1), D(2026, 3, 11), 50)], TODAY, decimals=2)['ev'], 0.03)

    def test_planned_curve_is_weekly_and_ends_on_the_last_planned_date(self):
        curve = planned_curve(worked_example_lines(), 120000, 2)
        self.assertEqual(curve[0], {'date': '2026-03-01', 'pv': 0.0})
        self.assertEqual(curve[-1], {'date': '2026-03-30', 'pv': 120000.0})
        self.assertEqual([point['date'] for point in curve], ['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29', '2026-03-30'])
        self.assertEqual([curve[2]['date'], curve[2]['pv']], ['2026-03-15', 60000.0])
        self.assertEqual(planned_curve([EvmLine(1.0, None, None, 0)], 100, 2), [])

    def test_a_long_plan_is_capped(self):
        curve = planned_curve([EvmLine(1.0, D(2020, 1, 1), D(2030, 1, 1), 0)], 100, 2)
        self.assertLessEqual(len(curve), CURVE_MAX_POINTS)
        self.assertEqual(curve[-1]['date'], '2030-01-01')
