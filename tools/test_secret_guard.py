# Part of Odoo. See LICENSE file for full copyright and licensing details.
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import secret_guard
from secret_guard import (
    find_credential_fallbacks,
    find_forbidden_paths,
    find_provider_tokens,
    find_secret_lines,
    find_wide_fallbacks,
    scan_tree,
)

# Spelled in pieces so this file does not hold a token-shaped literal itself.
REAL_SHAPED_TOKEN = 'gh' + 'p_' + 'A1b2C3d4' * 5


class TestSecretGuard(unittest.TestCase):
    def test_forbidden_tracked_paths(self):
        tracked = ['deploy/.env.example', 'deploy/.env', 'deploy/data/odoo.conf',
                   'apps/web/.env.local', 'certs/site.key', 'README.md']
        self.assertEqual(
            find_forbidden_paths(tracked),
            ['apps/web/.env.local', 'certs/site.key', 'deploy/.env', 'deploy/data/odoo.conf'],
        )

    def test_example_files_are_allowed(self):
        self.assertEqual(find_forbidden_paths(['deploy/.env.example', 'a/.env.sample']), [])

    def test_private_key_containers_are_rejected_even_if_force_added(self):
        paths = ['certs/server.p8', 'keys/store.jks', 'keys/store.keystore',
                 'apps/web/public/private.key', 'certs/client.p12', 'certs/client.pfx']
        self.assertEqual(find_forbidden_paths(paths), sorted(paths))

    def test_literal_secret_lines(self):
        text = 'DB_PASSWORD=${DB_PASSWORD}\nadmin_passwd = hunter2hunter2\nVENDOR_PASSWORD=change-me\n'
        self.assertEqual(find_secret_lines('x.conf', text), [('x.conf', 2)])

    def test_ci_ephemeral_database_password_is_not_a_secret(self):
        text = 'env: { POSTGRES_USER: odoo, POSTGRES_PASSWORD: odoo, POSTGRES_DB: postgres }\n'
        self.assertEqual(find_secret_lines('ci.yml', text), [])

    def test_oidc_permission_scope_is_not_a_secret(self):
        self.assertEqual(find_secret_lines('agent.yml', '    permissions:\n      id-token: write\n'), [])
        self.assertEqual(find_secret_lines('agent.yml', '      id-token: abcdef123456\n'), [('agent.yml', 1)])

    def test_empty_shell_password_default_is_not_a_secret(self):
        text = 'case "${VENDOR_PASSWORD:-}" in\n'
        self.assertEqual(find_secret_lines('provision.sh', text), [])

    def test_credential_fallback_literal_is_a_secret(self):
        # deploy/loadtest/k6 scripts shipped `PASSWORD = ENV.PASSWORD || 'literal'`;
        # the literal is what runs on any host BASE points at.
        text = (
            "const LOGIN = __ENV.LOGIN || 'admin';\n"
            "const PASSWORD = __ENV.PASSWORD || 'not-a-real-password';\n"
            "const secret = cfg.password || 'hunter2';\n"
        )
        self.assertEqual(find_credential_fallbacks(text), [2, 3])

    def test_credential_fallback_placeholders_and_empty_defaults_are_allowed(self):
        text = (
            "const a = env.API_KEY || '<your-api-key>';\n"
            "const b = opts.sessionToken ?? '';\n"
            "const c = requiredEnv('PASSWORD');\n"
            "const d = env.LOGIN || 'admin';\n"
        )
        self.assertEqual(find_credential_fallbacks(text), [])

    def test_double_quoted_fallback_may_contain_an_apostrophe(self):
        text = 'const PASSWORD = env.PASSWORD || "don\'t-use-this";\n'
        self.assertEqual(find_credential_fallbacks(text), [1])

    def test_an_empty_default_does_not_consume_a_later_string(self):
        text = 'const TOKEN = env.TOKEN ?? ""; const label = "not a secret";\n'
        self.assertEqual(find_credential_fallbacks(text), [])

    def test_every_literal_spelling_of_a_credential_is_reported(self):
        text = (
            "const PASSWORD = 'not-a-real-password';\n"          # plain assignment
            "PASSWORD ||= 'not-a-real-password';\n"              # logical-or assignment
            "PASSWORD ??= 'secret123';\n"                  # nullish assignment
            "const TOKEN = env.TOKEN || `lit`;\n"          # template literal
        )
        self.assertEqual(find_credential_fallbacks(text), [1, 2, 3, 4])

    def test_a_value_wrapped_to_the_next_line_is_still_reported(self):
        text = "const PASSWORD = __ENV.PASSWORD ||\n  'not-a-real-password';\n"
        self.assertEqual(find_credential_fallbacks(text), [1])

    def test_a_placeholder_earlier_on_the_line_does_not_hide_a_real_literal(self):
        text = "const password = ''; const token = env.TOKEN || 'actual-credential';\n"
        self.assertEqual(find_credential_fallbacks(text, 'deploy/x.js'), [1])

    def test_a_self_described_fixture_is_only_allowed_in_a_test_file(self):
        text = "const token = 'synthetic-local-token-'\n"
        self.assertEqual(find_credential_fallbacks(text, 'deploy/x.test.mjs'), [])
        self.assertEqual(find_credential_fallbacks(text, 'deploy/releases/test_guard.mjs'), [])
        self.assertEqual(find_credential_fallbacks(text, 'deploy/x.mjs'), [1])


class TestWholeTree(unittest.TestCase):
    """The roots outside deploy/ and .github/ (apps, packages, odoo-addons, tools) are scanned too."""

    def scan(self, files, exceptions=None):
        with tempfile.TemporaryDirectory() as root:
            for name, text in files.items():
                path = Path(root, name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding='utf-8')
            previous = os.getcwd()
            os.chdir(root)
            try:
                with mock.patch.object(secret_guard, 'LITERAL_EXCEPTIONS', exceptions or {}):
                    return scan_tree(sorted(files))
            finally:
                os.chdir(previous)

    def test_a_provider_token_in_every_new_root_is_found(self):
        for path in ('odoo-addons/liwan_x/models/m.py', 'apps/web/server/api/t.ts', 'packages/ui/a.vue', 'tools/x.mjs'):
            with self.subTest(path=path):
                problems = self.scan({path: f'const k = "{REAL_SHAPED_TOKEN}"\n'})
                self.assertEqual(problems, [f'provider token or private key: {path}:1'])

    def test_e2e_and_repo_root_files_are_scanned_too(self):
        for path in ('e2e/tests/a.e2e.ts', 'e2e.config.ts'):
            with self.subTest(path=path):
                self.assertEqual(self.scan({path: f'const k = "{REAL_SHAPED_TOKEN}"\n'}),
                                 [f'provider token or private key: {path}:1'])

    def test_a_private_key_block_is_found(self):
        block = '-----BEGIN ' + 'RSA PRIVATE KEY-----'
        self.assertEqual(find_provider_tokens(block + '\n', 'apps/a/b.py'), [1])

    def test_a_self_described_token_is_only_accepted_in_a_test_file(self):
        fixture = 'sk-' + 'vendor-secret-' + 'x' * 24
        self.assertEqual(find_provider_tokens(f"KEY = '{fixture}'", 'apps/control-plane/src/__tests__/a.test.ts'), [])
        self.assertEqual(find_provider_tokens(f"KEY = '{fixture}'", 'apps/control-plane/src/a.ts'), [1])

    def test_a_credential_that_falls_back_to_a_literal_is_found_in_python_and_typescript(self):
        text = (
            "password = os.environ.get('SERVICE_PASSWORD') or 'hunter2hunter2'\n"
            "token = os.environ.get('SERVICE_TOKEN', 'hunter2hunter2')\n"
            "const apiKey = process.env.API_KEY ?? 'hunter2hunter2'\n"
        )
        self.assertEqual(find_wide_fallbacks(text, 'odoo-addons/x/y.py'), [1, 2, 3])
        self.assertEqual(self.scan({'apps/web/server/a.ts': text}), [
            'credential fallback literal: apps/web/server/a.ts:1',
            'credential fallback literal: apps/web/server/a.ts:2',
            'credential fallback literal: apps/web/server/a.ts:3',
        ])

    def test_ordinary_code_and_test_fixtures_are_not_secrets(self):
        text = (
            "password = request.params['password']\n"
            "if not (token.startswith('/')) or '://' in token:\n"
            "token = os.environ.get('SERVICE_TOKEN') or ''\n"
            "token = os.environ.get('SERVICE_TOKEN', '')\n"
            "password = 'Plain-Fixture-Password'\n"
        )
        self.assertEqual(find_wide_fallbacks(text, 'odoo-addons/x/tests/test_y.py'), [])

    def test_a_literal_secret_in_a_new_root_config_file_is_found(self):
        problems = self.scan({'apps/ai-service/pyproject.toml': 'api_key = "hunter2hunter2"\n'})
        self.assertEqual(problems, ['literal secret: apps/ai-service/pyproject.toml:1'])

    def test_an_exception_skips_the_literal_rules_but_not_the_token_rule(self):
        exceptions = {'apps/web/e2e/a.spec.ts': 'test accounts of the scratch database'}
        quiet = {'apps/web/e2e/a.spec.ts': "x = process.env.E2E_PASSWORD ?? 'hunter2hunter2'\n"}
        self.assertEqual(self.scan(quiet, exceptions), [])
        loud = {'apps/web/e2e/a.spec.ts': f'const k = "{REAL_SHAPED_TOKEN}"\n'}
        self.assertEqual(self.scan(loud, exceptions), ['provider token or private key: apps/web/e2e/a.spec.ts:1'])

    def test_an_exception_that_matches_no_file_is_stale(self):
        problems = self.scan({'apps/a/b.py': 'x = 1\n'}, {'apps/gone/*': 'removed'})
        self.assertEqual(problems, ['stale literal exception (matches no scanned file): apps/gone/*'])

    def test_the_exception_set_is_pinned_and_each_entry_states_a_reason(self):
        # Adding an entry means editing this list in the same change, where review sees it.
        self.assertEqual(sorted(secret_guard.LITERAL_EXCEPTIONS), [
            'apps/control-plane/src/commercial/payment-simulator.ts',
            'tools/shared_acceptance_live/down.sh',
            'tools/shared_acceptance_live/probe.mjs',
            'tools/test_jev_review.mjs',
            'tools/test_secret_guard.py',
        ])
        self.assertTrue(all(reason.strip() for reason in secret_guard.LITERAL_EXCEPTIONS.values()))
        self.assertFalse(any('*' in path for path in secret_guard.LITERAL_EXCEPTIONS))

    def test_every_token_on_a_line_is_judged(self):
        fixture = 'sk-' + 'fixture-secret-' + 'x' * 24
        real = 'gh' + 'p_' + 'Z9y8X7w6' * 5
        test_path = 'apps/web/server/__tests__/a.test.ts'
        for name, line, expected in (
            ('fixture then real', f'a = "{fixture}"; b = "{real}"', [1]),
            ('real then fixture', f'a = "{real}"; b = "{fixture}"', [1]),
            ('two fixtures', f'a = "{fixture}"; b = "{fixture}y"', []),
        ):
            with self.subTest(name):
                self.assertEqual(find_provider_tokens(line + '\n', test_path), expected)

    def test_a_real_value_on_an_e2e_line_is_still_reported(self):
        text = "a = process.env.E2E_ADMIN_PASSWORD ?? 'seed-default'; b = process.env.API_KEY ?? 'hunter2hunter2'\n"
        self.assertEqual(find_wide_fallbacks(text, 'apps/web/e2e/a.spec.ts'), [1])
        only_e2e = "a = process.env.E2E_ADMIN_PASSWORD ?? 'seed-default'; b = process.env.E2E_USER_TOKEN ?? 'seed-default'\n"
        self.assertEqual(find_wide_fallbacks(only_e2e, 'apps/web/e2e/a.spec.ts'), [])

    def test_only_the_e2e_variable_line_is_skipped_not_the_file(self):
        text = (
            "await page.fill(process.env.E2E_ADMIN_PASSWORD ?? 'hunter2hunter2')\n"
            "const apiKey = process.env.API_KEY ?? 'hunter2hunter2'\n"
        )
        self.assertEqual(find_wide_fallbacks(text, 'apps/web/e2e/a.spec.ts'), [2])


if __name__ == '__main__':
    unittest.main()
