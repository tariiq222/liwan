# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.nasq_tasks.tests.common import NasqTasksCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestTaskLinksPmo(NasqTasksCase):
    """The bridge fills the hooks of nasq.task.links: project tasks join the personal list."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = cls.env['project.project'].create({
            'name': 'Links project', 'company_id': cls.env.company.id,
        })

    def _project_task(self, name, assignees, project=None):
        return self.env['project.task'].create({
            'name': name, 'project_id': (project or self.project).id,
            'user_ids': [Command.set([user.id for user in assignees])],
        })

    def _list(self, user, **kwargs):
        args = {
            'closed': False, 'q': None, 'assigned': True, 'created': True,
            'sort': 'deadline', 'limit': 50, 'offset': 0, **kwargs,
        }
        rows, total = self.env['nasq.my.task.service'].with_user(user)._search_list(**args)
        self.assertEqual(total, len(rows))
        return rows

    def test_list_shows_assigned_project_task_with_source_project_and_href(self):
        assigned = self._project_task('Assigned project task', [self.alice])
        personal = self.make_personal_task(self.alice, 'Mine')
        rows = self._list(self.alice)
        self.assertEqual(set(rows.ids), {assigned.id, personal.id})
        links = self.env['nasq.task.links'].with_user(self.alice)
        self.assertEqual(links._nasq_project_ref(rows.filtered(lambda t: t == assigned)), {
            'id': self.project.id, 'name': 'Links project',
            'href': f'/projects/{self.project.id}/tasks/{assigned.id}',
        })
        self.assertIsNone(links._nasq_project_ref(rows.filtered(lambda t: t == personal)))

    def test_project_task_not_assigned_to_me_is_absent(self):
        self._project_task('Bob only', [self.bob])
        mine = self._project_task('Both', [self.alice, self.bob])
        self.assertEqual(self._list(self.alice).ids, mine.ids)
        self.assertEqual(len(self._list(self.carol)), 0)

    def test_archived_project_task_absent(self):
        task = self._project_task('Soon archived', [self.alice])
        task.active = False
        self.assertNotIn(task, self._list(self.alice))

    def test_task_of_an_archived_project_is_absent(self):
        project = self.env['project.project'].create({
            'name': 'Old project', 'company_id': self.env.company.id,
        })
        task = self._project_task('In old project', [self.alice], project=project)
        self.assertIn(task, self._list(self.alice))
        project.active = False
        task.invalidate_recordset()
        self.assertNotIn(task, self._list(self.alice))

    def test_closed_project_task_follows_the_closed_filter(self):
        task = self._project_task('Done upstream', [self.alice])
        task.state = '1_done'
        self.assertNotIn(task, self._list(self.alice))
        self.assertIn(task, self._list(self.alice, closed=True))

    def test_project_ref_is_none_for_a_personal_task(self):
        links = self.env['nasq.task.links'].with_user(self.alice)
        self.assertIsNone(links._nasq_project_ref(self.make_personal_task(self.alice)))

    def test_can_convert_is_for_open_personal_top_level_tasks_only(self):
        links = self.env['nasq.task.links'].with_user(self.alice)
        service = self.env['nasq.my.task.service'].with_user(self.alice)
        task = self.make_personal_task(self.alice, 'top')
        self.assertTrue(links._nasq_can_convert(task))
        child = service._create_task({'name': 'child', 'parent_id': task.id})
        self.assertFalse(links._nasq_can_convert(child))
        task.state = '1_done'
        self.assertFalse(links._nasq_can_convert(task))
        # A project task is not a personal task: there is nothing to convert.
        project_task = self._project_task('already', [self.alice])
        self.assertFalse(links._nasq_can_convert(project_task))
