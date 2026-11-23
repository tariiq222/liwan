# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The 19.0.1.29.0 migration: the retired `inbox.tiktok` feature key leaves the tenant profile."""
import importlib.util
from pathlib import Path

from psycopg2.extras import Json

from odoo.tests import TransactionCase, tagged

MIGRATIONS = Path(__file__).parents[1] / 'migrations' / '19.0.1.29.0'
PREVIOUS = '19.0.1.28.0'
RETIRED = 'inbox.tiktok'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokFeatureMigration(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        spec = importlib.util.spec_from_file_location('pre_remove_inbox_tiktok_feature', MIGRATIONS / 'pre-remove-inbox-tiktok-feature.py')
        cls.migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.migration)
        cls.profile = cls.env['liwan.tenant.profile'].search([], limit=1)

    def seed(self, features, post_trial_features, retained_read_features):
        # The policy write guard admits trusted operators only; the migration itself runs on the raw table.
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET features = %s, post_trial_features = %s, retained_read_features = %s WHERE id = %s',
            [Json(features), Json(post_trial_features), Json(retained_read_features), self.profile.id],
        )

    def stored(self):
        self.profile.invalidate_recordset()
        return self.profile.features, self.profile.post_trial_features, self.profile.retained_read_features

    def test_retired_key_leaves_every_feature_list_and_the_rest_stays(self):
        self.seed({'inbox.enabled': True, RETIRED: True}, {'inbox.enabled': True, RETIRED: False}, [RETIRED, 'inbox.enabled'])
        self.migration.migrate(self.env.cr, PREVIOUS)
        expected = ({'inbox.enabled': True}, {'inbox.enabled': True}, ['inbox.enabled'])
        self.assertEqual(self.stored(), expected)
        self.migration.migrate(self.env.cr, PREVIOUS)  # a rerun finds nothing left to remove
        self.assertEqual(self.stored(), expected)

    def test_fresh_install_runs_no_update(self):
        self.seed({RETIRED: True}, {}, [])
        self.migration.migrate(self.env.cr, False)
        self.assertEqual(self.stored()[0], {RETIRED: True})
