# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq')
class TestProjectStatus(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pmo_emp', groups='nasq_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pmo_mgr',
                                    groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Status project'})

    def test_manager_sets_status_and_odoo_records_an_update(self):
        project = self.project.with_user(self.manager)
        self.assertEqual(project.last_update_status, 'to_define')
        project._nasq_set_status('at_risk')
        self.assertEqual(project.last_update_status, 'at_risk')
        update = self.env['project.update'].search([('project_id', '=', self.project.id)])
        self.assertEqual(len(update), 1)
        self.assertEqual(update.status, 'at_risk')

    def test_employee_cannot_set_status(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.employee)._nasq_set_status('on_track')
        self.assertEqual(self.project.last_update_status, 'to_define')

    def test_unknown_value_is_a_value_error(self):
        with self.assertRaises(ValueError):
            self.project.with_user(self.manager)._nasq_set_status('to_define')

    def test_can_manage(self):
        self.assertFalse(self.project.with_user(self.employee)._nasq_can_manage())
        self.assertTrue(self.project.with_user(self.manager)._nasq_can_manage())


@tagged('nasq')
class TestProjectCompletionStatus(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='pmo_done_mgr',
                                    groups='nasq_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Completion project'})

    def _task(self, name, state='01_in_progress'):
        return self.env['project.task'].create({'name': name, 'project_id': self.project.id, 'state': state})

    def _updates(self):
        return self.env['project.update'].search([('project_id', '=', self.project.id)], order='id desc')

    def test_all_tasks_done_completes_and_reopen_restores(self):
        self.project.with_user(self.manager)._nasq_set_status('at_risk')
        first, second = self._task('A'), self._task('B')
        first.write({'state': '1_done'})
        self.assertEqual(self.project.last_update_status, 'at_risk')
        second.write({'state': '1_done'})
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertTrue(self.project.nasq_status_auto_done)
        self.assertEqual(self._updates()[0].status, 'done')
        second.write({'state': '01_in_progress'})
        self.assertEqual(self.project.last_update_status, 'at_risk')
        self.assertFalse(self.project.nasq_status_auto_done)

    def test_cancelled_tasks_do_not_block_but_do_not_complete_alone(self):
        cancelled = self._task('Cancelled', '1_canceled')
        self.assertEqual(self.project.last_update_status, 'to_define')
        self._task('Done', '1_done')
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertTrue(cancelled.exists())

    def test_project_without_tasks_never_completes(self):
        self.project._nasq_sync_completion_status()
        self.assertEqual(self.project.last_update_status, 'to_define')
        self.assertFalse(self._updates())

    def test_new_task_reopens_to_on_track_when_there_was_no_status(self):
        self._task('Done', '1_done')
        self.assertEqual(self.project.last_update_status, 'done')
        self._task('New work')
        self.assertEqual(self.project.last_update_status, 'on_track')

    def test_archiving_the_last_open_task_completes(self):
        self._task('Done', '1_done')
        open_task = self._task('Open')
        self.assertFalse(self.project.nasq_status_auto_done)
        open_task.write({'active': False})
        self.assertEqual(self.project.last_update_status, 'done')

    def test_manual_status_is_not_reverted(self):
        task = self._task('Open')
        self.project.with_user(self.manager)._nasq_set_status('done')
        task.write({'state': '1_done'})
        task.write({'state': '01_in_progress'})
        self.assertEqual(self.project.last_update_status, 'done')

    def test_manual_change_after_auto_completion_wins(self):
        task = self._task('Done', '1_done')
        self.project.with_user(self.manager)._nasq_set_status('on_hold')
        self.assertFalse(self.project.nasq_status_auto_done)
        task.write({'state': '01_in_progress'})
        self.assertEqual(self.project.last_update_status, 'on_hold')

    def test_moving_the_open_task_away_completes_its_old_project(self):
        other = self.env['project.project'].create({'name': 'Other project'})
        self._task('Done', '1_done')
        moving = self._task('Moving')
        moving.write({'project_id': other.id})
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertEqual(other.last_update_status, 'to_define')

    def test_backfill_completes_existing_projects_once(self):
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('nasq_pmo.completion_status_backfill_v1_done', False)
        # An existing project whose tasks all closed before the feature existed.
        self._task('Old done', '1_done')
        self.project.write({
            'last_update_status': 'on_track', 'nasq_status_auto_done': False, 'nasq_status_before_auto_done': False,
        })
        self.assertEqual(self.project.last_update_status, 'on_track')
        self.env['project.project']._nasq_backfill_completion_status()
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertTrue(self.project.nasq_status_auto_done)
        # A manager's later choice survives a second module update.
        self.project.with_user(self.manager)._nasq_set_status('on_hold')
        self.env['project.project']._nasq_backfill_completion_status()
        self.assertEqual(self.project.last_update_status, 'on_hold')

    def test_backfill_requires_superuser(self):
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(self.manager)._nasq_backfill_completion_status()
