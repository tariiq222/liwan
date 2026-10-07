# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

MIGRATION = 'nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py'
COLUMNS = ('nasq_notification', 'nasq_notification_kind', 'nasq_notification_key')


def _load_migration():
    spec = importlib.util.spec_from_file_location('nasq_pmo_pre_hand_bell_columns', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'nasq')
class TestNotifyOwnershipMigration(TransactionCase):
    """The 19.0.1.3.0 pre-migration leaves the generic bell columns to nasq_notify (Deviation 1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.migration = _load_migration()
        cls.names = [*cls.migration.ADOPTED_FIELDS, cls.migration.CONSTRAINT_XMLID]

    def _xmlids(self, module):
        self.env.cr.execute(
            'SELECT name, model, res_id FROM ir_model_data WHERE module = %s AND name = ANY(%s)',
            [module, self.names],
        )
        return {name: (model, res_id) for name, model, res_id in self.env.cr.fetchall()}

    def _constraints(self):
        self.env.cr.execute(
            '''
                SELECT m.name, c.id
                  FROM ir_model_constraint c
                  JOIN ir_module_module m ON m.id = c.module
                 WHERE c.name = %s
            ''',
            [self.migration.CONSTRAINT],
        )
        return dict(self.env.cr.fetchall())

    def _restore_upgrade_state(self):
        """What the pre-migration meets: nasq_notify adopted every row, nasq_pmo still owns its copies."""
        cr = self.env.cr
        for name in self.migration.MOVED_FIELDS:
            cr.execute(
                '''
                    INSERT INTO ir_model_data (module, name, model, res_id, noupdate)
                    SELECT 'nasq_pmo', name, model, res_id, false FROM ir_model_data
                     WHERE module = 'nasq_notify' AND name = %s
                ''',
                [name],
            )
        cr.execute(
            '''
                INSERT INTO ir_model_constraint
                       (name, module, model, type, definition, message, create_date, write_date, create_uid, write_uid)
                SELECT c.name, (SELECT id FROM ir_module_module WHERE name = 'nasq_pmo'), c.model, c.type,
                       c.definition, c.message, c.create_date, c.write_date, c.create_uid, c.write_uid
                  FROM ir_model_constraint c
                  JOIN ir_module_module m ON m.id = c.module
                 WHERE c.name = %s AND m.name = 'nasq_notify'
             RETURNING id
            ''',
            [self.migration.CONSTRAINT],
        )
        [[constraint_id]] = cr.fetchall()
        cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES ('nasq_pmo', %s, 'ir.model.constraint', %s, false)",
            [self.migration.CONSTRAINT_XMLID, constraint_id],
        )

    def test_a_fresh_install_is_owned_by_nasq_notify(self):
        self.assertEqual(set(self._xmlids('nasq_notify')), set(self.names))
        pmo = self._xmlids('nasq_pmo')
        self.assertFalse(set(pmo) & {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID})
        self.assertEqual(set(self._constraints()), {'nasq_notify'})
        for column in ('nasq_task_id', 'nasq_digest_count', 'nasq_digest_date', 'nasq_digest_task_ids'):
            self.assertTrue(self.env.ref(f'nasq_pmo.field_mail_message__{column}', raise_if_not_found=False), column)
        self.assertTrue(self.env.ref('nasq_pmo.selection__mail_message__nasq_notification_kind__assignment'))

    def test_the_columns_and_the_index_exist(self):
        self.env.cr.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'mail_message' AND column_name = ANY(%s)",
            [list(COLUMNS)],
        )
        self.assertEqual({row[0] for row in self.env.cr.fetchall()}, set(COLUMNS))
        self.env.cr.execute('SELECT indexdef FROM pg_indexes WHERE indexname = %s', [self.migration.CONSTRAINT])
        [[definition]] = self.env.cr.fetchall()
        self.assertIn('UNIQUE', definition)
        self.assertIn('nasq_notification_key IS NOT NULL', definition)

    def test_duplicates_are_dropped_and_a_rerun_is_a_no_op(self):
        notify = self._xmlids('nasq_notify')
        constraints = self._constraints()
        self._restore_upgrade_state()
        self.assertEqual(
            set(self._xmlids('nasq_pmo')) & {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID},
            {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID},
        )
        for _run in range(2):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
            self.assertFalse(set(self._xmlids('nasq_pmo')) & {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID})
            self.assertEqual(self._xmlids('nasq_notify'), notify)
            self.assertEqual(self._constraints(), constraints)

    def test_a_fresh_install_skips_the_migration(self):
        self._restore_upgrade_state()
        before = (self._xmlids('nasq_pmo'), self._constraints())
        self.migration.migrate(self.env.cr, None)
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)

    def test_a_row_nasq_notify_did_not_adopt_stops_before_any_delete(self):
        self._restore_upgrade_state()
        self.env.cr.execute(
            "DELETE FROM ir_model_data WHERE module = 'nasq_notify' AND name = 'field_mail_message__nasq_notification_key'",
        )
        before = (self._xmlids('nasq_pmo'), self._constraints())
        with self.assertRaisesRegex(ValueError, 'field_mail_message__nasq_notification_key'):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)

    def test_a_clash_stops_before_any_delete(self):
        self._restore_upgrade_state()
        other = self.env['ir.model.fields']._get('mail.message', 'subject')
        self.env.cr.execute(
            "UPDATE ir_model_data SET res_id = %s WHERE module = 'nasq_pmo' AND name = 'field_mail_message__nasq_notification'",
            [other.id],
        )
        before = (self._xmlids('nasq_pmo'), self._constraints())
        with self.assertRaisesRegex(ValueError, 'nasq_notify points at'):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)

    def test_a_missing_index_row_stops_before_any_delete(self):
        self._restore_upgrade_state()
        notify_constraint = self._constraints()['nasq_notify']
        self.env.cr.execute("DELETE FROM ir_model_data WHERE module = 'nasq_notify' AND name = %s", [self.migration.CONSTRAINT_XMLID])
        self.env.cr.execute('DELETE FROM ir_model_constraint WHERE id = %s', [notify_constraint])
        before = (self._xmlids('nasq_pmo'), self._constraints())
        with self.assertRaisesRegex(ValueError, 'unique index'):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)
