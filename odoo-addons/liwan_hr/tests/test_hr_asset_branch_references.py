# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Equipment categories belong to the equipment's company or are shared."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import CompanyIsolationCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestHrAssetBranchReferences(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['liwan.access.assignment'].create([
            {'user_id': cls.iso_user.id, 'company_id': company.id,
             'role_id': cls.env.ref('liwan_hr.role_hr_manager').id}
            for company in (cls.company_p, cls.company_p1)
        ])
        cls.parent_category, cls.branch_category, cls.shared_category = cls.env[
            'maintenance.equipment.category'
        ].create([
            {'name': 'Reference parent category', 'company_id': cls.company_p.id},
            {'name': 'Reference branch category', 'company_id': cls.company_p1.id},
            {'name': 'Reference shared category', 'company_id': False},
        ])
        cls.branch_equipment = cls.env['maintenance.equipment'].create({
            'name': 'Reference branch equipment', 'company_id': cls.company_p1.id,
            'category_id': cls.branch_category.id,
        })

    def test_create_keeps_current_owner_with_own_or_shared_category(self):
        self.env_in(self.company_p)
        for category in (self.parent_category, self.shared_category):
            response = self.api('POST', '/api/v1/hr/assets/equipment', json={
                'name': f'Parent equipment {category.name}', 'category_id': category.id,
            })
            self.assertEqual(response.status_code, 201, response.text)
            equipment = self.env['maintenance.equipment'].browse(response.json()['id'])
            self.assertEqual(equipment.company_id, self.company_p)
            self.assertEqual(equipment.category_id, category)

    def test_create_rejects_branch_owned_category_for_current_parent_equipment(self):
        # A child-owned category is visible to this manager, but isn't a parent
        # company's own/shared category (HR assets API's documented contract).
        self.env_in(self.company_p)
        response = self.api('POST', '/api/v1/hr/assets/equipment', json={
            'name': 'Wrong owner equipment', 'category_id': self.branch_category.id,
        })
        self.assertEqual((response.status_code, response.json().get('field')), (422, 'category_id'), response.text)
        self.assertFalse(self.env['maintenance.equipment'].search([('name', '=', 'Wrong owner equipment')]))

    def test_patch_branch_equipment_accepts_own_or_shared_category(self):
        self.env_in(self.company_p)
        for category in (self.shared_category, self.branch_category):
            response = self.api('PATCH', f'/api/v1/hr/assets/equipment/{self.branch_equipment.id}', json={
                'category_id': category.id,
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.branch_equipment.company_id, self.company_p1)
            self.assertEqual(self.branch_equipment.category_id, category)

    def test_patch_parent_equipment_rejects_child_owned_category(self):
        equipment = self.env['maintenance.equipment'].create({
            'name': 'Parent patch equipment', 'company_id': self.company_p.id,
            'category_id': self.parent_category.id,
        })
        self.env_in(self.company_p)
        response = self.api('PATCH', f'/api/v1/hr/assets/equipment/{equipment.id}', json={
            'category_id': self.branch_category.id,
        })
        self.assertEqual((response.status_code, response.json().get('field')), (422, 'category_id'), response.text)
        self.assertEqual(equipment.category_id, self.parent_category)

    def test_mutation_respects_native_category_visibility(self):
        self.env['ir.rule'].create({
            'name': 'Hide reference branch equipment category',
            'model_id': self.env['ir.model']._get_id('maintenance.equipment.category'),
            'domain_force': repr([('id', '!=', self.branch_category.id)]),
        })
        self.env_in(self.company_p)
        response = self.api('PATCH', f'/api/v1/hr/assets/equipment/{self.branch_equipment.id}', json={
            'category_id': self.branch_category.id,
        })
        self.assertEqual((response.status_code, response.json()['field']), (422, 'category_id'))
