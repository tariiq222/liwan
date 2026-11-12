# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bell rows of a company membership: one for the person, one for each reader of their home company."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import MEMBERSHIPS, MembershipCase

ACCESS_CHANGED = 'access_changed'
ACCESS_MEMBERSHIP = 'access_membership'


@tagged('post_install', '-at_install', 'liwan')
class TestMembershipNotification(MembershipCase):

    def rows(self, user, kind):
        return self.env['mail.notification'].search([
            ('res_partner_id', '=', user.partner_id.id), ('mail_message_id.liwan_notification', '=', True),
            ('mail_message_id.liwan_notification_kind', '=', kind),
        ], order='id')

    def counts(self, kind):
        return {
            user.login: len(self.rows(user, kind)) for user in (
                self.member, self.b_admin, self.a_admin, self.roamer, self.archived_member, self.plain, self.b_user,
            )
        }

    def test_adding_tells_the_person_and_each_reader_of_the_home_company_once(self):
        self.sign_in('mb_b_admin')
        self.assertEqual(self.add('mb_member', self.branch_b, self.employee_role).status_code, 201)
        self.assertEqual(self.counts(ACCESS_CHANGED)[self.member.login], 1)
        person = self.rows(self.member, ACCESS_CHANGED).mail_message_id
        self.assertIn(self.branch_b.name, person.body)
        readers = {user.login for user in (self.a_admin, self.roamer, self.archived_member)}
        self.assertEqual(
            {login: count for login, count in self.counts(ACCESS_MEMBERSHIP).items() if count},
            dict.fromkeys(readers, 1),
        )
        body = self.rows(self.a_admin, ACCESS_MEMBERSHIP).mail_message_id.body
        for name in (self.member.name, self.branch_b.name, self.b_admin.name, self.branch_a.name):
            self.assertIn(name, body)

    def test_removing_tells_them_again_once_each(self):
        self.sign_in('mb_b_admin')
        self.add('mb_member', self.branch_b, self.employee_role)
        self.assertEqual(self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}').status_code, 204)
        self.assertEqual(self.counts(ACCESS_CHANGED)[self.member.login], 2)
        self.assertEqual(
            {login: count for login, count in self.counts(ACCESS_MEMBERSHIP).items() if count},
            dict.fromkeys((user.login for user in (self.a_admin, self.roamer, self.archived_member)), 2),
        )
        self.assertIn(self.branch_b.name, self.rows(self.member, ACCESS_CHANGED)[-1].mail_message_id.body)

    def test_a_refused_add_tells_nobody(self):
        self.sign_in('mb_b_admin')
        self.add('wc_plain', self.branch_b)
        self.assertFalse(any(self.counts(ACCESS_CHANGED).values()))
        self.assertFalse(any(self.counts(ACCESS_MEMBERSHIP).values()))

    def test_adding_your_own_account_tells_nobody_about_your_own_act(self):
        self.sign_in('wc_root_admin')
        self.assertEqual(
            self.add('wc_root_admin', self.fresh_branch, self.admin_role, company_id=self.fresh_branch).status_code, 201,
        )
        self.assertFalse(self.rows(self.root_admin, ACCESS_CHANGED))
        self.assertFalse(self.rows(self.root_admin, ACCESS_MEMBERSHIP))

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('mb_b_admin')
                self.assertEqual(self.add('mb_member', self.branch_b).status_code, 201)
                self.assertEqual(self.counts(ACCESS_CHANGED)[self.member.login], 1)
                self.assertEqual(self.counts(ACCESS_MEMBERSHIP)[self.a_admin.login], 1)

    def test_a_root_administrator_adding_their_own_account_to_a_branch_in_isolated_mode_is_audited_and_told(self):
        self.root_company.write({'liwan_branch_access_mode': 'isolated'})
        self.sign_in('wc_root_admin')
        first = self.add('mb_a_admin', self.fresh_branch, self.admin_role, company_id=self.fresh_branch)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertFalse(self.rows(self.a_admin, ACCESS_MEMBERSHIP))
        own = self.add('wc_root_admin', self.fresh_branch, self.admin_role, company_id=self.fresh_branch)
        self.assertEqual(own.status_code, 201, own.text)
        audit = self.env['liwan.access.audit'].search([
            ('action', '=', 'user.membership_added'), ('target_id', '=', self.root_admin.id),
        ])
        self.assertEqual(sorted(audit.company_id.ids), sorted([self.root_company.id, self.fresh_branch.id]))
        rows = self.rows(self.a_admin, ACCESS_MEMBERSHIP)
        self.assertEqual(len(rows), 1)
        for name in (self.root_admin.name, self.fresh_branch.name):
            self.assertIn(name, rows.mail_message_id.body)
        self.assertFalse(self.rows(self.root_admin, ACCESS_MEMBERSHIP))

    def test_the_readers_of_the_receiving_branch_are_told_only_on_the_root_path(self):
        self.sign_in('mb_b_admin')
        self.add('mb_member', self.branch_b)
        self.assertEqual(len(self.rows(self.roamer, ACCESS_MEMBERSHIP)), 1)  # a reader of the home company A, not of B
        self.assertEqual(len(self.rows(self.b_admin, ACCESS_MEMBERSHIP)), 0)

    def test_the_home_readers_are_those_of_the_home_company_whatever_company_the_caller_works_in(self):
        # The root's administrators inherit their roles in A; they are readers of A only through that inheritance.
        self.root_company.write({'liwan_branch_access_mode': 'inherited'})
        self.root_admin.company_ids = [(4, self.branch_a.id)]
        self.env['liwan.access.branch.rule'].create({
            'company_id': self.root_company.id, 'branch_id': self.branch_a.id, 'inherit': True,
            'role_ids': [(6, 0, self.admin_role.ids)],
        })
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        self.sign_in('mb_b_admin')
        self.assertEqual(self.add('mb_member', self.branch_b).status_code, 201)
        self.assertEqual(len(self.rows(self.root_admin, ACCESS_MEMBERSHIP)), 1)
        self.sign_in('wc_root_admin')
        self.assertEqual(self.add('mb_member', self.fresh_branch, company_id=self.fresh_branch).status_code, 201)
        self.assertEqual(len(self.rows(self.a_admin, ACCESS_MEMBERSHIP)), 2)
        self.assertEqual(len(self.rows(self.root_admin, ACCESS_MEMBERSHIP)), 1)  # the actor is never told about their own act
