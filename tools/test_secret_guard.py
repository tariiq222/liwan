# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from secret_guard import find_forbidden_paths, find_secret_lines


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

    def test_literal_secret_lines(self):
        text = 'DB_PASSWORD=${DB_PASSWORD}\nadmin_passwd = hunter2hunter2\nVENDOR_PASSWORD=change-me\n'
        self.assertEqual(find_secret_lines('x.conf', text), [('x.conf', 2)])

    def test_ci_ephemeral_database_password_is_not_a_secret(self):
        text = 'env: { POSTGRES_USER: odoo, POSTGRES_PASSWORD: odoo, POSTGRES_DB: postgres }\n'
        self.assertEqual(find_secret_lines('ci.yml', text), [])

    def test_empty_shell_password_default_is_not_a_secret(self):
        text = 'case "${VENDOR_PASSWORD:-}" in\n'
        self.assertEqual(find_secret_lines('provision.sh', text), [])


if __name__ == '__main__':
    unittest.main()
