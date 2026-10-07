# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

from odoo.addons.nasq_meetings import hooks

MIGRATION = 'nasq_pmo/migrations/19.0.1.4.0/pre-hand_meetings_to_nasq_meetings.py'


def _load_migration():
    spec = importlib.util.spec_from_file_location('nasq_pmo_pre_hand_meetings', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingsOwnershipMigration(TransactionCase):
    """nasq_pmo 19.0.1.4.0 and nasq_meetings' pre_init_hook hand the meeting rows over in place (plan 2b-2, Deviation 1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.m = _load_migration()
        cls.owners = {
            **{name: cls.m.MEETINGS for name in cls.m.MEETINGS_XMLIDS},
            **{name: cls.m.BRIDGE for name in cls.m.BRIDGE_XMLIDS},
        }
        cls.constraint_owners = {
            **{name: cls.m.MEETINGS for name in cls.m.MEETINGS_CONSTRAINTS},
            **{name: cls.m.BRIDGE for name in cls.m.BRIDGE_CONSTRAINTS},
        }

    # The rows move under the ORM's feet: every reader below is plain SQL.

    def _module_id(self, name):
        self.env.cr.execute('SELECT id FROM ir_module_module WHERE name = %s', [name])
        return self.env.cr.fetchone()[0]

    def _xmlids(self):
        self.env.cr.execute(
            'SELECT module, name, model, res_id FROM ir_model_data WHERE name = ANY(%s) AND module IN %s',
            [list(self.owners), (self.m.SOURCE, self.m.MEETINGS, self.m.BRIDGE)],
        )
        return {(module, name): (model, res_id) for module, name, model, res_id in self.env.cr.fetchall()}

    def _owned_rows(self, table, names):
        self.env.cr.execute(
            f'SELECT t.name, m.name FROM {table} t JOIN ir_module_module m ON m.id = t.module WHERE t.name = ANY(%s)',
            [list(names)],
        )
        return sorted(self.env.cr.fetchall())

    def _group_xmlids(self):
        self.env.cr.execute("SELECT key, group_xmlid FROM nasq_access_permission WHERE key LIKE 'meetings.%%' ORDER BY key")
        return self.env.cr.fetchall()

    def _rule_domains(self):
        self.env.cr.execute(
            "SELECT d.name, r.domain_force FROM ir_rule r JOIN ir_model_data d ON d.model = 'ir.rule' AND d.res_id = r.id "
            'WHERE d.name = ANY(%s) AND d.module IN %s ORDER BY d.name',
            [list(self.m.RULES), (self.m.SOURCE, self.m.MEETINGS)],
        )
        return self.env.cr.fetchall()

    def _states(self):
        self.env.cr.execute('SELECT name, state FROM ir_module_module WHERE name IN %s', [(self.m.MEETINGS, self.m.BRIDGE)])
        return dict(self.env.cr.fetchall())

    def _snapshot(self):
        return (
            self._xmlids(),
            self._owned_rows('ir_model_constraint', self.constraint_owners),
            self._owned_rows('ir_model_relation', self.m.MEETINGS_RELATIONS),
            self._group_xmlids(),
            self._rule_domains(),
        )

    def _restore_upgrade_state(self):
        """What the pre-migration meets on a 19.0.1.3.0 database: nasq_pmo owns every row, neither addon is installed."""
        m, cr = self.m, self.env.cr
        for name, owner in self.owners.items():
            cr.execute('UPDATE ir_model_data SET module = %s WHERE module = %s AND name = %s', [m.SOURCE, owner, name])
        source = self._module_id(m.SOURCE)
        for name, owner in self.constraint_owners.items():
            cr.execute(
                'UPDATE ir_model_constraint SET module = %s WHERE name = %s AND module = %s',
                [source, name, self._module_id(owner)],
            )
        for name in m.MEETINGS_RELATIONS:
            cr.execute(
                'UPDATE ir_model_relation SET module = %s WHERE name = %s AND module = %s',
                [source, name, self._module_id(m.MEETINGS)],
            )
        for name in m.GROUPS:
            cr.execute(
                'UPDATE nasq_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                [f'{m.SOURCE}.{name}', f'{m.MEETINGS}.{name}'],
            )
        cr.execute("UPDATE ir_module_module SET state = 'uninstalled' WHERE name IN %s", [(m.MEETINGS, m.BRIDGE)])
        self.env.invalidate_all()

    def test_a_fresh_install_owns_every_listed_row(self):
        m = self.m
        xmlids = self._xmlids()
        for name, owner in self.owners.items():
            self.assertIn((owner, name), xmlids, name)
            self.assertNotIn((m.SOURCE, name), xmlids, name)
        self.assertEqual(self._owned_rows('ir_model_constraint', self.constraint_owners), sorted(self.constraint_owners.items()))
        self.assertEqual(
            self._owned_rows('ir_model_relation', m.MEETINGS_RELATIONS),
            [(name, m.MEETINGS) for name in sorted(m.MEETINGS_RELATIONS)],
        )
        self.env.cr.execute('SELECT name FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [m.SOURCE, list(m.LEFT_TO_ODOO)])
        self.assertEqual(self.env.cr.fetchall(), [])
        self.assertEqual({value for _key, value in self._group_xmlids()}, {f'{m.MEETINGS}.{name}' for name in m.GROUPS})
        self.assertEqual(self._states(), {m.MEETINGS: 'installed', m.BRIDGE: 'installed'})

    def test_the_hook_and_the_migration_name_the_same_rows(self):
        self.assertEqual(set(hooks.OWNED_XMLIDS), set(self.m.MEETINGS_XMLIDS))
        self.assertEqual(tuple(hooks.GROUPS), tuple(self.m.GROUPS))
        self.assertEqual((hooks.SOURCE, hooks.TARGET), (self.m.SOURCE, self.m.MEETINGS))

    def test_rows_are_renamed_in_place_and_a_rerun_is_a_no_op(self):
        before = self._snapshot()
        self._restore_upgrade_state()
        self.assertNotEqual(self._snapshot(), before)
        for _run in range(2):
            self.m.migrate(self.env.cr, '19.0.1.3.0')
            self.assertEqual(self._snapshot(), before)
            self.assertEqual(self._states(), {self.m.MEETINGS: 'to install', self.m.BRIDGE: 'to install'})

    def test_a_fresh_install_skips_the_migration(self):
        self._restore_upgrade_state()
        restored = (self._snapshot(), self._states())
        self.m.migrate(self.env.cr, None)
        self.assertEqual((self._snapshot(), self._states()), restored)

    def test_the_hook_adopts_the_meeting_rows_before_nasq_pmo_upgrades(self):
        m = self.m
        before = self._snapshot()
        self._restore_upgrade_state()
        hooks.pre_init_hook(self.env)
        xmlids = self._xmlids()
        for name in m.MEETINGS_XMLIDS:
            self.assertIn((m.MEETINGS, name), xmlids, name)
        for name in m.BRIDGE_XMLIDS:
            self.assertIn((m.SOURCE, name), xmlids, name)
        self.assertEqual({value for _key, value in self._group_xmlids()}, {f'{m.MEETINGS}.{name}' for name in m.GROUPS})
        hooks.pre_init_hook(self.env)
        m.migrate(self.env.cr, '19.0.1.3.0')
        self.assertEqual(self._snapshot(), before)

    def test_rows_the_target_already_reflected_are_adopted(self):
        m, cr = self.m, self.env.cr
        before = self._snapshot()
        self._restore_upgrade_state()
        hooks.pre_init_hook(self.env)
        meetings = self._module_id(m.MEETINGS)
        cr.execute(
            '''
                INSERT INTO ir_model_constraint
                       (name, module, model, type, definition, message, create_date, write_date, create_uid, write_uid)
                SELECT name, %s, model, type, definition, message, create_date, write_date, create_uid, write_uid
                  FROM ir_model_constraint WHERE name = 'nasq_meeting_series_company_id_fkey'
            ''',
            [meetings],
        )
        cr.execute(
            '''
                INSERT INTO ir_model_relation (name, module, model, create_date, write_date, create_uid, write_uid)
                SELECT name, %s, model, create_date, write_date, create_uid, write_uid
                  FROM ir_model_relation WHERE name = 'nasq_meeting_series_attendee_rel'
            ''',
            [meetings],
        )
        m.migrate(cr, '19.0.1.3.0')
        self.assertEqual(self._snapshot(), before)

    def test_a_duplicate_reflection_xml_id_is_adopted(self):
        m, cr = self.m, self.env.cr
        before = self._snapshot()
        self._restore_upgrade_state()
        cr.execute(
            "SELECT model, res_id FROM ir_model_data WHERE module = %s AND name = 'field_nasq_meeting_series__name'",
            [m.SOURCE],
        )
        model, res_id = cr.fetchone()
        cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES (%s, 'field_nasq_meeting_series__name', %s, %s, false)",
            [m.MEETINGS, model, res_id],
        )
        m.migrate(cr, '19.0.1.3.0')
        self.assertEqual(self._snapshot(), before)

    def test_a_clash_stops_before_any_change(self):
        m, cr = self.m, self.env.cr
        self._restore_upgrade_state()
        other = self.env['res.groups'].create({'name': 'Ownership clash group'})
        self.env.flush_all()
        cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES (%s, 'group_cap_meetings_read', 'res.groups', %s, false)",
            [m.MEETINGS, other.id],
        )
        restored = (self._snapshot(), self._states())
        with self.assertRaisesRegex(ValueError, 'group_cap_meetings_read'):
            m.migrate(cr, '19.0.1.3.0')
        self.assertEqual((self._snapshot(), self._states()), restored)
        with self.assertRaisesRegex(ValueError, 'group_cap_meetings_read'):
            hooks.pre_init_hook(self.env)
        self.assertEqual((self._snapshot(), self._states()), restored)

    def test_the_rules_fail_closed_when_nasq_meetings_cannot_be_installed(self):
        m, cr = self.m, self.env.cr
        self._restore_upgrade_state()
        cr.execute("UPDATE ir_module_module SET state = 'uninstallable' WHERE name = %s", [m.MEETINGS])
        m.migrate(cr, '19.0.1.3.0')
        self.assertEqual(self._states(), {m.MEETINGS: 'uninstallable', m.BRIDGE: 'uninstalled'})
        self.assertEqual([domain for _name, domain in self._rule_domains()], [m.CLOSED_DOMAIN] * len(m.RULES))
        xmlids = self._xmlids()
        for name, owner in self.owners.items():
            self.assertIn((owner, name), xmlids, name)
