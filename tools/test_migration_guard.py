# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from migration_guard import check_addon


class TestMigrationGuard(unittest.TestCase):
    def test_unchanged_version_needs_nothing(self):
        self.assertIsNone(check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.0.0', set()))

    def test_bump_without_directory_fails(self):
        self.assertEqual(
            check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.1.0', set()),
            'nasq_pmo: version 19.0.1.0.0 -> 19.0.1.1.0 but migrations/19.0.1.1.0/ is missing or empty',
        )

    def test_bump_with_script_or_readme_passes(self):
        self.assertIsNone(check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.1.0', {'post-backfill.py'}))
        self.assertIsNone(check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.1.0', {'README.md'}))

    def test_downgrade_and_new_addon(self):
        self.assertEqual(
            check_addon('nasq_pmo', '19.0.1.1.0', '19.0.1.0.0', set()),
            'nasq_pmo: version went backwards 19.0.1.1.0 -> 19.0.1.0.0',
        )
        self.assertIsNone(check_addon('nasq_new', None, '19.0.1.0.0', set()))


if __name__ == '__main__':
    unittest.main()
