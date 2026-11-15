# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import tagged

from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestCreateLinkValues(LiwanTasksCase):

    def service(self):
        return self.env['liwan.my.task.service'].with_user(self.alice)

    def register(self, *names):
        """Register ``names`` as link fields, as a bridge does through its model override."""
        return patch.object(type(self.env['project.task']), '_liwan_task_link_fields',
                            lambda _self: frozenset(names))

    def test_a_create_without_link_values_is_unchanged(self):
        task = self.service()._create_task({'name': 'Plain', 'assignees': [self.alice.id]})
        self.assertTrue(task.liwan_personal)
        self.assertEqual(task.user_ids, self.alice)
        self.assertEqual(task.priority, '0')
        self.assertEqual(task.env.uid, self.alice.id)

    def test_a_registered_link_field_is_set_on_create(self):
        with self.register('color'):
            task = self.service()._create_task({'name': 'Linked'}, link_values={'color': 3})
        self.assertEqual(task.color, 3)
        self.assertNotIn('default_color', task.env.context)

    def test_an_unregistered_link_field_is_refused_and_creates_nothing(self):
        before = self.env['project.task'].search_count([('name', '=', 'Refused')])
        with self.register('color'), self.assertRaisesRegex(ValueError, 'priority'):
            self.service()._create_task({'name': 'Refused'}, link_values={'color': 3, 'priority': '1'})
        self.assertEqual(self.env['project.task'].search_count([('name', '=', 'Refused')]), before)

    def test_a_link_field_is_never_a_wire_field(self):
        with self.register('color'), self.assertRaisesRegex(Exception, 'color is not supported'):
            self.service()._create_task({'name': 'x', 'color': 3})
