"""Explicit opt-in local scratch PostgreSQL proof; preserves all resources."""
import os
from pathlib import Path
import unittest

from .postgres_scratch import run_scratch, scratch_names


class ScratchNamingTests(unittest.TestCase):
    def test_default_scope_is_the_exact_authorized_resource_set(self):
        self.assertEqual(scratch_names(), ('webvue_scratch_updates_roles_1016',
            'webvue_scratch_updates_restore_roles_1016', 'webvue_updates_owner_1016',
            'webvue_updates_blue_1016', 'webvue_updates_green_1016'))
        with self.assertRaises(ValueError): scratch_names('../unsafe')


@unittest.skipUnless(os.environ.get('WEBVUE_RUN_PG_SCRATCH') == '1', 'explicit scratch opt-in required')
class LivePostgresAcceptance(unittest.TestCase):
    def test_live_role_fencing_dump_restore_and_attachment(self):
        root = Path(__file__).resolve().parents[2] / '.superpowers' / 'pg-scratch'
        result = run_scratch(root)
        self.assertTrue(result['passed'])
        for check in ('role_valid', 'public_connect_rejected', 'membership_rejected',
                      'active_transaction_refused', 'active_work_preserved', 'idle_old_terminated',
                      'old_reconnect_refused', 'new_role_dml', 'backup_hashes_valid',
                      'restored_fixture_matches', 'restored_attachment_matches'):
            with self.subTest(check=check): self.assertTrue(result['checks'][check])
        self.assertEqual(result['scope'], 'postgres_infrastructure_fixture')
        self.assertFalse(result['odoo_acceptance'])


if __name__ == '__main__': unittest.main()
