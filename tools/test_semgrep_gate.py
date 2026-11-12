# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from semgrep_gate import LOCK, RulesetError, blocking, load_lock, pinned_ruleset, select_files, unjustified_suppressions, update_lock


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


class TestPinnedRulesets(unittest.TestCase):
    BODY = b'rules: []\n'
    DIGEST = hashlib.sha256(BODY).hexdigest()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='liwan-semgrep-test-'))
        self.fetched = []

    def fetch(self, body):
        def serve(ruleset):
            self.fetched.append(ruleset)
            return body
        return serve

    def test_the_lock_pins_each_ruleset_by_sha256(self):
        lock = load_lock(LOCK)
        self.assertEqual(sorted(lock), ['p/python', 'p/secrets', 'p/typescript'])
        for digest in lock.values():
            self.assertRegex(digest, r'^[0-9a-f]{64}$')
        datetime.date.fromisoformat(json.loads(LOCK.read_text())['reviewed'])

    def test_a_matching_download_is_cached_and_reused(self):
        path = pinned_ruleset('p/x', self.DIGEST, self.tmp, self.fetch(self.BODY))
        self.assertEqual(path.read_bytes(), self.BODY)
        self.assertEqual(pinned_ruleset('p/x', self.DIGEST, self.tmp, self.fetch(b'unused')), path)
        self.assertEqual(self.fetched, ['p/x'])

    def test_a_changed_ruleset_fails_closed_and_is_not_cached(self):
        with self.assertRaisesRegex(RulesetError, 'changed upstream'):
            pinned_ruleset('p/x', self.DIGEST, self.tmp, self.fetch(b'rules: [changed]\n'))
        self.assertEqual(list(self.tmp.glob('*')), [])

    def test_a_tampered_cache_file_is_fetched_again(self):
        (self.tmp / f'{self.DIGEST}.yml').write_bytes(b'tampered')
        path = pinned_ruleset('p/x', self.DIGEST, self.tmp, self.fetch(self.BODY))
        self.assertEqual(path.read_bytes(), self.BODY)
        self.assertEqual(self.fetched, ['p/x'])

    def test_update_lock_pins_what_the_registry_serves_now(self):
        lock = self.tmp / 'lock.json'
        lock.write_text(json.dumps({'reviewed': '2000-01-01', 'rulesets': {'p/x': '0' * 64}}))
        update_lock(lock, self.fetch(self.BODY), datetime.date(2026, 11, 12))
        self.assertEqual(json.loads(lock.read_text()), {'reviewed': '2026-11-12', 'rulesets': {'p/x': self.DIGEST}})
