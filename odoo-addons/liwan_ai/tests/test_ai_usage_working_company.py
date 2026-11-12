# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A usage row reported with the user's session belongs to the company its run started in, whatever the session works in now."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import WorkingCompanyCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

USAGE = '/api/v1/ai/usage'
ITEM = {
    'conversation_id': 'r_switch_01', 'call_id': '0f1e2d3c4b5a6978', 'kind': 'plan', 'capability': 'standard',
    'billing': 'platform', 'provider': 'acme-ai', 'model': 'acme-large-1', 'outcome': 'ok', 'input_tokens': 120,
    'output_tokens': 45, 'cost': None, 'charge': None, 'called_at': '2026-10-27T09:30:00+03:00',
}


@tagged('post_install', '-at_install', 'liwan')
class TestSessionUsageNamesItsCompany(WorkingCompanyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**(profile.features or {}), 'ai.enabled': True}},
        )
        # The employee role carries ai.use: the worker holds it in both branches, ``plain`` only at home (branch A).
        cls.worker = cls._member(
            'wc_ai_worker', cls.branch_a, [cls.branch_a, cls.branch_b],
            {cls.branch_a: cls.employee_role, cls.branch_b: cls.employee_role},
        )
        cls.Usage = cls.env['liwan.ai.usage'].with_context(active_test=False)

    def report(self, company_id, *items):
        return self.api('POST', USAGE, {'user_company_id': company_id, 'items': list(items or (ITEM,))})

    def rows(self, user):
        return self.Usage.search([('user_id', '=', user.id)])

    def assert_refused(self, response, user, status=422):
        self.assertEqual(response.status_code, status, response.text)
        if status == 422:
            self.assertEqual(response.json()['field'], 'user_company_id')
        self.assertFalse(self.rows(user))

    def test_a_run_that_started_before_a_switch_is_recorded_in_its_own_company(self):
        self.sign_in('wc_ai_worker')
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        response = self.report(self.branch_a.id)
        self.assertEqual(response.status_code, 200, response.text)
        row = self.rows(self.worker)
        self.assertEqual(len(row), 1)
        self.assertEqual(row.company_id, self.branch_a)
        self.assertEqual(row.user_id, self.worker)

    def test_a_run_that_started_in_the_branch_is_recorded_there_after_returning_home(self):
        self.sign_in('wc_ai_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.assertEqual(self.switch(self.branch_a).status_code, 200)
        self.assertEqual(self.report(self.branch_b.id).status_code, 200)
        self.assertEqual(self.rows(self.worker).company_id, self.branch_b)

    def test_a_later_switch_never_refuses_the_report_of_a_finished_run(self):
        """``plain`` holds ai.use at home only: a run made there is still recorded after a switch to a branch without it."""
        self.sign_in('wc_plain')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        response = self.report(self.branch_a.id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.rows(self.plain).company_id, self.branch_a)

    def test_the_company_must_be_named(self):
        self.sign_in('wc_ai_worker')
        response = self.api('POST', USAGE, {'items': [ITEM]})
        self.assert_refused(response, self.worker)

    def test_only_a_company_the_caller_belongs_to_can_be_named(self):
        self.sign_in('wc_ai_worker')
        missing = self.env['res.company'].search([], order='id desc', limit=1).id + 1000
        for company_id in (self.branch_c.id, self.outside_branch.id, self.root_company.id, missing, 0, -1,
                           str(self.branch_a.id), True, None, [self.branch_a.id]):
            with self.subTest(company_id=company_id):
                self.assert_refused(self.report(company_id), self.worker)

    def test_an_archived_membership_cannot_be_named(self):
        self.sign_in('wc_archived_member')
        self.assert_refused(self.report(self.archived_branch.id), self.archived_member)

    def test_the_named_company_needs_the_capability_there(self):
        """Membership alone records nothing: ``plain`` belongs to branch B and holds no ai.use there."""
        self.sign_in('wc_plain')
        self.assert_refused(self.report(self.branch_b.id), self.plain, status=403)
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.assert_refused(self.report(self.branch_b.id), self.plain, status=403)
