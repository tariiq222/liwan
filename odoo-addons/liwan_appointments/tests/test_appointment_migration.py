# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import tagged

from .common import LiwanAppointmentsCase

SCRIPT = Path(__file__).parents[1] / 'migrations' / '19.0.1.1.0' / 'post-sync-company-scope.py'
ENGINE_DOMAINS = {
    'resource_booking.rule_resource_booking_type_company': "['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]",
    'resource_booking.rule_resource_booking_company': "['|', ('type_id.company_id', '=', False), ('type_id.company_id', 'in', company_ids)]",
}
LIWAN_DOMAINS = {
    'resource_booking.rule_resource_booking_type_company': "[('company_id', 'in', company_ids)]",
    'resource_booking.rule_resource_booking_company': "[('type_id.company_id', 'in', company_ids)]",
}


@tagged('post_install', '-at_install', 'liwan')
class TestCompanyScopeMigration(LiwanAppointmentsCase):
    """The post migration of 19.0.1.1.0 brings an upgraded database to the company-scoped schema."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        spec = importlib.util.spec_from_file_location('appointments_post_sync_company_scope', SCRIPT)
        cls.migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.migration)

    def _migrate(self):
        self.env.invalidate_all()
        self.migration.migrate(self.cr, '19.0.1.0.0')

    def test_a_fresh_install_is_left_alone(self):
        self.cr.execute('UPDATE ir_rule SET domain_force = %s WHERE id = %s', [
            ENGINE_DOMAINS['resource_booking.rule_resource_booking_company'],
            self.env.ref('resource_booking.rule_resource_booking_company').id,
        ])
        self.migration.migrate(self.cr, False)
        self.env.invalidate_all()
        self.assertEqual(
            self.env.ref('resource_booking.rule_resource_booking_company').domain_force,
            ENGINE_DOMAINS['resource_booking.rule_resource_booking_company'],
        )

    def test_the_engine_rules_take_the_liwan_domains(self):
        for xmlid, domain in ENGINE_DOMAINS.items():
            self.cr.execute('UPDATE ir_rule SET domain_force = %s WHERE id = %s', [domain, self.env.ref(xmlid).id])
        self._migrate()
        for xmlid, domain in LIWAN_DOMAINS.items():
            self.assertEqual(self.env.ref(xmlid).domain_force, domain, xmlid)

    def test_a_combination_takes_the_company_of_its_types(self):
        other = self.env['res.company'].create({'name': 'Backfill company'})
        self.cr.execute('UPDATE resource_booking_combination SET company_id = %s WHERE id = %s', [other.id, self.combination.id])
        self._migrate()
        self.assertEqual(self.combination.company_id, self.env.company)

    def test_a_combination_of_types_of_different_companies_is_refused(self):
        other, _type, _combination, _booking = self._foreign_company_records()
        second = self.env['resource.booking.type'].create({'name': 'Second type'})
        second.combination_rel_ids = [(0, 0, {'combination_id': self.combination.id})]
        self.cr.execute('UPDATE resource_booking_type SET company_id = %s WHERE id = %s', [other.id, second.id])
        with self.assertRaisesRegex(ValueError, 'Room A'):
            self._migrate()

    def test_a_type_without_a_company_is_named_not_guessed(self):
        orphan = self.env['resource.booking.type'].create({'name': 'Orphan type'})
        self.cr.execute('ALTER TABLE resource_booking_type ALTER COLUMN company_id DROP NOT NULL')
        self.cr.execute('UPDATE resource_booking_type SET company_id = NULL WHERE id = %s', [orphan.id])
        with self.assertRaisesRegex(ValueError, 'Orphan type'):
            self._migrate()
