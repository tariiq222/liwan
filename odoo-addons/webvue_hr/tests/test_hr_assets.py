# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature

EQUIPMENT_KEYS = {
    'id', 'name', 'category', 'serial_no', 'model', 'employee',
    'assign_date', 'warranty_date', 'scrap_date', 'active',
}
REF_KEYS = {'id', 'name'}
# Never serialized: cost, vendor, technician, team, requests, properties and note.
EQUIPMENT_EXCLUDED_KEYS = (
    'cost', 'partner_id', 'partner_ref', 'technician_user_id', 'note',
    'maintenance_team_id', 'equipment_properties', 'maintenance_ids', 'owner_user_id',
)


@tagged('post_install', '-at_install', 'webvue')
class TestHrAssets(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.manager = new_test_user(
            cls.env, login='hr_assets_mgr', password='hr_assets_mgr_pass_123',
            name='Assets Manager', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': company.id,
        }])
        cls.manager_employee = cls.env['hr.employee'].create({
            'name': 'Assets Manager', 'user_id': cls.manager.id, 'company_id': company.id,
        })
        # The employee-role user of WebVueApiCase and the colleague custody is assigned to.
        cls.staff = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1) or \
            cls.env['hr.employee'].create({
                'name': cls.employee.name, 'user_id': cls.employee.id, 'company_id': company.id,
            })
        cls.colleague = cls.env['hr.employee'].create({'name': 'Noura', 'company_id': company.id})
        cls.category = cls.env['maintenance.equipment.category'].create({
            'name': 'Laptops', 'company_id': company.id,
        })
        cls.equipment = cls.env['maintenance.equipment'].create({
            'name': 'MacBook Pro', 'category_id': cls.category.id, 'serial_no': 'SN-001', 'model': 'M4',
        })

    def _user_with_capabilities(self, login, name, capabilities):
        """A user whose only HR access is the given assets capabilities."""
        user = new_test_user(
            self.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        role = self.env['webvue.access.role'].create({
            'key': f'assets_{login}', 'name_ar': name, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', capabilities),
            ]).ids)],
        })
        self.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.env.company.id,
        }])
        return user

    def _equipment(self, name='Monitor', **overrides):
        vals = {'name': name, 'company_id': self.env.company.id}
        vals.update(overrides)
        return self.env['maintenance.equipment'].create(vals)

    def _as_manager(self):
        self.authenticate('hr_assets_mgr', 'hr_assets_mgr_pass_123')

    def _assign(self, equipment, employee, **extra):
        payload = {'employee_id': employee.id, **extra}
        return self.api('POST', f'/api/v1/hr/assets/equipment/{equipment.id}/assign', json=payload)

    # --- reading ---------------------------------------------------------------------------------

    def test_manager_lists_and_reads_equipment(self):
        self._as_manager()
        res = self.api('GET', '/api/v1/hr/assets/equipment')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertGreaterEqual(body['total'], 1)
        item = next(entry for entry in body['items'] if entry['id'] == self.equipment.id)
        self.assertEqual(set(item), EQUIPMENT_KEYS)
        self.assertEqual(item['name'], 'MacBook Pro')
        self.assertEqual(item['category'], {'id': self.category.id, 'name': 'Laptops'})
        self.assertEqual(item['serial_no'], 'SN-001')
        self.assertEqual(item['model'], 'M4')
        self.assertIsNone(item['employee'])
        self.assertIsNone(item['warranty_date'])
        self.assertIsNone(item['scrap_date'])
        self.assertTrue(item['active'])
        # The stock assignment compute stamps the custody date when equipment is created.
        self.assertEqual(item['assign_date'], self.equipment.assign_date.isoformat())
        detail = self.api('GET', f'/api/v1/hr/assets/equipment/{self.equipment.id}')
        self.assertEqual((detail.status_code, set(detail.json())), (200, EQUIPMENT_KEYS))

    def test_category_catalog_envelope(self):
        shared = self.env['maintenance.equipment.category'].create({'name': 'Shared Tools', 'company_id': False})
        self._as_manager()
        body = self.api('GET', '/api/v1/hr/assets/categories').json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(body['total'], len(body['items']))
        for item in body['items']:
            self.assertEqual(set(item), REF_KEYS)
        ids = {item['id'] for item in body['items']}
        self.assertIn(self.category.id, ids)
        self.assertIn(shared.id, ids)

    def test_equipment_filters_and_pagination(self):
        self._equipment('Laptop Air', category_id=self.category.id)
        assigned = self._equipment('Phone')
        self.env['maintenance.equipment'].create({
            'name': 'Retired Router', 'company_id': self.env.company.id, 'active': False,
        })
        self.equipment.employee_id = self.colleague.id
        self._as_manager()
        by_name = self.api('GET', '/api/v1/hr/assets/equipment?q=Laptop').json()
        self.assertEqual([item['name'] for item in by_name['items']], ['Laptop Air'])
        by_serial = self.api('GET', '/api/v1/hr/assets/equipment?q=SN-001').json()
        self.assertIn(self.equipment.id, {item['id'] for item in by_serial['items']})
        by_category = self.api('GET', f'/api/v1/hr/assets/equipment?category_id={self.category.id}').json()
        self.assertEqual(
            {item['id'] for item in by_category['items']},
            {self.equipment.id, self.env['maintenance.equipment'].search([('name', '=', 'Laptop Air')]).id},
        )
        unassigned = self.api('GET', '/api/v1/hr/assets/equipment?assigned=false').json()
        self.assertNotIn(self.equipment.id, {item['id'] for item in unassigned['items']})
        self.assertIn(assigned.id, {item['id'] for item in unassigned['items']})
        by_employee = self.api('GET', f'/api/v1/hr/assets/equipment?employee_id={self.colleague.id}').json()
        self.assertEqual([item['id'] for item in by_employee['items']], [self.equipment.id])
        active = self.api('GET', '/api/v1/hr/assets/equipment').json()
        self.assertNotIn('Retired Router', {item['name'] for item in active['items']})
        every = self.api('GET', '/api/v1/hr/assets/equipment?active=all').json()
        self.assertIn('Retired Router', {item['name'] for item in every['items']})
        archived = self.api('GET', '/api/v1/hr/assets/equipment?active=false').json()
        self.assertEqual([item['name'] for item in archived['items']], ['Retired Router'])
        page = self.api('GET', '/api/v1/hr/assets/equipment?active=all&limit=1').json()
        self.assertEqual((len(page['items']), page['total']), (1, every['total']))
        for query, field in (
            ('assigned=maybe', 'assigned'),
            ('active=maybe', 'active'),
            ('category_id=abc', 'category_id'),
            ('employee_id=999999', 'employee_id'),
        ):
            response = self.api('GET', f'/api/v1/hr/assets/equipment?{query}')
            self.assertEqual((response.status_code, response.json()['field']), (422, field), query)

    def test_cost_and_private_fields_are_never_serialized(self):
        equipment = self._equipment('Vendor Laptop', cost=12000.0, note='<p>x</p>')
        self._as_manager()
        item = next(
            entry for entry in self.api('GET', '/api/v1/hr/assets/equipment?q=Vendor').json()['items']
            if entry['id'] == equipment.id
        )
        self.assertEqual(set(item), EQUIPMENT_KEYS)
        for key in EQUIPMENT_EXCLUDED_KEYS:
            self.assertNotIn(key, item)

    # --- writing ---------------------------------------------------------------------------------

    def test_manager_creates_category_and_equipment(self):
        self._as_manager()
        created_category = self.api('POST', '/api/v1/hr/assets/categories', json={'name': 'Phones'})
        self.assertEqual(created_category.status_code, 201, created_category.text)
        self.assertEqual(set(created_category.json()), REF_KEYS)
        category = self.env['maintenance.equipment.category'].browse(created_category.json()['id'])
        self.assertEqual(category.company_id, self.env.company)
        created = self.api('POST', '/api/v1/hr/assets/equipment', json={
            'name': 'iPhone 17', 'category_id': category.id, 'serial_no': 'SN-777',
            'model': 'Pro', 'warranty_date': '2027-01-01',
        })
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertEqual(set(body), EQUIPMENT_KEYS)
        self.assertEqual(body['warranty_date'], '2027-01-01')
        self.assertEqual(body['category'], {'id': category.id, 'name': 'Phones'})
        equipment = self.env['maintenance.equipment'].browse(body['id'])
        self.assertEqual((equipment.name, equipment.serial_no, equipment.model), ('iPhone 17', 'SN-777', 'Pro'))
        self.assertEqual(equipment.company_id, self.env.company)

    def test_patch_equipment_and_payload_errors(self):
        self._as_manager()
        res = self.api('PATCH', f'/api/v1/hr/assets/equipment/{self.equipment.id}', json={
            'name': 'MacBook Pro 16', 'model': 'M4 Max', 'warranty_date': '2028-02-02',
        })
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['name'], 'MacBook Pro 16')
        self.assertEqual(body['warranty_date'], '2028-02-02')
        self.equipment.invalidate_recordset(['name', 'model', 'warranty_date'])
        self.assertEqual((self.equipment.name, self.equipment.model), ('MacBook Pro 16', 'M4 Max'))
        cleared = self.api('PATCH', f'/api/v1/hr/assets/equipment/{self.equipment.id}', json={'warranty_date': None})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()['warranty_date'])
        cases = (
            ('POST', '/api/v1/hr/assets/equipment', {}, 'name'),
            ('POST', '/api/v1/hr/assets/equipment', {'name': '   '}, 'name'),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'X', 'cost': 5}, 'cost'),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'X', 'category_id': 999999}, 'category_id'),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'X', 'category_id': 'abc'}, 'category_id'),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'X', 'warranty_date': 'nope'}, 'warranty_date'),
            ('POST', '/api/v1/hr/assets/categories', {}, 'name'),
            ('POST', '/api/v1/hr/assets/categories', {'name': 'X', 'company_id': 1}, 'company_id'),
            ('PATCH', f'/api/v1/hr/assets/equipment/{self.equipment.id}', {}, None),
            ('PATCH', f'/api/v1/hr/assets/equipment/{self.equipment.id}', {'serial_no': 5}, 'serial_no'),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/return', {'x': 1}, 'x'),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/archive', {'x': 1}, 'x'),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/assign', {}, 'employee_id'),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/assign', {'employee_id': 999999}, 'employee_id'),
        )
        for method, path, payload, field in cases:
            response = self.api(method, path, json=payload)
            self.assertEqual(response.status_code, 422, (path, payload, response.text))
            self.assertEqual(response.json()['code'], 'invalid')
            if field is None:
                self.assertNotIn('field', response.json())
            else:
                self.assertEqual(response.json()['field'], field)

    def test_assign_and_return_use_the_stock_assignment(self):
        self._as_manager()
        res = self._assign(self.equipment, self.colleague, assign_date='2026-05-01')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), EQUIPMENT_KEYS)
        self.assertEqual(body['employee'], {'id': self.colleague.id, 'name': 'Noura'})
        self.assertEqual(body['assign_date'], '2026-05-01')
        self.equipment.invalidate_recordset(['employee_id', 'equipment_assign_to', 'department_id', 'assign_date'])
        self.assertEqual(self.equipment.employee_id, self.colleague)
        self.assertEqual(self.equipment.equipment_assign_to, 'employee')
        self.assertFalse(self.equipment.department_id)
        self.assertEqual(self.equipment.assign_date.isoformat(), '2026-05-01')
        # An already assigned asset is refused until it is returned.
        again = self._assign(self.equipment, self.staff)
        self.assertEqual((again.status_code, again.json()['field']), (422, 'employee_id'))
        returned = self.api('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/return', json={})
        self.assertEqual(returned.status_code, 200, returned.text)
        self.assertIsNone(returned.json()['employee'])
        # The stock engine keeps the last custody date after the return.
        self.assertEqual(returned.json()['assign_date'], '2026-05-01')
        self.equipment.invalidate_recordset(['employee_id', 'assign_date'])
        self.assertFalse(self.equipment.employee_id)

    def test_assign_requires_an_active_company_employee(self):
        archived = self.env['hr.employee'].create({
            'name': 'Gone', 'company_id': self.env.company.id, 'active': False,
        })
        other_company = self.env['res.company'].create({'name': 'Other Assets Co'})
        outsider = self.env['hr.employee'].with_company(other_company).create({
            'name': 'Outsider', 'company_id': other_company.id,
        })
        self._as_manager()
        for employee in (archived, outsider):
            res = self._assign(self.equipment, employee)
            self.assertEqual((res.status_code, res.json()['field']), (422, 'employee_id'), employee.name)
        self.assertFalse(self.equipment.employee_id)

    def test_archive_sets_the_scrap_date_and_hides_the_asset(self):
        self._as_manager()
        res = self.api('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/archive', json={
            'scrap_date': '2026-09-30',
        })
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertFalse(body['active'])
        self.assertEqual(body['scrap_date'], '2026-09-30')
        self.equipment.invalidate_recordset(['active', 'scrap_date'])
        self.assertFalse(self.equipment.active)
        self.assertEqual(self.api('GET', f'/api/v1/hr/assets/equipment/{self.equipment.id}').status_code, 200)
        listed = self.api('GET', '/api/v1/hr/assets/equipment').json()
        self.assertNotIn(self.equipment.id, {item['id'] for item in listed['items']})

    # --- self service and gates ------------------------------------------------------------------

    def test_employee_reads_only_their_own_custody(self):
        mine = self.env['maintenance.equipment'].create({
            'name': 'My Laptop', 'company_id': self.env.company.id, 'employee_id': self.staff.id,
        })
        theirs = self.env['maintenance.equipment'].create({
            'name': 'Their Laptop', 'company_id': self.env.company.id, 'employee_id': self.colleague.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/assets/me')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        ids = {item['id'] for item in body['items']}
        self.assertEqual(ids, {mine.id})
        self.assertNotIn(theirs.id, ids)
        self.assertEqual(body['total'], len(body['items']))
        for item in body['items']:
            self.assertEqual(set(item), EQUIPMENT_KEYS)
        # The employee holds no assets capability, so the company-wide list stays forbidden.
        for path in ('/api/v1/hr/assets/equipment', '/api/v1/hr/assets/categories'):
            self.assertEqual(self.api('GET', path).status_code, 403, path)

    def test_self_decision_is_forbidden(self):
        assigned = self.env['maintenance.equipment'].create({
            'name': 'Manager Laptop', 'company_id': self.env.company.id,
            'employee_id': self.manager_employee.id,
        })
        self._as_manager()
        self.assertEqual(self._assign(self.equipment, self.manager_employee).status_code, 403)
        returned = self.api('POST', f'/api/v1/hr/assets/equipment/{assigned.id}/return', json={})
        self.assertEqual(returned.status_code, 403, returned.text)
        self.assertEqual(returned.json()['code'], 'forbidden')
        assigned.invalidate_recordset(['employee_id'])
        self.assertEqual(assigned.employee_id, self.manager_employee)

    def test_employee_without_assets_capability_is_forbidden(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for path in (
            '/api/v1/hr/assets/equipment',
            f'/api/v1/hr/assets/equipment/{self.equipment.id}',
            '/api/v1/hr/assets/categories',
        ):
            res = self.api('GET', path)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')
        for method, path, payload in (
            ('POST', '/api/v1/hr/assets/categories', {'name': 'Blocked'}),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'Blocked'}),
            ('PATCH', f'/api/v1/hr/assets/equipment/{self.equipment.id}', {'name': 'Blocked'}),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/assign', {'employee_id': self.colleague.id}),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/return', {}),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/archive', {}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')

    def test_read_only_assets_capability_cannot_write(self):
        # A custom role must carry the catalog dependency, so an assets reader always holds
        # hr.employees.read too: that is what /me is gated by.
        self._user_with_capabilities(
            'hr_assets_reader', 'Assets reader', ['hr.assets.read', 'hr.employees.read'],
        )
        self.authenticate('hr_assets_reader', 'hr_assets_reader_pass_123')
        for path in (
            '/api/v1/hr/assets/equipment',
            f'/api/v1/hr/assets/equipment/{self.equipment.id}',
            '/api/v1/hr/assets/categories',
        ):
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        # The reader has no employee record in this company, so their own custody is empty.
        mine = self.api('GET', '/api/v1/hr/assets/me')
        self.assertEqual(mine.status_code, 200, mine.text)
        self.assertEqual(mine.json(), {'items': [], 'total': 0})
        for method, path, payload in (
            ('POST', '/api/v1/hr/assets/categories', {'name': 'Blocked'}),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'Blocked'}),
            ('PATCH', f'/api/v1/hr/assets/equipment/{self.equipment.id}', {'name': 'Blocked'}),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/assign', {'employee_id': self.colleague.id}),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/return', {}),
            ('POST', f'/api/v1/hr/assets/equipment/{self.equipment.id}/archive', {}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')

    def test_feature_off_answers_feature_not_included(self):
        set_hr_feature(self, 'hr.assets', False)
        self._as_manager()
        for method, path, payload in (
            ('GET', '/api/v1/hr/assets/equipment', None),
            ('GET', '/api/v1/hr/assets/categories', None),
            ('POST', '/api/v1/hr/assets/equipment', {'name': 'Blocked'}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'feature_not_included')

    def test_another_company_records_are_not_found(self):
        other_company = self.env['res.company'].create({'name': 'Other Assets Co'})
        foreign = self.env['maintenance.equipment'].with_company(other_company).create({
            'name': 'Foreign Laptop', 'company_id': other_company.id,
        })
        self._as_manager()
        for method, path, payload in (
            ('GET', f'/api/v1/hr/assets/equipment/{foreign.id}', None),
            ('PATCH', f'/api/v1/hr/assets/equipment/{foreign.id}', {'name': 'X'}),
            ('POST', f'/api/v1/hr/assets/equipment/{foreign.id}/assign', {'employee_id': self.colleague.id}),
            ('POST', f'/api/v1/hr/assets/equipment/{foreign.id}/return', {}),
            ('POST', f'/api/v1/hr/assets/equipment/{foreign.id}/archive', {}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 404, (path, res.text))
            self.assertEqual(res.json()['code'], 'not_found')
        listed = self.api('GET', '/api/v1/hr/assets/equipment?active=all').json()
        self.assertNotIn(foreign.id, {item['id'] for item in listed['items']})
