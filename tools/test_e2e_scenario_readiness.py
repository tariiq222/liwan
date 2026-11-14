# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from e2e_scenario_readiness import assess, bucket, main, ready, rows


def row(scenario, status):
    return f'| {scenario} | Scenario | staff1 | Expected | `page /crm` | {status} | a note with \\| a pipe |'


READY = '\n'.join([
    '| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    row('CRM-1', 'automated'), row('CRM-2', 'manual 2026-11-10'), row('CRM-3', 'decision'), row('CRM-4', 'gap'),
    row('CRM-5', 'dropped'),
])
BLOCKED = '\n'.join([row('INB-1', 'fail'), row('INB-2', 'planned'), row('INB-3', 'covered'), row('INB-4', 'automated')])


class TestScenarioReadiness(unittest.TestCase):
    def report(self, registers, *argv):
        with tempfile.TemporaryDirectory() as folder:
            for name, text in registers.items():
                Path(folder, f'{name}.md').write_text(text, encoding='utf-8')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(list(argv), Path(folder))
        return code, output.getvalue()

    def test_rows_read_the_status_cell_past_an_escaped_pipe(self):
        self.assertEqual(rows(READY)[:2], [('CRM-1', 'automated'), ('CRM-2', 'manual 2026-11-10')])

    def test_a_register_without_failing_or_planned_rows_is_ready(self):
        counts, blocking = assess(READY)
        self.assertTrue(ready(counts))
        self.assertEqual(blocking, {})
        self.assertEqual((counts['gap'], counts['decision']), (1, 1))

    def test_failing_planned_and_undefined_statuses_block_and_are_named(self):
        counts, blocking = assess(BLOCKED)
        self.assertFalse(ready(counts))
        self.assertEqual(blocking, {'fail': ['INB-1'], 'planned': ['INB-2'], 'unknown status': ['INB-3']})

    def test_an_old_manual_pass_blocks_only_when_a_date_is_asked(self):
        self.assertEqual(bucket('manual 2026-11-10'), 'manual')
        self.assertEqual(bucket('manual 2026-11-10', '2026-11-10'), 'manual')
        self.assertEqual(bucket('manual 2026-11-10', '2026-11-11'), 'stale manual')
        self.assertEqual(bucket('manual', '2026-11-11'), 'stale manual')

    def test_a_register_without_rows_is_not_ready(self):
        self.assertFalse(ready(assess('# An empty register')[0]))

    def test_check_fails_only_for_a_reported_register_that_is_not_ready(self):
        registers = {'crm': READY, 'inbox': BLOCKED, 'README': 'guide'}
        self.assertEqual(self.report(registers, '--check', 'crm'), (0, (
            'crm: ready (5 rows: 1 automated, 1 decision, 1 dropped, 1 gap, 1 manual)\n'
            'total: 1/1 registers ready\n')))
        code, text = self.report(registers, '--check', '--ids')
        self.assertEqual(code, 1)
        self.assertIn('inbox: not ready, 3 of 4 rows (1 automated, 1 fail, 1 planned, 1 unknown status)\n'
                      '  fail: INB-1\n  planned: INB-2\n  unknown status: INB-3\n', text)
        self.assertIn('total: 1/2 registers ready', text)
        self.assertEqual(self.report(registers)[0], 0)

    def test_an_unknown_register_name_is_refused(self):
        with self.assertRaises(SystemExit) as refused:
            self.report({'crm': READY}, 'sales')
        self.assertIn('unknown registers: sales; available: crm', str(refused.exception))


if __name__ == '__main__':
    unittest.main()
