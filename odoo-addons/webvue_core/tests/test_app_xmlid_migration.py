# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
import unittest

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

MIGRATION = 'webvue_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py'
# Phase 2b-2 handed these rows on from webvue_pmo to webvue_meetings (webvue_pmo
# 19.0.1.4.0). This test exercises the released Phase 2 step only: it reads
# the rows under their current owner and expects the Phase 2 owner back.
LATER_OWNER = {
    name: 'webvue_meetings'
    for name in (
        'group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage',
        'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
        'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    )
}
MEETING_RULES = ('rule_meeting_capability_scope', 'rule_resolution_capability_scope')
REQUIRED = {'webvue_hr', 'webvue_pmo', 'webvue_meetings'}


def _load_migration():
    spec = importlib.util.spec_from_file_location('webvue_core_pre_move_app_xmlids', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAppXmlidMigration(TransactionCase):
    """The 19.0.1.1.0 pre-migration renames release rows in place (spec 3.2, ruling R-A)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        installed = {
            module.name
            for module in cls.env['ir.module.module'].search([('name', 'in', sorted(REQUIRED)), ('state', '=', 'installed')])
        }
        if installed != REQUIRED:
            reason = 'needs webvue_hr, webvue_pmo and webvue_meetings installed'
            raise unittest.SkipTest(reason)
        cls.migration = _load_migration()
        cls.moved = [
            (module, name)
            for module, names in cls.migration.MOVED_XMLIDS.items()
            for name in names
        ]
        cls.current = {(module, name): (LATER_OWNER.get(name, module), name) for module, name in cls.moved}
        cls.modules = ['webvue_core', *cls.migration.MOVED_XMLIDS, 'webvue_meetings']

    def _rows(self):
        self.env.cr.execute(
            'SELECT module, name, model, res_id, noupdate FROM ir_model_data WHERE module = ANY(%s) AND name = ANY(%s)',
            [self.modules, [name for _module, name in self.moved]],
        )
        return {(module, name): (model, res_id, noupdate) for module, name, model, res_id, noupdate in self.env.cr.fetchall()}

    def _phase2_view(self, rows):
        """The rows as the Phase 2 migration leaves them: the meeting rows under webvue_pmo."""
        back = {current: phase2 for phase2, current in self.current.items()}
        return {back.get(key, key): value for key, value in rows.items()}

    def _group_xmlids(self):
        self.env.cr.execute('SELECT key, group_xmlid FROM webvue_access_permission')
        # Only the groups this migration moves; an application added later owns
        # permissions (and groups) of its own that the migration never touches.
        moved = {name for _module, name in self.moved}
        return {key: xmlid for key, xmlid in self.env.cr.fetchall() if xmlid.split('.', 1)[1] in moved}

    def _restore_release_state(self):
        for module, name in self.moved:
            owner = LATER_OWNER.get(name, module)
            self.env.cr.execute(
                "UPDATE ir_model_data SET module = 'webvue_core' WHERE module = %s AND name = %s",
                [owner, name],
            )
            if name.startswith('group_cap_'):
                self.env.cr.execute(
                    'UPDATE webvue_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                    [f'webvue_core.{name}', f'{owner}.{name}'],
                )

    def test_release_rows_are_renamed_in_place_and_a_rerun_is_a_no_op(self):
        installed = self._phase2_view(self._rows())
        self.assertEqual(sorted(key for key in installed if key in self.moved), sorted(self.moved))
        group_xmlids = {
            key: value.replace('webvue_meetings.', 'webvue_pmo.', 1) for key, value in self._group_xmlids().items()
        }

        self._restore_release_state()
        release = self._rows()
        self.assertEqual({module for module, _name in release}, {'webvue_core'})
        self.assertEqual(self._group_xmlids(), {
            key: 'webvue_core.' + value.split('.', 1)[1] for key, value in group_xmlids.items()
        })

        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), installed)
        self.assertEqual(self._group_xmlids(), group_xmlids)

        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), installed)
        self.assertEqual(self._group_xmlids(), group_xmlids)

    def test_fresh_install_skips_the_migration(self):
        before = self._rows()
        self._restore_release_state()
        release = self._rows()
        self.migration.migrate(self.env.cr, None)
        self.assertEqual(self._rows(), release)
        self.assertNotEqual(release, before)

    def test_a_duplicate_row_stops_the_upgrade_before_any_rename(self):
        module, name = self.moved[0]
        model, res_id, _noupdate = self._rows()[module, name]
        self.env.cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES ('webvue_core', %s, %s, %s, false)",
            [name, model, res_id],
        )
        before = self._rows()
        with self.assertRaisesRegex(ValueError, f'webvue_core.{name} and {module}.{name}'):
            self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), before)

    def _meeting_rules(self):
        rows = self._rows()
        res_ids = [(rows.get(('webvue_pmo', name)) or rows['webvue_meetings', name])[1] for name in MEETING_RULES]
        return self.env['ir.rule'].browse(res_ids)

    def _set_pmo_state(self, state):
        self.env.cr.execute("UPDATE ir_module_module SET state = %s WHERE name = 'webvue_pmo'", [state])

    def test_meeting_rules_fail_closed_when_webvue_pmo_is_not_installed(self):
        self._restore_release_state()
        self._set_pmo_state('uninstalled')
        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        rules = self._meeting_rules()
        self.env.invalidate_all()
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules.mapped('domain_force'), ["[(0, '=', 1)]"] * 2)
        self.assertTrue(all(rules.mapped('active')))

    def test_meeting_rules_are_left_alone_when_webvue_pmo_is_installed(self):
        before = self._meeting_rules().mapped('domain_force')
        self._restore_release_state()
        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.env.invalidate_all()
        after = self._meeting_rules().mapped('domain_force')
        self.assertEqual(after, before)
        self.assertNotIn("[(0, '=', 1)]", after)
