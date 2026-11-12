"""Scratch resource naming of the continuous-updates PostgreSQL proof (no database needed)."""
import unittest

from .postgres_scratch import scratch_names


class ScratchNamingTests(unittest.TestCase):
    def test_default_scope_is_the_exact_authorized_resource_set(self):
        self.assertEqual(scratch_names(), ('liwan_scratch_updates_roles_1016',
            'liwan_scratch_updates_restore_roles_1016', 'liwan_updates_owner_1016',
            'liwan_updates_blue_1016', 'liwan_updates_green_1016'))
        with self.assertRaises(ValueError): scratch_names('../unsafe')


if __name__ == '__main__': unittest.main()
