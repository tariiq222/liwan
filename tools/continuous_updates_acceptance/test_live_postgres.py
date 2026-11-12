"""Explicit opt-in local scratch PostgreSQL proof; preserves all resources.

Operator proof only, registered in tools/ci_not_run.json and run by no CI stage: it connects as the
trust-auth role ``tariq`` on 127.0.0.1:5432, uses password-less runtime roles and never drops its
fixed-name databases and roles.
"""
import os
from pathlib import Path
import unittest

from .postgres_scratch import run_scratch


@unittest.skipUnless(os.environ.get('LIWAN_RUN_PG_SCRATCH') == '1', 'explicit scratch opt-in required')
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
