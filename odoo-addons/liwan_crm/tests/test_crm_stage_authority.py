# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The pipeline stages are tenant-wide: only a settings manager of the root company changes them."""
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanCrmCase

BASE = '/api/v1/crm'
SETTINGS = f'{BASE}/settings'
MANAGER_ROLE = 'liwan_crm.role_crm_manager'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmStageAuthority(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({'name': 'CRM branch', 'parent_id': cls.company.id})
        cls.branch_manager = cls._branch_user('crm_branch_manager', [cls.branch])
        cls.both_manager = cls._branch_user('crm_both_manager', [cls.branch, cls.company])
        cls.stage = cls.env.ref('liwan_crm.stage_new')

    @classmethod
    def _branch_user(cls, login, companies):
        """A user homed in the first of ``companies`` who manages the CRM in each of them."""
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
            company_id=companies[0].id, company_ids=[Command.set([company.id for company in companies])],
        )
        for company in companies:
            cls.env['liwan.access.assignment'].create({
                'user_id': user.id, 'role_id': cls.env.ref(MANAGER_ROLE).id, 'company_id': company.id,
            })
        return user

    def refused(self, response):
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)

    def test_a_branch_manager_reads_the_stages_but_changes_none(self):
        self.as_user(self.branch_manager)
        self.assertEqual(self.api('GET', f'{BASE}/stages').status_code, 200)
        ids = self.env['crm.stage'].search([]).ids
        self.refused(self.api('POST', f'{BASE}/stages', {'name': 'Branch stage'}))
        self.refused(self.api('POST', f'{BASE}/stages/order', {'ids': ids[::-1]}))
        self.refused(self.api('PATCH', f'{BASE}/stages/{self.stage.id}', {'name': 'Renamed'}))
        self.refused(self.api('DELETE', f'{BASE}/stages/{self.stage.id}'))
        self.assertEqual(self.stage.name, 'New')
        self.assertTrue(self.stage.active)
        self.assertFalse(self.env['crm.stage'].search([('name', '=', 'Branch stage')]))

    def test_the_settings_say_whether_the_caller_may_manage_the_stages(self):
        self.assertFalse(self.as_user(self.branch_manager).api('GET', SETTINGS).json()['can_manage_stages'])
        self.assertTrue(self.as_manager().api('GET', SETTINGS).json()['can_manage_stages'])

    def test_a_manager_of_the_root_company_changes_the_stages(self):
        self.as_manager()
        created = self.api('POST', f'{BASE}/stages', {'name': 'Qualified'})
        self.assertEqual(created.status_code, 200, created.text)
        stage_id = created.json()['id']
        ids = self.env['crm.stage'].search([]).ids
        self.assertEqual(self.api('POST', f'{BASE}/stages/order', {'ids': ids}).status_code, 200)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{stage_id}', {'name': 'Qualified lead'}).status_code, 200)
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{stage_id}').status_code, 200)

    def test_the_capability_must_be_held_in_the_working_company_and_in_the_root(self):
        stages = self.env['crm.stage']
        # Working in a branch never reaches the root's assignments (the branch-access rule), so a branch session reads only.
        self.assertFalse(stages.with_user(self.branch_manager).with_company(self.branch)._liwan_can_manage())
        self.assertFalse(stages.with_user(self.both_manager).with_company(self.branch)._liwan_can_manage())
        self.assertTrue(stages.with_user(self.both_manager).with_company(self.company)._liwan_can_manage())
        self.assertTrue(stages.with_user(self.manager).with_company(self.company)._liwan_can_manage())
        self.assertFalse(stages.with_user(self.agent).with_company(self.company)._liwan_can_manage())
