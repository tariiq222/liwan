#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vitest_skip_gate import main, problems


def report(directory: str, *statuses: str, name: str = 'report.json') -> Path:
    tests = [{'fullName': f'suite test{index}', 'status': status} for index, status in enumerate(statuses)]
    path = Path(directory) / name
    path.write_text(json.dumps({'testResults': [{'name': '/repo/a.test.ts', 'assertionResults': tests}]}))
    return path


class VitestSkipGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def test_all_passed_is_clean(self):
        self.assertEqual(main([str(report(self.temp.name, 'passed', 'passed'))]), 0)

    def test_skipped_pending_and_todo_are_listed_by_file_and_name(self):
        found = problems(report(self.temp.name, 'passed', 'skipped', 'pending', 'todo'))
        self.assertEqual(found, ['/repo/a.test.ts > suite test1 (skipped)', '/repo/a.test.ts > suite test2 (pending)',
                                 '/repo/a.test.ts > suite test3 (todo)'])
        self.assertEqual(main([str(report(self.temp.name, 'skipped'))]), 1)

    def test_missing_unreadable_and_empty_reports_fail(self):
        self.assertEqual(main([str(Path(self.temp.name) / 'absent.json')]), 1)
        broken = Path(self.temp.name) / 'broken.json'
        broken.write_text('{not json')
        self.assertEqual(main([str(broken)]), 1)
        self.assertEqual(main([str(report(self.temp.name, name='empty.json'))]), 1)

    def test_one_bad_report_fails_the_whole_run(self):
        good = report(self.temp.name, 'passed', name='good.json')
        bad = report(self.temp.name, 'skipped', name='bad.json')
        self.assertEqual(main([str(good), str(bad)]), 1)

    def test_no_arguments_is_a_usage_error(self):
        self.assertEqual(main([]), 2)


if __name__ == '__main__':
    unittest.main()
