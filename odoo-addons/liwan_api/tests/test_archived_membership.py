# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A company that is archived is no membership, and it leaves the other memberships alone."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import SWITCH, WorkingCompanyCase


@tagged('post_install', '-at_install', 'liwan')
class TestArchivedMembership(WorkingCompanyCase):

    def test_a_member_of_an_archived_company_keeps_the_rights_of_the_others(self):
        self.sign_in('wc_archived_member')
        listed = self.api('GET', '/api/v1/admin/users')
        self.assertEqual(listed.status_code, 200, listed.text)
        me = self.me()
        self.assertEqual([company['id'] for company in me['companies']], [self.branch_a.id])

    def test_switching_to_an_archived_company_answers_not_found(self):
        self.sign_in('wc_archived_member')
        answer = self.api('POST', SWITCH, {'company_id': self.archived_branch.id})
        self.assertEqual((answer.status_code, answer.json()['code']), (404, 'not_found'), answer.text)
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)

    def test_a_session_working_in_a_company_that_gets_archived_returns_to_the_home_company(self):
        self.sign_in('wc_plain')
        self.assertEqual(self.switch(self.branch_c).status_code, 200)
        self.assertEqual(self.me()['company']['id'], self.branch_c.id)
        self.branch_c.active = False
        me = self.me()
        self.assertEqual(me['company']['id'], self.branch_a.id)
        self.assertEqual([company['id'] for company in me['companies']], [self.branch_a.id, self.branch_b.id])
