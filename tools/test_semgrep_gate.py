# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from semgrep_gate import blocking, select_files


class TestSemgrepGate(unittest.TestCase):
    def test_select_files_keeps_source_and_drops_tests_and_generated(self):
        paths = [
            'odoo-addons/nasq_hr/models/a.py', 'odoo-addons/nasq_hr/tests/test_a.py', 'tools/test_x.py',
            'apps/web/app/a.vue', 'apps/web/app/a.test.ts', 'apps/web/app/__tests__/b.ts',
            'apps/web/.nuxt/x.ts', 'docs/a.md', 'deploy/x.sh', 'e2e/tests/a.e2e.ts', 'a.json',
        ]
        self.assertEqual(select_files(paths), ['apps/web/app/a.vue', 'deploy/x.sh', 'odoo-addons/nasq_hr/models/a.py'])

    def test_blocking_is_error_severity_or_secrets(self):
        findings = [
            {'check_id': 'python.x.warn', 'extra': {'severity': 'WARNING'}},
            {'check_id': 'python.x.err', 'extra': {'severity': 'ERROR'}},
            {'check_id': 'generic.secrets.security.detected-x', 'extra': {'severity': 'WARNING'}},
        ]
        self.assertEqual([f['check_id'] for f in blocking(findings)], ['python.x.err', 'generic.secrets.security.detected-x'])


if __name__ == '__main__':
    unittest.main()
