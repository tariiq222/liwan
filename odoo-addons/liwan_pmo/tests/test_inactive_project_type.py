# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_pmo.serializers.project_charter import dump_charter


@tagged('post_install', '-at_install', 'liwan')
class TestInactiveProjectType(TransactionCase):
    """A disabled project type stays shown on the charters that use it (#242)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Permission = cls.env['liwan.access.permission']
        role = cls.env['liwan.access.role'].create({
            'name_ar': 'قارئ المشاريع', 'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, Permission.search([('key', 'in', ['pmo.projects.read', 'pmo.tasks.read'])]).ids)],
        })
        cls.reader = new_test_user(cls.env, login='inactive_type_reader', groups='base.group_user')
        cls.env['liwan.access.assignment'].create({'user_id': cls.reader.id, 'role_id': role.id, 'company_id': cls.env.company.id})
        cls.type = cls.env['liwan.project.type'].search([('company_id', '=', cls.env.company.id)], limit=1)
        cls.project = cls.env['project.project'].create({
            'name': 'Typed project', 'company_id': cls.env.company.id, 'liwan_type_id': cls.type.id,
        })
        cls.type.active = False

    def test_a_reader_sees_the_disabled_type_of_a_project(self):
        charter = dump_charter(self.project.with_user(self.reader))
        self.assertEqual((charter['type']['id'], charter['type']['name']), (self.type.id, self.type.name))
