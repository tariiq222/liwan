# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The stages, call outcomes, lost reasons and sources are tenant-wide: only a settings manager of the root company changes them."""
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanCrmCase

BASE = '/api/v1/crm'
SETTINGS = f'{BASE}/settings'
MANAGER_ROLE = 'liwan_crm.role_crm_manager'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmTenantListAuthority(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({'name': 'CRM branch', 'parent_id': cls.company.id})
        cls.branch_manager = cls._branch_user('crm_branch_manager', [cls.branch])
        cls.both_manager = cls._branch_user('crm_both_manager', [cls.branch, cls.company])
        cls.stage = cls.env.ref('liwan_crm.stage_new')
        cls.outcome = cls.env.ref('liwan_crm.outcome_no_answer')
        cls.reason = cls.env['crm.lost.reason'].create({'name': 'Too expensive'})
        cls.source = cls.env['utm.source'].create({'name': 'Expo'})

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

    def test_a_branch_manager_reads_the_other_lists_but_changes_none(self):
        self.as_user(self.branch_manager)
        for resource in ('outcomes', 'lost-reasons', 'sources'):
            self.assertEqual(self.api('GET', f'{BASE}/{resource}').status_code, 200, resource)
        self.refused(self.api('POST', f'{BASE}/outcomes', {'name': 'Branch outcome', 'effect': 'follow_up'}))
        self.refused(self.api('PATCH', f'{BASE}/outcomes/{self.outcome.id}', {'name': 'Renamed'}))
        self.refused(self.api('DELETE', f'{BASE}/outcomes/{self.outcome.id}'))
        self.refused(self.api('POST', f'{BASE}/lost-reasons', {'name': 'Branch reason'}))
        self.refused(self.api('PATCH', f'{BASE}/lost-reasons/{self.reason.id}', {'name': 'Renamed'}))
        self.refused(self.api('DELETE', f'{BASE}/lost-reasons/{self.reason.id}'))
        self.refused(self.api('POST', f'{BASE}/sources', {'name': 'Branch source'}))
        self.refused(self.api('PATCH', f'{BASE}/sources/{self.source.id}', {'name': 'Renamed'}))
        self.refused(self.api('DELETE', f'{BASE}/sources/{self.source.id}'))
        self.assertEqual(self.outcome.name, 'No answer')
        self.assertTrue(self.outcome.active)
        self.assertEqual((self.reason.name, self.reason.active), ('Too expensive', True))
        self.assertEqual((self.source.name, self.source.active), ('Expo', True))
        for model, name in (
            ('liwan.crm.call.outcome', 'Branch outcome'), ('crm.lost.reason', 'Branch reason'),
            ('utm.source', 'Branch source'),
        ):
            self.assertFalse(self.env[model].search([('name', '=', name)]), model)

    def test_a_branch_manager_still_manages_the_company_packages(self):
        self.as_user(self.branch_manager)
        self.assertEqual(self.api('GET', f'{BASE}/packages').status_code, 200)

    def test_the_settings_say_whether_the_caller_may_manage_the_tenant_lists(self):
        self.assertFalse(self.as_user(self.branch_manager).api('GET', SETTINGS).json()['can_manage_tenant_lists'])
        self.assertTrue(self.as_manager().api('GET', SETTINGS).json()['can_manage_tenant_lists'])

    def test_a_manager_of_the_root_company_changes_the_stages(self):
        self.as_manager()
        created = self.api('POST', f'{BASE}/stages', {'name': 'Qualified'})
        self.assertEqual(created.status_code, 200, created.text)
        stage_id = created.json()['id']
        ids = self.env['crm.stage'].search([]).ids
        self.assertEqual(self.api('POST', f'{BASE}/stages/order', {'ids': ids}).status_code, 200)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{stage_id}', {'name': 'Qualified lead'}).status_code, 200)
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{stage_id}').status_code, 200)

    def test_a_manager_of_the_root_company_changes_the_other_lists(self):
        self.as_manager()
        outcome = self.api('POST', f'{BASE}/outcomes', {'name': 'Busy', 'effect': 'follow_up'})
        reason = self.api('POST', f'{BASE}/lost-reasons', {'name': 'Late'})
        source = self.api('POST', f'{BASE}/sources', {'name': 'Fair'})
        for response in (outcome, reason, source):
            self.assertEqual(response.status_code, 200, response.text)
        for resource, created in (('outcomes', outcome), ('lost-reasons', reason), ('sources', source)):
            path = f'{BASE}/{resource}/{created.json()["id"]}'
            self.assertEqual(self.api('PATCH', path, {'name': 'Renamed'}).status_code, 200, resource)
            self.assertEqual(self.api('DELETE', path).status_code, 200, resource)

    def test_the_capability_must_be_held_in_the_working_company_and_in_the_root(self):
        access = self.env['liwan.access.service']
        # Working in a branch never reaches the root's assignments (the branch-access rule), so a branch session reads only.
        self.assertFalse(access.with_user(self.branch_manager).with_company(self.branch)._liwan_can_manage_tenant_lists())
        self.assertFalse(access.with_user(self.both_manager).with_company(self.branch)._liwan_can_manage_tenant_lists())
        self.assertTrue(access.with_user(self.both_manager).with_company(self.company)._liwan_can_manage_tenant_lists())
        self.assertTrue(access.with_user(self.manager).with_company(self.company)._liwan_can_manage_tenant_lists())
        self.assertFalse(access.with_user(self.agent).with_company(self.company)._liwan_can_manage_tenant_lists())
