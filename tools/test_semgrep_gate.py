# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from semgrep_gate import blocking, select_files, unjustified_suppressions


class TestSemgrepGate(unittest.TestCase):
    def test_select_files_keeps_source_and_drops_tests_and_generated(self):
        paths = [
            'odoo-addons/liwan_hr/models/a.py', 'odoo-addons/liwan_hr/tests/test_a.py', 'tools/test_x.py',
            'apps/web/app/a.vue', 'apps/web/app/a.test.ts', 'apps/web/app/__tests__/b.ts',
            'apps/web/.nuxt/x.ts', 'docs/a.md', 'deploy/x.sh', 'e2e/tests/a.e2e.ts', 'a.json',
        ]
        self.assertEqual(select_files(paths), ['apps/web/app/a.vue', 'deploy/x.sh', 'odoo-addons/liwan_hr/models/a.py'])

    def test_select_files_filters_by_path_component_not_substring(self):
        paths = [
            'odoo-addons/foo_docs/models/x.py', 'odoo-addons/mytests/models/y.py',
            'apps/web/app/pages/tests/index.vue', 'apps/web/app/pages/docs/index.vue',
            'docs/tools/x.py', 'apps/web/.output/server/x.mjs',
        ]
        self.assertEqual(select_files(paths), [
            'apps/web/app/pages/docs/index.vue', 'odoo-addons/foo_docs/models/x.py', 'odoo-addons/mytests/models/y.py',
        ])

    def test_select_files_accepts_more_suffixes(self):
        paths = ['a/x.tsx', 'a/x.jsx', 'a/x.cjs', 'a/x.mts', 'a/x.cts', 'a/x.bash', 'a/x.md']
        self.assertEqual(select_files(paths), sorted(paths[:-1]))

    def test_suppression_needs_rule_id_and_reason(self):
        good = '    # nosemgrep: python.lang.x.y -- fixed argv list\n'
        self.assertEqual(unjustified_suppressions('a.py', good), [])
        self.assertEqual(unjustified_suppressions('a.py', 'x = 1  # nosemgrep\n'), [1])
        self.assertEqual(unjustified_suppressions('a.py', 'ok\n# nosemgrep: rule.id\n'), [2])
        self.assertEqual(unjustified_suppressions('a.py', '# nosemgrep: rule.id --\n'), [1])
        self.assertEqual(unjustified_suppressions('a.py', '# nosemgrep: rule.id --  \n'), [1])

    def test_blocking_is_error_severity_or_secrets(self):
        findings = [
            {'check_id': 'python.x.warn', 'extra': {'severity': 'WARNING'}},
            {'check_id': 'python.x.err', 'extra': {'severity': 'ERROR'}},
            {'check_id': 'generic.secrets.security.detected-x', 'extra': {'severity': 'WARNING'}},
        ]
        self.assertEqual([f['check_id'] for f in blocking(findings)], ['python.x.err', 'generic.secrets.security.detected-x'])


if __name__ == '__main__':
    unittest.main()
