# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('liwan')
class TestProjectAdminModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pa_emp', groups='liwan_core.group_employee')
        cls.other = new_test_user(cls.env, login='pa_other', groups='liwan_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pa_mgr',
                                    groups='liwan_core.group_employee,project.group_project_manager')
        cls.admin = new_test_user(
            cls.env, login='pa_admin', groups='liwan_pmo.group_pmo_manager',
        )
        cls.project = cls.env['project.project'].create({'name': 'Admin project', 'user_id': cls.employee.id})
        cls.Settings = cls.env['liwan.pmo.settings']

    def setUp(self):
        super().setUp()
        # Plain PMO settings: the extensions of an installed bridge are left out, as in LiwanPmoCase.
        self.patch(type(self.Settings), '_liwan_settings_extensions', lambda _model: [])
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('liwan_pmo.project_creators', 'managers')
        params.set_param('liwan_pmo.default_stages', False)

    # --- rules -------------------------------------------------------------
    def test_can_manage_assigned_user_outside_group(self):
        self.assertTrue(self.project.with_user(self.employee)._liwan_can_manage())
        self.assertFalse(self.project.with_user(self.other)._liwan_can_manage())
        self.assertTrue(self.project.with_user(self.manager)._liwan_can_manage())
        self.assertTrue(self.project.with_user(self.admin)._liwan_can_manage())

    def test_create_policy_default_managers(self):
        self.assertEqual(self.Settings.get()['project_creators'], 'managers')
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(self.other)._liwan_create_from_policy('Nope')
        p = self.env['project.project'].with_user(self.manager)._liwan_create_from_policy('Ok', date_end='2031-01-01')
        self.assertEqual(p.user_id, self.manager)
        self.assertEqual(p.privacy_visibility, 'employees')
        self.assertTrue(p.allow_milestones)
        self.assertEqual(p.type_ids.sorted('sequence').mapped('name'), ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])
        self.assertEqual(p.type_ids.sorted('sequence').mapped('fold'), [False, False, False, True])

    def test_create_policy_employees_uses_sudo_but_keeps_creator(self):
        self.Settings.with_user(self.admin).set_values({'project_creators': 'employees'})
        p = self.env['project.project'].with_user(self.other)._liwan_create_from_policy('Mine', date_end='2031-01-01')
        self.assertEqual(p.create_uid, self.other)
        self.assertEqual(p.user_id, self.other)
        self.assertTrue(p.with_user(self.other)._liwan_can_manage())

    def test_settings_validation_and_access(self):
        params = self.env['ir.config_parameter'].sudo()
        legacy_before = (
            params.get_param('liwan_pmo.project_creators'),
            params.get_param('liwan_pmo.default_stages'),
        )
        self.assertEqual(
            self.Settings.with_user(self.manager).set_values({
                'project_creators': 'employees',
            })['project_creators'],
            'employees',
        )
        with self.assertRaises(ValueError):
            self.Settings.with_user(self.admin).set_values({'project_creators': 'anyone'})
        with self.assertRaises(ValueError):
            self.Settings.with_user(self.admin).set_values({'default_stages': []})
        with self.assertRaises(ValueError):
            self.Settings.with_user(self.admin).set_values({'default_stages': [{'name': ' ', 'fold': False}]})
        out = self.Settings.with_user(self.admin).set_values({'default_stages': [{'name': 'A', 'fold': True}]})
        self.assertEqual(out['default_stages'], [{'name': 'A', 'fold': True}])
        company = self.env.company
        company.invalidate_recordset([
            'liwan_pmo_settings_initialized', 'liwan_pmo_project_creators',
            'liwan_pmo_default_stages',
        ])
        self.assertTrue(company.liwan_pmo_settings_initialized)
        self.assertEqual(company.liwan_pmo_project_creators, 'employees')
        self.assertEqual(
            json.loads(company.liwan_pmo_default_stages),
            [{'name': 'A', 'fold': True}],
        )
        self.assertEqual(
            self.Settings.get(),
            {
                'project_creators': 'employees',
                'default_stages': [{'name': 'A', 'fold': True}],
                'require_manager_on_create': True,
                'require_end_date_on_create': True,
                'default_completion_approval': 'none',
                'deadline_reminders_enabled': True,
                'deadline_reminders_days_before': 1,
                'overdue_digest_enabled': True,
                'require_charter_approval': False,
                'close_with_open_tasks': 'block',
                'register_status_transitions': 'sequence',
                'extensions': [],
            },
        )
        self.assertEqual(
            (params.get_param('liwan_pmo.project_creators'), params.get_param('liwan_pmo.default_stages')),
            legacy_before,
        )

    def test_settings_get_falls_back_on_malformed_stored_stages(self):
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('liwan_pmo.default_stages', '{"x": 1}')
        stages = self.Settings.get()['default_stages']
        self.assertEqual(len(stages), 4)
        self.assertEqual([s['name'] for s in stages], ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])

        params.set_param('liwan_pmo.default_stages', '[{"fold": true}]')
        stages = self.Settings.get()['default_stages']
        self.assertEqual(len(stages), 4)
        self.assertEqual([s['name'] for s in stages], ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])

    # --- archive -----------------------------------------------------------
    def test_archive_rules(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._liwan_archive()
        self.project.with_user(self.employee)._liwan_archive()
        self.assertFalse(self.project.active)
        self.project.with_user(self.manager)._liwan_unarchive()
        self.assertTrue(self.project.active)

    def test_write_as_manager_rejects_non_whitelisted_field(self):
        with self.assertRaises(ValueError):
            self.project.with_user(self.manager)._liwan_write_as_manager({'company_id': 1})

    # --- stages ------------------------------------------------------------
    def test_stage_lifecycle(self):
        p = self.project.with_user(self.manager)
        a = p._liwan_add_stage('A')
        b = p._liwan_add_stage('B', fold=True)
        self.assertEqual(p.type_ids.sorted('sequence').ids, [a.id, b.id])
        self.assertTrue(b.fold)
        p._liwan_reorder_stages([b.id, a.id])
        self.assertEqual(p.type_ids.sorted(lambda s: (s.sequence, s.id)).ids, [b.id, a.id])
        with self.assertRaises(ValueError):
            p._liwan_reorder_stages([a.id])
        p._liwan_update_stage(a, {'name': 'A2', 'fold': True})
        self.assertEqual((a.name, a.fold), ('A2', True))
        task = self.env['project.task'].create({'name': 't', 'project_id': p.id, 'stage_id': a.id})
        with self.assertRaises(UserError) as cm:
            p._liwan_delete_stage(a)
        self.assertEqual(cm.exception.liwan_count, 1)
        task.write({'active': False})
        with self.assertRaises(UserError):
            p._liwan_delete_stage(a)  # archived tasks still count
        p._liwan_delete_stage(b)
        self.assertNotIn(b.id, p.type_ids.ids)
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._liwan_add_stage('X')

    # --- followers ---------------------------------------------------------
    def test_followers(self):
        p = self.project.with_user(self.manager)
        p._liwan_add_follower(self.other)
        self.assertIn(self.other, p._liwan_followers())
        p._liwan_remove_follower(self.other)
        self.assertNotIn(self.other, p._liwan_followers())
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._liwan_add_follower(self.other)

    def test_assigned_user_manages_followers(self):
        p = self.project.with_user(self.employee)
        p._liwan_add_follower(self.other)
        self.assertIn(self.other, p._liwan_followers())
        p._liwan_remove_follower(self.other)
        self.assertNotIn(self.other, p._liwan_followers())
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._liwan_add_follower(self.other)

    # --- milestones --------------------------------------------------------
    def test_milestones(self):
        p = self.project.with_user(self.manager)
        m = p._liwan_create_milestone('M1', deadline='2030-01-31')
        self.assertEqual(str(m.deadline), '2030-01-31')
        task = self.env['project.task'].create({'name': 't', 'project_id': p.id, 'milestone_id': m.id})
        self.assertEqual(p._liwan_milestone_task_counts(m), (1, 0))
        task.write({'state': '1_done'})
        self.assertEqual(p._liwan_milestone_task_counts(m), (1, 1))
        with self.assertRaises(UserError) as cm:
            p._liwan_delete_milestone(m)
        self.assertEqual(cm.exception.liwan_count, 1)
        p._liwan_update_milestone(m, {'is_reached': True})
        self.assertTrue(m.is_reached)
        task.write({'milestone_id': False})
        p._liwan_delete_milestone(m)
        self.assertFalse(m.exists())

    # --- updates -----------------------------------------------------------
    def test_post_update(self):
        p = self.project.with_user(self.manager)
        p._liwan_set_status('at_risk')
        u = p._liwan_post_update('Week 3', '<p>late</p>')
        self.assertEqual((u.status, u.name, u.description), ('at_risk', 'Week 3', '<p>late</p>'))
        self.assertEqual(self.project.last_update_status, 'at_risk')
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._liwan_post_update('x')

    # --- assigned-user-as-manager (Odoo ACL has no notion of it) -----------
    def test_assigned_user_sets_status(self):
        p = self.project.with_user(self.employee)
        p._liwan_set_status('at_risk')
        self.assertEqual(self.project.last_update_status, 'at_risk')
        with self.assertRaises(AccessError):
            self.project.with_user(self.other)._liwan_set_status('on_track')

    def test_assigned_user_creates_milestone_and_detaches_shared_stage(self):
        self.assertFalse(self.project.allow_milestones)
        p = self.project.with_user(self.employee)
        m = p._liwan_create_milestone('M1')
        self.assertTrue(self.project.allow_milestones)
        self.assertEqual(m.project_id, self.project)

        other_project = self.env['project.project'].create({'name': 'Other project'})
        stage = self.env['project.task.type'].create({
            'name': 'Shared', 'project_ids': [(6, 0, (self.project | other_project).ids)],
        })
        p._liwan_delete_stage(stage)
        self.assertNotIn(stage.id, self.project.type_ids.ids)
        self.assertIn(stage.id, other_project.type_ids.ids)
