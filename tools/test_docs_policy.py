# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from docs_policy import find_missing

KNOWN = {
    'tools', 'tools/real.py', 'docs', 'docs/a.md',
    'odoo-addons', 'odoo-addons/nasq_hr', 'odoo-addons/nasq_hr/tests', 'odoo-addons/nasq_hr/tests/common.py',
}


class TestDocsPolicy(unittest.TestCase):
    def test_flags_missing_file_reference(self):
        text = 'Edit `apps/web/app/composables/useNav.ts` and `tools/real.py`.'
        self.assertEqual(find_missing('docs/x.md', text, KNOWN), [(1, 'apps/web/app/composables/useNav.ts')])

    def test_flags_missing_markdown_link_relative_to_doc(self):
        self.assertEqual(find_missing('docs/x.md', '[a](a.md) [b](gone.md)', KNOWN), [(1, 'gone.md')])

    def test_accepts_addon_shorthand(self):
        self.assertEqual(find_missing('CLAUDE.md', '`nasq_hr/tests/common.py`', KNOWN), [])

    def test_ignores_placeholders_globs_routes_and_commands(self):
        text = '`apps/web/app/modules/<app>/manifest.ts` `odoo-addons/*/x.py` `/api/v1/people` `npm -w apps/web run lint` `origin/main` `release/19.0.X.Y.Z`'
        self.assertEqual(find_missing('docs/x.md', text, KNOWN), [])


if __name__ == '__main__':
    unittest.main()
