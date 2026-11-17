# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from migration_guard import check_added_dirs, check_addon


class TestMigrationGuard(unittest.TestCase):
    def test_unchanged_version_needs_nothing(self):
        self.assertIsNone(check_addon('liwan_pmo', '19.0.1.0.0', '19.0.1.0.0', set()))

    def test_bump_without_directory_fails(self):
        self.assertEqual(
            check_addon('liwan_pmo', '19.0.1.0.0', '19.0.1.1.0', set()),
            'liwan_pmo: version 19.0.1.0.0 -> 19.0.1.1.0 but migrations/19.0.1.1.0/ is missing or empty',
        )

    def test_bump_with_script_or_readme_passes(self):
        self.assertIsNone(check_addon('liwan_pmo', '19.0.1.0.0', '19.0.1.1.0', {'post-backfill.py'}))
        self.assertIsNone(check_addon('liwan_pmo', '19.0.1.0.0', '19.0.1.1.0', {'README.md'}))

    def test_downgrade_and_new_addon(self):
        self.assertEqual(
            check_addon('liwan_pmo', '19.0.1.1.0', '19.0.1.0.0', set()),
            'liwan_pmo: version went backwards 19.0.1.1.0 -> 19.0.1.0.0',
        )
        self.assertIsNone(check_addon('liwan_new', None, '19.0.1.0.0', set()))

    def test_added_dir_at_or_below_base_never_runs(self):
        self.assertEqual(check_added_dirs('liwan_api', '19.0.1.6.0', {'19.0.1.6.0', '19.0.1.7.0'}), [
            'liwan_api: migrations/19.0.1.6.0/ is new but the base is already at 19.0.1.6.0, so it never runs; '
            'bump above 19.0.1.6.0',
        ])
        self.assertEqual(check_added_dirs('liwan_api', '19.0.1.6.0', {'19.0.1.7.0'}), [])
        self.assertEqual(check_added_dirs('liwan_new', None, {'19.0.1.0.0'}), [])


if __name__ == '__main__':
    unittest.main()
