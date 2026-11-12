# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The machine accounts of the AI addon stay out of the membership routes, as they stay out of every other administration."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import MEMBERSHIPS, NOT_FOUND_ID, MembershipCase


@tagged('post_install', '-at_install', 'liwan')
class TestTechnicalAccountsAreNoMembers(MembershipCase):

    def test_the_usage_recorder_is_not_listed_and_cannot_be_changed_or_removed(self):
        service = self.env['liwan.access.service']
        recorder = service._liwan_usage_recorder_id()
        self.assertTrue(recorder)
        user = self.env['res.users'].browse(recorder)
        self.assertTrue(user.active)
        self.assertIn(self.branch_b, user.company_ids)
        self.assertNotEqual(user.company_id, self.branch_b)
        self.sign_in('mb_b_admin')
        listed = self.memberships()
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertNotIn(recorder, {item['id'] for item in listed.json()['items']})
        missing = self.api('DELETE', f'{MEMBERSHIPS}/{NOT_FOUND_ID}')
        for method, body in (('PATCH', {'expected_version': 'x', 'assignments': []}), ('DELETE', None)):
            answer = self.api(method, f'{MEMBERSHIPS}/{recorder}', body)
            self.assertEqual((answer.status_code, answer.json()['code']), (404, 'not_found'), answer.text)
            self.assertEqual(answer.text, missing.text)
        self.assertIn(self.branch_b, user.company_ids)
