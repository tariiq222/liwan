# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError
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

    def test_a_link_target_the_creator_cannot_read_is_refused(self):
        hidden = self.env['res.partner'].create({'name': 'Hidden', 'company_id': self.other_company.id})
        visible = self.env['res.partner'].create({'name': 'Visible', 'company_id': self.alice.company_id.id})
        Task = self.env['project.task'].with_user(self.alice)
        vals = {'name': 'Linked', 'company_id': self.alice.company_id.id}
        with self.register('partner_id'):
            self.assertFalse(hidden.with_user(self.alice).has_access('read'))
            for target in (hidden.id, 2 ** 30):
                with self.subTest(target=target), self.assertRaisesRegex(AccessError, 'Task fields are not allowed'):
                    Task.create({**vals, 'partner_id': target})
            self.assertEqual(Task.create({**vals, 'partner_id': visible.id}).partner_id, visible)

    def test_a_write_of_a_link_to_an_unreadable_target_is_refused(self):
        if self.env['ir.module.module'].search_count([('name', '=', 'liwan_tasks_pmo'), ('state', '=', 'installed')]):
            self.skipTest('with liwan_tasks_pmo the personal write whitelist refuses link fields first')
        hidden = self.env['res.partner'].create({'name': 'Hidden', 'company_id': self.other_company.id})
        visible = self.env['res.partner'].create({'name': 'Visible', 'company_id': self.alice.company_id.id})
        task = self.make_personal_task(self.alice).with_user(self.alice)
        with self.register('partner_id'):
            for target in (hidden.id, 2 ** 30):
                with self.subTest(target=target), self.assertRaisesRegex(AccessError, 'Task fields are not allowed'):
                    task.write({'partner_id': target})
            task.write({'partner_id': visible.id})
            self.assertEqual(task.partner_id, visible)
            task.write({'partner_id': False})
            self.assertFalse(task.partner_id)
