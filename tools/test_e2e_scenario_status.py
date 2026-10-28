# Part of Odoo. See LICENSE file for full copyright and licensing details.
import tempfile
import unittest
from pathlib import Path

from e2e_scenario_status import apply, parse, update_row

ROW = '| HR-12 | Withdraw | staff1 | Removed | `page /hr` | planned | old note |'


class TestScenarioStatus(unittest.TestCase):
    def test_update_row_sets_status_and_keeps_old_note(self):
        self.assertEqual(update_row(ROW, 'manual 2026-10-28', 'done in UI'),
                         '| HR-12 | Withdraw | staff1 | Removed | `page /hr` | manual 2026-10-28 | done in UI; old note |')

    def test_update_row_keeps_full_notes_when_the_note_is_already_there(self):
        row = '| HR-12 | Withdraw | staff1 | Removed | `page /hr` | fail | #151; request remains pending |'
        self.assertIn('| gap | #151; request remains pending |', update_row(row, 'gap', '#151'))

    def test_update_row_escapes_pipes_in_the_note(self):
        self.assertIn('page 1 \\| 2', update_row(ROW, 'fail', 'page 1 | 2'))

    def test_parse_refuses_an_unknown_status(self):
        with self.assertRaises(SystemExit):
            parse('HR-12\tpassed\tnote')

    def test_apply_refuses_an_unknown_id(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'hr.md').write_text(ROW, encoding='utf-8')
            with self.assertRaises(SystemExit):
                apply([('HR-99', 'manual', 'x')], Path(folder))
            self.assertEqual(apply([('HR-12', 'gap', '#151')], Path(folder)), ['hr.md'])
            self.assertIn('| gap | #151; old note |', Path(folder, 'hr.md').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
