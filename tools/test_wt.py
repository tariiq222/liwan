# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import tempfile
import unittest
from pathlib import Path

from wt import WorktreeError, create, database_name, env_content, pick_port, used_ports


class TestWt(unittest.TestCase):
    def test_database_name_matches_scratch_pattern(self):
        for suffix in ('pmo-fix-x', 'web-' + 'a' * 80, 'docs-A_b--c'):
            self.assertRegex(database_name(suffix), r'^nasq_scratch_[a-z0-9_]{1,42}$')

    def test_pick_port_skips_used_and_busy(self):
        self.assertEqual(pick_port(range(10, 15), {10}, lambda p: p != 11), 12)
        with self.assertRaises(WorktreeError):
            pick_port(range(10, 12), {10, 11}, lambda p: True)

    def test_env_content_is_consistent(self):
        text = env_content(3101, 8171, 'nasq_scratch_x')
        self.assertIn('NUXT_ODOO_URL=http://127.0.0.1:8171', text)
        self.assertIn('NUXT_PUBLIC_WS_URL=ws://localhost:8171/websocket', text)
        self.assertEqual(set(map(int, re.findall(r'PORT=(\d+)', text))), {3101, 8171})

    def test_used_ports_reads_sibling_worktrees(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'a').mkdir()
            (Path(tmp) / 'a' / '.env.worktree').write_text(env_content(3105, 8180, 'nasq_scratch_a'), encoding='utf-8')
            self.assertEqual(used_ports(Path(tmp)), {3105, 8180})

    def test_create_rejects_bad_branch_names(self):
        for bad in ('nonsense-thing', 'pmo', 'pmo-Bad_Slug', ''):
            with self.assertRaises(WorktreeError):
                create(bad, 'main', False)


if __name__ == '__main__':
    unittest.main()
