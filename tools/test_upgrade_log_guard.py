# Part of Odoo. See LICENSE file for full copyright and licensing details.
from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

import upgrade_log_guard


class UpgradeLogGuardTests(unittest.TestCase):
    def test_ordinary_warning_is_accepted(self):
        self.assertEqual(
            upgrade_log_guard.find_problems(
                '2026-09-20 12:00:00,000 WARNING odoo.module: ordinary warning\n',
            ),
            [],
        )

    def test_provisional_info_constraint_is_accepted(self):
        self.assertEqual(
            upgrade_log_guard.find_problems(
                '2026-09-20 12:00:00,000 INFO odoo.schema: '
                'column "probe" of relation "res_company" contains null values\n',
            ),
            [],
        )

    def test_final_contains_null_warning_is_rejected(self):
        problems = upgrade_log_guard.find_problems(
            '2026-09-20 12:00:00,000 WARNING odoo.schema: '
            'column "probe" of relation "res_company" contains null values\n',
        )
        self.assertEqual(len(problems), 1)
        self.assertIn('contains null values', problems[0][1])

    def test_final_missing_not_null_warning_is_rejected(self):
        problems = upgrade_log_guard.find_problems(
            '2026-09-20 12:00:00,000 WARNING odoo.schema: '
            'Missing not-null constraint on res.company.liwan_ci_required_probe\n',
        )
        self.assertEqual(len(problems), 1)
        self.assertIn('Missing not-null constraint on', problems[0][1])

    def test_errors_and_critical_lines_are_rejected(self):
        problems = upgrade_log_guard.find_problems(
            '2026-09-20 12:00:00,000 ERROR odoo.sql_db: database error\n'
            '2026-09-20 12:00:01,000 CRITICAL odoo.service: stopped\n',
        )
        self.assertEqual(len(problems), 2)

    def test_healthy_log_returns_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'upgrade.log'
            path.write_text('INFO odoo.modules.loading: modules loaded\n', encoding='utf-8')
            self.assertEqual(upgrade_log_guard.main([str(path)]), 0)

    def test_empty_log_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'upgrade.log'
            path.write_text('\n  \n', encoding='utf-8')
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                result = upgrade_log_guard.main([str(path)])
            self.assertEqual(result, 1)
            self.assertIn('empty', output.getvalue())

    def test_missing_log_fails_closed_and_prints_reason(self):
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            result = upgrade_log_guard.main(['/does/not/exist/upgrade.log'])
        self.assertEqual(result, 1)
        self.assertIn('unreadable', output.getvalue())

    def test_unreadable_log_fails_closed_and_prints_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                result = upgrade_log_guard.main([directory])
            self.assertEqual(result, 1)
            self.assertIn('unreadable', output.getvalue())


if __name__ == '__main__':
    unittest.main()
