# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestCreateLinkValues(LiwanTasksCase):

    def service(self):
        return self.env['liwan.my.task.service'].with_user(self.alice)

    def test_a_create_without_link_values_is_unchanged(self):
        task = self.service()._create_task({'name': 'Plain', 'assignees': [self.alice.id]})
        self.assertTrue(task.liwan_personal)
        self.assertEqual(task.user_ids, self.alice)
        self.assertEqual(task.priority, '0')
        self.assertEqual(task.env.uid, self.alice.id)

    def test_link_values_are_creation_defaults_and_do_not_widen_the_wire_fields(self):
        task = self.service()._create_task({'name': 'Linked'}, link_values={'priority': '1'})
        self.assertEqual(task.priority, '1')
        # The context of the defaults does not follow the returned task.
        self.assertNotIn('default_priority', task.env.context)
        with self.assertRaisesRegex(Exception, 'priority is not supported|not supported'):
            self.service()._create_task({'name': 'x', 'unknown': 1}, link_values={'priority': '1'})
