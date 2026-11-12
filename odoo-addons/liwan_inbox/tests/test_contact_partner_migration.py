# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import TransactionCase, new_test_user, tagged

MIGRATIONS = Path(__file__).parents[1] / 'migrations' / '19.0.1.20.0'
FIELD_XMLID = 'field_liwan_inbox_contact__partner_id'
FOREIGN_KEY = 'liwan_inbox_contact_partner_id_fkey'
BRIDGE = 'liwan_inbox_payments'
OWNER = 'liwan_inbox'
PREVIOUS = '19.0.1.19.0'


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), MIGRATIONS / f'{name}.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@tagged('post_install', '-at_install', 'liwan')
class TestContactPartnerMove(TransactionCase):
    """The pre- script gives the field partner_id of a contact, and its foreign key, from the bridge to liwan_inbox."""

    def field_modules(self):
        self.env.cr.execute(
            "SELECT module FROM ir_model_data WHERE model = 'ir.model.fields' AND name = %s ORDER BY module",
            [FIELD_XMLID],
        )
        return [row[0] for row in self.env.cr.fetchall()]

    def key_modules(self):
        self.env.cr.execute(
            """SELECT m.name FROM ir_model_constraint c JOIN ir_module_module m ON m.id = c.module
               WHERE c.name = %s AND c.type = 'f' ORDER BY m.name""",
            [FOREIGN_KEY],
        )
        return [row[0] for row in self.env.cr.fetchall()]

    def old_layout(self):
        """The rows as the bridge left them when it declared the field."""
        self.env.flush_all()
        self.env.cr.execute(
            "UPDATE ir_model_data SET module = %s WHERE model = 'ir.model.fields' AND name = %s", [BRIDGE, FIELD_XMLID],
        )
        self.env.cr.execute(
            """UPDATE ir_model_constraint SET module = (SELECT id FROM ir_module_module WHERE name = %s)
               WHERE name = %s AND type = 'f'""",
            [BRIDGE, FOREIGN_KEY],
        )

    def test_a_fresh_install_reflects_the_field_and_its_key_under_liwan_inbox(self):
        self.assertEqual((self.field_modules(), self.key_modules()), ([OWNER], [OWNER]))
        self.assertEqual(self.env['liwan.inbox.contact']._fields['partner_id']._module, OWNER)

    def test_the_bridge_rows_move_to_liwan_inbox_once(self):
        self.old_layout()
        self.assertEqual((self.field_modules(), self.key_modules()), ([BRIDGE], [BRIDGE]))
        migration = load('pre-move-contact-partner')
        migration.migrate(self.env.cr, PREVIOUS)
        migration.migrate(self.env.cr, PREVIOUS)
        self.assertEqual((self.field_modules(), self.key_modules()), ([OWNER], [OWNER]))

    def test_a_row_already_under_liwan_inbox_wins_over_the_bridge_row(self):
        self.env.flush_all()
        self.env.cr.execute(
            """INSERT INTO ir_model_data (module, name, model, res_id, noupdate)
               SELECT %s, name, model, res_id, noupdate FROM ir_model_data
               WHERE module = %s AND model = 'ir.model.fields' AND name = %s""",
            [BRIDGE, OWNER, FIELD_XMLID],
        )
        self.assertEqual(self.field_modules(), [OWNER, BRIDGE])
        load('pre-move-contact-partner').migrate(self.env.cr, PREVIOUS)
        self.assertEqual(self.field_modules(), [OWNER])

    def test_a_fresh_install_runs_nothing(self):
        self.old_layout()
        load('pre-move-contact-partner').migrate(self.env.cr, None)
        self.assertEqual(self.field_modules(), [BRIDGE])


@tagged('post_install', '-at_install', 'liwan')
class TestContactPartnerAdoption(TransactionCase):
    """The post- script makes the partners linked to contacts customers through liwan.customers.service."""

    def contact(self, partner):
        return self.env['liwan.inbox.contact'].create({
            'name': partner.name, 'phone': partner.phone, 'company_id': self.env.company.id, 'partner_id': partner.id,
        })

    def test_linked_partners_are_adopted_and_accounts_are_skipped(self):
        plain = self.env['res.partner'].create({
            'name': 'Linked buyer', 'phone': '0501234567', 'company_id': self.env.company.id,
        })
        account = new_test_user(self.env, login='inbox_linked_account', groups='base.group_user').partner_id
        bought, shared = self.contact(plain), self.contact(account)
        with self.assertLogs('odoo.addons.liwan_inbox.migrations', level='INFO') as logs:
            load('post-adopt-contact-partners').migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertEqual((plain.liwan_party, plain.company_id.id, plain.phone), (True, False, '+966501234567'))
        self.assertFalse(account.liwan_party)
        self.assertEqual((bought.partner_id, shared.partner_id), (plain, account))
        self.assertIn('adopted 1, skipped 1', logs.output[-1])

    def test_a_fresh_install_adopts_nothing(self):
        plain = self.env['res.partner'].create({'name': 'Linked buyer'})
        self.contact(plain)
        load('post-adopt-contact-partners').migrate(self.env.cr, None)
        self.assertFalse(plain.liwan_party)
