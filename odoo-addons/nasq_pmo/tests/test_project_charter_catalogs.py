# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import NasqPmoCase

CATALOG_KEYS = {'id', 'name', 'sequence', 'active'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjectCharterCatalogApi(NasqPmoCase):

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('nasq_pmo.project_creators', 'managers')

    def test_types_seeded_and_owning_units_empty(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        types = self.api('GET', '/api/v1/project-charter/catalogs/types').json()
        self.assertEqual(set(types), {'items', 'total'})
        self.assertEqual(types['total'], 4)
        self.assertEqual([item['name'] for item in types['items']], ['تقني', 'تشغيلي', 'إنشائي', 'تطويري'])
        self.assertEqual(set(types['items'][0]), CATALOG_KEYS)
        units = self.api('GET', '/api/v1/project-charter/catalogs/owning-units').json()
        self.assertEqual((units['items'], units['total']), ([], 0))
        defaults = self.api('GET', '/api/v1/project-charter/defaults').json()
        self.assertEqual(set(defaults), {'currency'})
        self.assertIsNotNone(defaults['currency'])
        self.assertEqual(set(defaults['currency']), {'id', 'name', 'symbol', 'decimal_places'})

    def test_settings_manage_create_rename_order_deactivate_delete(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        forbidden = self.api('POST', '/api/v1/project-charter/catalogs/owning-units', {'name': 'Ops'})
        self.assertEqual(forbidden.status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/project-charter/catalogs/owning-units', {'name': 'Ops', 'sequence': 5})
        self.assertEqual(created.status_code, 201)
        item = created.json()
        self.assertEqual((item['name'], item['sequence'], item['active']), ('Ops', 5, True))
        patched = self.api('PATCH', f"/api/v1/project-charter/catalogs/owning-units/{item['id']}", {
            'name': 'Operations', 'sequence': 20, 'active': False,
        })
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()['name'], 'Operations')
        self.assertFalse(patched.json()['active'])
        self.authenticate('api_emp', 'api_emp_pass_123')
        hidden = self.api('GET', '/api/v1/project-charter/catalogs/owning-units?active=0')
        self.assertEqual(hidden.status_code, 403)
        listed = self.api('GET', '/api/v1/project-charter/catalogs/owning-units').json()
        self.assertEqual(listed['total'], 0)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        inactive = self.api('GET', '/api/v1/project-charter/catalogs/owning-units?active=0').json()
        self.assertEqual(inactive['total'], 1)
        deleted = self.api('DELETE', f"/api/v1/project-charter/catalogs/owning-units/{item['id']}")
        self.assertEqual(deleted.json(), {'deleted': True})

    def test_delete_used_is_generic_conflict(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        unit = self.api('POST', '/api/v1/project-charter/catalogs/owning-units', {'name': 'Used'}).json()
        project = self.api('POST', '/api/v1/projects', {
            'name': 'Has unit',
            'date_end': '2035-12-31',
            'charter': {'owning_unit_id': unit['id']},
        }).json()
        self.api('POST', f"/api/v1/projects/{project['id']}/archive")
        res = self.api('DELETE', f"/api/v1/project-charter/catalogs/owning-units/{unit['id']}")
        self.assertEqual((res.status_code, res.json()['code']), (409, 'conflict'))
        self.assertNotIn('count', res.json())
        self.assertNotIn(str(project['id']), res.json()['message'])

    def test_unknown_resource_and_query(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/project-charter/catalogs/departments').status_code, 404)
        self.assertEqual(self.api('GET', '/api/v1/project-charter/catalogs/types?foo=1').status_code, 400)


@tagged('nasq')
class TestProjectCharterCatalogModel(TransactionCase):

    def _managed_user(self, login, permission_keys):
        user = new_test_user(self.env, login=login, groups='base.group_user')
        permissions = self.env['nasq.access.permission'].search([
            ('key', 'in', permission_keys),
        ])
        self.assertEqual(set(permissions.mapped('key')), set(permission_keys))
        role = self.env['nasq.access.role'].create({
            'name_ar': login,
            'permission_ids': [(6, 0, permissions.ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': user.id,
            'role_id': role.id,
            'company_id': self.env.company.id,
        })
        self.assertFalse(user.has_group('nasq_core.group_employee'))
        return user

    def test_seed_rename_repeated_and_new_company(self):
        types = self.env['nasq.project.type'].search([
            ('company_id', '=', self.env.company.id),
        ], order='sequence, id')
        self.assertEqual(types.mapped('seed_key'), ['technical', 'operational', 'construction', 'development'])
        technical = types.filtered(lambda t: t.seed_key == 'technical')
        technical.write({'name': 'Renamed technical', 'active': False})
        self.env['nasq.project.type']._nasq_seed_all_companies()
        self.env['nasq.project.type']._nasq_seed_all_companies()
        again = self.env['nasq.project.type'].with_context(active_test=False).search([
            ('company_id', '=', self.env.company.id),
            ('seed_key', '=', 'technical'),
        ])
        self.assertEqual(len(again), 1)
        self.assertEqual(again.name, 'Renamed technical')
        self.assertFalse(again.active)
        other = self.env['res.company'].create({'name': 'Charter Co'})
        seeded = self.env['nasq.project.type'].search([
            ('company_id', '=', other.id),
        ], order='sequence, id')
        self.assertEqual(seeded.mapped('name'), ['تقني', 'تشغيلي', 'إنشائي', 'تطويري'])
        units = self.env['nasq.project.owning.unit'].search([('company_id', '=', other.id)])
        self.assertFalse(units)

    def test_orm_capabilities_and_company_scope(self):
        employee = new_test_user(self.env, login='cat_emp', groups='nasq_core.group_employee')
        manager = new_test_user(
            self.env, login='cat_mgr',
            groups='nasq_core.group_employee,project.group_project_manager',
        )
        Type = self.env['nasq.project.type']
        with self.assertRaises(AccessError):
            Type.with_user(employee).create({'name': 'Extra'})
        created = Type.with_user(manager).create({'name': 'Extra'})
        self.assertEqual(created.company_id, self.env.company)
        other = self.env['res.company'].create({'name': 'Scope Co'})
        with self.assertRaises(AccessError):
            created.with_user(manager).write({'company_id': other.id})
        used = Type.search([('seed_key', '=', 'operational'), ('company_id', '=', self.env.company.id)], limit=1)
        self.env['project.project'].create({
            'name': 'Uses type',
            'company_id': self.env.company.id,
            'nasq_type_id': used.id,
        })
        with self.assertRaises(UserError):
            used.with_user(manager).unlink()

    def test_managed_capability_users_reach_catalog_model_guards(self):
        reader = self._managed_user('cat_managed_reader', ['pmo.projects.read'])
        creator = self._managed_user(
            'cat_managed_creator',
            ['pmo.projects.read', 'pmo.projects.create'],
        )
        settings_manager = self._managed_user(
            'cat_managed_settings',
            ['pmo.projects.read', 'pmo.settings.manage'],
        )
        Type = self.env['nasq.project.type']
        Unit = self.env['nasq.project.owning.unit']

        self.assertTrue(Type.with_user(reader).search([], limit=1))
        self.assertFalse(Unit.with_user(reader).search([], limit=1))
        self.assertTrue(Type.with_user(creator).search([], limit=1))
        with self.assertRaises(AccessError):
            Type.with_user(reader).create({'name': 'Reader cannot mutate'})
        with self.assertRaises(AccessError):
            Unit.with_user(creator).create({'name': 'Creator cannot mutate catalog'})

        created_type = Type.with_user(settings_manager).create({'name': 'Managed type'})
        created_unit = Unit.with_user(settings_manager).create({'name': 'Managed unit'})
        created_type.with_user(settings_manager).write({'name': 'Managed type renamed'})
        created_unit.with_user(settings_manager).write({'sequence': 25})
        self.assertEqual(created_type.name, 'Managed type renamed')
        self.assertEqual(created_unit.sequence, 25)
        created_type.with_user(settings_manager).unlink()
        created_unit.with_user(settings_manager).unlink()
