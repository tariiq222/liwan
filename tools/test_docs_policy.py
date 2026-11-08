# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from docs_policy import find_missing, main

KNOWN = {
    'tools', 'tools/real.py', 'docs', 'docs/a.md',
    'odoo-addons', 'odoo-addons/liwan_hr', 'odoo-addons/liwan_hr/tests', 'odoo-addons/liwan_hr/tests/common.py',
}


class TestDocsPolicy(unittest.TestCase):
    def test_flags_missing_file_reference(self):
        text = 'Edit `apps/web/app/composables/useNav.ts` and `tools/real.py`.'
        self.assertEqual(find_missing('docs/x.md', text, KNOWN), [(1, 'apps/web/app/composables/useNav.ts')])

    def test_flags_missing_markdown_link_relative_to_doc(self):
        self.assertEqual(find_missing('docs/x.md', '[a](a.md) [b](gone.md)', KNOWN), [(1, 'gone.md')])

    def test_accepts_addon_shorthand(self):
        self.assertEqual(find_missing('CLAUDE.md', '`liwan_hr/tests/common.py`', KNOWN), [])

    def test_bare_name_does_not_match_by_shorthand(self):
        self.assertEqual(find_missing('docs/x.md', '`common.py`', KNOWN), [(1, 'common.py')])

    def test_strips_line_suffix(self):
        text = '`tools/nope.py:3` `tools/nope2.py:3-9` `tools/real.py:12`'
        self.assertEqual(find_missing('docs/x.md', text, KNOWN), [(1, 'tools/nope.py'), (1, 'tools/nope2.py')])

    def test_ignores_placeholders_globs_routes_and_commands(self):
        text = '`apps/web/app/modules/<app>/manifest.ts` `odoo-addons/*/x.py` `/api/v1/people` `npm -w apps/web run lint` `origin/main` `release/19.0.X.Y.Z`'
        self.assertEqual(find_missing('docs/x.md', text, KNOWN), [])

    def test_changed_prose_rejects_new_broken_links_outside_instruction_docs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True).strip()
            git('init', '-q')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'user.name', 'Fixture')
            docs = root / 'docs'
            docs.mkdir()
            (docs / 'دليل.md').write_text('# Guide\n', encoding='utf-8')
            report = docs / 'report.md'
            report.write_text('[Existing](old-missing.md)\n', encoding='utf-8')
            git('add', '.')
            git('commit', '-qm', 'baseline')
            base = git('rev-parse', 'HEAD')
            report.write_text('[Existing](old-missing.md)\n[Guide](دليل.md)\n[New](new-missing.md)\n', encoding='utf-8')
            git('add', '.')
            git('commit', '-qm', 'changed')
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                self.assertEqual(main(['--changed-markdown', base], root=root), 1)
            self.assertEqual(errors.getvalue(), 'docs/report.md:3: missing file reference new-missing.md\n')


if __name__ == '__main__':
    unittest.main()
