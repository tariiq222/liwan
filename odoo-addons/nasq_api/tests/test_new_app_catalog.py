# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import NasqApiCase

# A fourth application simulated without an addon (plan 2026-10-07-open-app-lists):
# its capabilities are registered through the same super() hook an application
# addon extends, and its permission records use a domain nasq_core does not list.
SALES = (
    {'key': 'sales.orders.read', 'owner': 'nasq_sales'},
    {'key': 'sales.orders.write', 'owner': 'nasq_sales'},
)
GROUP_XMLID = '__nasq_open_lists__.group_sales_orders'


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestNewApplicationCatalog(NasqApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='new_app_admin', password='new_app_admin_pass_123',
            groups='nasq_core.group_access_admin',
        )

    def setUp(self):
        super().setUp()
        service = type(self.env['nasq.access.service'])
        definitions = service._nasq_capability_definitions
        self.patch(service, '_nasq_capability_definitions', lambda model: (*definitions(model), *SALES))
        group = self.env['res.groups'].create({'name': 'Sales orders (open lists probe)'})
        module, name = GROUP_XMLID.split('.')
        self.env['ir.model.data'].create({
            'module': module, 'name': name, 'model': 'res.groups', 'res_id': group.id,
        })
        values = {
            'domain': 'sales', 'resource': 'orders', 'group_xmlid': GROUP_XMLID,
            'custom_role_allowed': True, 'sensitive': False, 'project_contextual': False,
        }
        Permission = self.env['nasq.access.permission']
        read = Permission.create({
            **values, 'key': 'sales.orders.read', 'action': 'read',
            'name_ar': 'قراءة طلبات البيع', 'name_en': 'Read sales orders',
            'description_ar': 'قراءة طلبات البيع', 'description_en': 'Read sales orders',
        })
        Permission.create({
            **values, 'key': 'sales.orders.write', 'action': 'write',
            'name_ar': 'تعديل طلبات البيع', 'name_en': 'Edit sales orders',
            'description_ar': 'تعديل طلبات البيع', 'description_en': 'Edit sales orders',
            'dependency_ids': [Command.set(read.ids)],
        })

    def test_the_catalog_serves_the_new_domain_unchanged(self):
        self.assertEqual(
            set(self.env['nasq.access.permission'].search([]).mapped('key')),
            set(self.env['nasq.access.service']._nasq_capability_map()),
        )
        self.authenticate('new_app_admin', 'new_app_admin_pass_123')
        response = self.api('GET', '/api/v1/admin/permissions')
        self.assertEqual(response.status_code, 200, response.text)
        items = {item['key']: item for item in response.json()['items']}
        self.assertEqual(items['sales.orders.write'], {
            'key': 'sales.orders.write', 'domain': 'sales', 'resource': 'orders', 'action': 'write',
            'label': {'ar': 'تعديل طلبات البيع', 'en': 'Edit sales orders'},
            'description': {'ar': 'تعديل طلبات البيع', 'en': 'Edit sales orders'},
            'dependencies': ['sales.orders.read'],
            'scopes': [{'kind': 'company', 'assignable': True}],
            'custom_role_allowed': True, 'sensitive': False,
        })
        self.assertEqual(items['sales.orders.read']['domain'], 'sales')

    def test_a_custom_role_carries_the_new_capabilities_to_me(self):
        self.authenticate('new_app_admin', 'new_app_admin_pass_123')
        created = self.api('POST', '/api/v1/admin/roles', {
            'name': {'ar': 'مندوب مبيعات', 'en': 'Sales clerk'},
            'description': 'Sales orders',
            'permissions': ['sales.orders.read', 'sales.orders.write'],
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['permissions'], ['sales.orders.read', 'sales.orders.write'])
        self.env['nasq.access.service']._nasq_replace_assignments(self.employee, [
            {'role_id': self.env.ref('nasq_core.role_employee').id, 'company_id': self.env.company.id},
            {'role_id': created.json()['id'], 'company_id': self.env.company.id},
        ])
        self.authenticate('api_emp', 'api_emp_pass_123')
        me = self.api('GET', '/api/v1/me')
        self.assertEqual(me.status_code, 200, me.text)
        self.assertTrue({'sales.orders.read', 'sales.orders.write'} <= set(me.json()['capabilities']))
