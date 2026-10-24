# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from secret_guard import (
    find_credential_fallbacks,
    find_forbidden_paths,
    find_secret_lines,
)


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
            "const PASSWORD = __ENV.PASSWORD || 'LoadTest2026!';\n"
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


if __name__ == '__main__':
    unittest.main()
