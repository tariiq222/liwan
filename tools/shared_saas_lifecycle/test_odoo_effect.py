# Part of Odoo. See LICENSE file for full copyright and licensing details.
import tempfile
import unittest
from pathlib import Path
from tools.shared_saas_lifecycle import odoo_effect

class PhysicalBoundaryTests(unittest.TestCase):
    def test_database_and_modules_fail_closed(self):
        self.assertEqual(odoo_effect.validate_database('nasq_scratch_' + 'a' * 32), 'nasq_scratch_' + 'a' * 32)
        for value in ['odoo19', 'postgres', 'nasq_scratch_prod', 'nasq_scratch_a;drop']:
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_database(value)
        with self.assertRaises(odoo_effect.EffectError):
            odoo_effect.validate_modules(['nasq_core', 'sale'])

    def test_permanent_reservation_refuses_reclaim_or_symlink(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            odoo_effect.reserve(root / 'db.json', {'attempt': 'first'})
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.reserve(root / 'db.json', {'attempt': 'second'})
            (root / 'link.json').symlink_to(root / 'db.json')
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.reserve(root / 'link.json', {'attempt': 'third'})

    def test_existing_database_or_filestore_is_never_adopted(self):
        for database_exists, filestore_exists in [(True, False), (False, True), (True, True)]:
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.require_new_target(database_exists, filestore_exists)
        odoo_effect.require_new_target(False, False)

    def test_observation_never_returns_present_from_marker_only(self):
        self.assertEqual(odoo_effect.verified_observation({}, False), {'state': 'partial'})

if __name__ == '__main__':
    unittest.main()
