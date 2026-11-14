# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import TransactionCase, tagged

MIGRATIONS = Path(__file__).parents[1] / 'migrations' / '19.0.1.1.0'
PREVIOUS = '19.0.1.0.0'
TABLE = 'liwan_integration_connection'


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), MIGRATIONS / f'{name}.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@tagged('post_install', '-at_install', 'liwan')
class TestConnectionShapeMigration(TransactionCase):
    """The pre- script turns the status-only table (a `kind` column and seeded ZATCA rows) into the clean one."""

    def has_kind(self):
        self.env.cr.execute(
            """SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = %s AND column_name = 'kind'""",
            [TABLE],
        )
        return bool(self.env.cr.fetchone())

    def old_layout(self):
        """The table as 19.0.1.0.0 left it: a `kind` column and one status-only row per company."""
        connection = self.env['liwan.integration.connection'].create({'provider': 'meta', 'external_id': '10000'})
        self.env.flush_all()
        self.env.cr.execute(f'ALTER TABLE {TABLE} ADD COLUMN kind varchar')
        self.env.cr.execute(f"UPDATE {TABLE} SET kind = 'zatca' WHERE id = %s", [connection.id])
        self.assertTrue(self.has_kind())
        return connection

    def test_a_fresh_install_has_no_kind_column(self):
        self.assertFalse(self.has_kind())

    def test_the_old_rows_and_the_kind_column_go(self):
        connection = self.old_layout()
        migration = load('pre-connection-shape')
        migration.migrate(self.env.cr, PREVIOUS)
        self.assertFalse(self.has_kind())
        self.env.invalidate_all()
        self.assertFalse(connection.exists())
        self.assertFalse(self.env['liwan.integration.connection'].search([]))

    def test_running_it_again_keeps_the_new_rows(self):
        self.old_layout()
        migration = load('pre-connection-shape')
        migration.migrate(self.env.cr, PREVIOUS)
        kept = self.env['liwan.integration.connection'].create({'provider': 'meta', 'external_id': '20000'})
        self.env.flush_all()
        migration.migrate(self.env.cr, PREVIOUS)
        self.assertTrue(kept.exists())

    def test_a_fresh_install_runs_nothing(self):
        connection = self.old_layout()
        load('pre-connection-shape').migrate(self.env.cr, None)
        self.assertTrue(self.has_kind())
        self.assertTrue(connection.exists())
