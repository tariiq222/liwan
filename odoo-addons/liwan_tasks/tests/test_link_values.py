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

    def partner(self, name='Visible'):
        return self.env['res.partner'].create({'name': name, 'company_id': self.alice.company_id.id})

    def test_a_registered_link_field_is_set_on_create(self):
        partner = self.partner()
        with self.register('partner_id'):
            task = self.service()._create_task({'name': 'Linked'}, link_values={'partner_id': partner.id})
        self.assertEqual(task.partner_id, partner)
        self.assertNotIn('default_partner_id', task.env.context)

    def test_an_unregistered_link_field_is_refused_and_creates_nothing(self):
        before = self.env['project.task'].search_count([('name', '=', 'Refused')])
        with self.register('partner_id'), self.assertRaisesRegex(ValueError, 'priority'):
            self.service()._create_task({'name': 'Refused'}, link_values={'partner_id': self.partner().id, 'priority': '1'})
        self.assertEqual(self.env['project.task'].search_count([('name', '=', 'Refused')]), before)

    def test_a_link_field_is_never_a_wire_field(self):
        with self.register('partner_id'), self.assertRaisesRegex(Exception, 'partner_id is not supported'):
            self.service()._create_task({'name': 'x', 'partner_id': self.partner().id})

    def test_a_registered_link_field_that_is_not_a_many2one_is_a_programmer_error(self):
        Task = self.env['project.task'].with_user(self.alice)
        for name in ('color', 'child_ids'):
            with self.subTest(field=name), self.register(name), self.assertRaisesRegex(TypeError, f'{name} must be a many2one'):
                Task.create({'name': 'x', 'company_id': self.alice.company_id.id})

    def test_a_default_context_value_is_checked_like_a_value(self):
        hidden = self.env['res.partner'].create({'name': 'Hidden', 'company_id': self.other_company.id})
        visible = self.partner()
        Task = self.env['project.task'].with_user(self.alice)
        vals = {'name': 'Linked', 'company_id': self.alice.company_id.id}
        with self.register('partner_id'):
            with self.assertRaisesRegex(AccessError, 'Task fields are not allowed'):
                Task.with_context(default_partner_id=hidden.id).create(vals)
            self.assertEqual(Task.with_context(default_partner_id=visible.id).create(vals).partner_id, visible)
            # A value in the vals wins over the default, as in the ORM.
            self.assertEqual(
                Task.with_context(default_partner_id=hidden.id).create({**vals, 'partner_id': visible.id}).partner_id, visible)

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

    def test_a_stored_ir_default_is_checked_like_a_value(self):
        hidden = self.env['res.partner'].create({'name': 'Hidden', 'company_id': self.other_company.id})
        visible = self.partner()
        Task = self.env['project.task'].with_user(self.alice)
        vals = {'name': 'Linked', 'company_id': self.alice.company_id.id}
        with self.register('partner_id'):
            self.env['ir.default'].set('project.task', 'partner_id', hidden.id, user_id=self.alice.id)
            with self.assertRaisesRegex(AccessError, 'Task fields are not allowed'):
                Task.create(vals)
            self.env['ir.default'].set('project.task', 'partner_id', visible.id, user_id=self.alice.id)
            self.assertEqual(Task.create(vals).partner_id, visible)
