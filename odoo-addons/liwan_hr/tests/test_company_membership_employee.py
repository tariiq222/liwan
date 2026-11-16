# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Adding a membership from an employee file links that employee to the existing account instead of making a second one."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import MEMBERSHIPS, MembershipCase

EMPLOYEE_ACCOUNTS = '/api/v1/admin/employee-accounts'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestMembershipEmployeeLink(MembershipCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Employee = cls.env['hr.employee']
        cls.home_employee = Employee.create({'name': 'Home file', 'company_id': cls.branch_a.id})
        cls.env['liwan.access.service']._liwan_link_employee(cls.home_employee.id, cls.member.id, cls.branch_a)
        cls.employee_b = Employee.create({'name': 'Branch file', 'company_id': cls.branch_b.id})
        cls.employee_fresh = Employee.create({'name': 'Fresh file', 'company_id': cls.fresh_branch.id})

    def linked(self, employee):
        employee.invalidate_recordset(['user_id'])
        return employee.user_id

    def test_adding_with_an_employee_links_it_and_keeps_the_home_file_and_the_single_account(self):
        accounts = self.env['res.users'].with_context(active_test=False).search_count([])
        self.sign_in('mb_b_admin')
        added = self.add('mb_member', self.branch_b, self.employee_role, employee_id=self.employee_b.id)
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(self.linked(self.employee_b), self.member)
        self.assertEqual(self.linked(self.home_employee), self.member)
        self.assertEqual(self.env['res.users'].with_context(active_test=False).search_count([]), accounts)
        self.assertEqual(self.member.company_id, self.branch_a)
        linked = self.env['liwan.access.audit'].search([
            ('action', '=', 'user.employee_linked'), ('target_id', '=', self.member.id),
        ])
        self.assertEqual(linked.company_id, self.branch_b)

    def test_removing_the_membership_unlinks_the_employee_of_that_company_only(self):
        self.sign_in('mb_b_admin')
        self.add('mb_member', self.branch_b, employee_id=self.employee_b.id)
        removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}')
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertFalse(self.linked(self.employee_b))
        self.assertEqual(self.linked(self.home_employee), self.member)
        self.assertEqual(self.employee_b.resource_id.user_id, self.env['res.users'])
        unlinked = self.env['liwan.access.audit'].search([
            ('action', '=', 'user.employee_unlinked'), ('target_id', '=', self.member.id),
        ])
        self.assertEqual(unlinked.company_id, self.branch_b)
        self.assertEqual(unlinked.before, {'employee_id': self.employee_b.id})

    def test_a_membership_without_an_employee_touches_no_employee(self):
        self.sign_in('mb_b_admin')
        self.assertEqual(self.add('mb_member', self.branch_b).status_code, 201)
        self.assertFalse(self.linked(self.employee_b))
        self.assertEqual(self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}').status_code, 204)
        self.assertEqual(self.linked(self.home_employee), self.member)

    def test_the_refusals_write_nothing(self):
        self.sign_in('mb_b_admin')
        taken = self.env['hr.employee'].create({'name': 'Has account', 'company_id': self.branch_b.id})
        self.env['liwan.access.service']._liwan_link_employee(taken.id, self.b_user.id, self.branch_b)
        archived = self.env['hr.employee'].create({'name': 'Gone', 'company_id': self.branch_b.id, 'active': False})
        cases = (
            (taken.id, 409, 'account_exists'),
            (archived.id, 422, 'employee_archived'),
            (self.home_employee.id, 404, 'not_found'),
            (999999999, 404, 'not_found'),
        )
        for employee_id, status, code in cases:
            with self.subTest(employee_id=employee_id):
                answer = self.add('mb_member', self.branch_b, employee_id=employee_id)
                self.assertEqual((answer.status_code, answer.json()['code']), (status, code), answer.text)
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_an_account_already_linked_to_another_employee_of_the_company_is_refused(self):
        self.sign_in('mb_b_admin')
        other = self.env['hr.employee'].create({'name': 'Second file', 'company_id': self.branch_b.id})
        self.assertEqual(self.add('mb_member', self.branch_b, employee_id=self.employee_b.id).status_code, 201)
        self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}')
        self.env['liwan.access.service']._liwan_link_employee(self.employee_b.id, self.member.id, self.branch_b)
        answer = self.add('mb_member', self.branch_b, employee_id=other.id)
        self.assertEqual((answer.status_code, answer.json()['code']), (409, 'employee_exists'), answer.text)

    def test_a_root_administrator_links_the_employee_of_a_branch(self):
        self.sign_in('wc_root_admin')
        added = self.add('mb_member', self.fresh_branch, company_id=self.fresh_branch, employee_id=self.employee_fresh.id)
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(self.linked(self.employee_fresh), self.member)
        removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}?company_id={self.fresh_branch.id}')
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertFalse(self.linked(self.employee_fresh))

    def test_the_employee_account_route_names_an_existing_account_homed_elsewhere(self):
        self.sign_in('mb_b_admin')
        answer = self.api('POST', EMPLOYEE_ACCOUNTS, {
            'employee_id': self.employee_b.id, 'login': self.member.login,
            'assignments': self.grants(self.branch_b, self.employee_role),
        })
        self.assertEqual((answer.status_code, answer.json()['code']), (409, 'account_exists'), answer.text)
        self.assertEqual(answer.json()['details'], {'existing_account': {
            'name': self.member.name, 'home_company': {'id': self.branch_a.id, 'name': self.branch_a.name},
        }})
        self.assertFalse(self.linked(self.employee_b))

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('mb_b_admin')
                self.assertEqual(self.add('mb_member', self.branch_b, employee_id=self.employee_b.id).status_code, 201)
                self.assertEqual(self.linked(self.employee_b), self.member)

    def test_a_holder_of_the_grant_alone_links_and_unlinks_without_any_other_capability(self):
        for keys in (None, ('access.users.grant',)):
            with self.subTest(keys=keys), self.undone():
                role = self.grant_only_role(*(keys or ()))
                self._member(self.mail('mb_granter'), self.branch_b, [self.branch_b], {self.branch_b: role})
                self.sign_in('mb_granter')
                added = self.add('mb_member', self.branch_b, employee_id=self.employee_b.id)
                self.assertEqual(added.status_code, 201, added.text)
                self.assertEqual(self.linked(self.employee_b), self.member)
                removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}')
                self.assertEqual(removed.status_code, 204, removed.text)
                self.assertFalse(self.linked(self.employee_b))

    def test_at_the_user_limit_the_route_names_the_existing_account_and_refuses_only_a_new_one(self):
        fresh_file = self.env['hr.employee'].create({
            'name': 'New person', 'company_id': self.branch_b.id, 'work_email': 'new.person@example.test',
        })
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.at_user_limit()
                self.sign_in('mb_b_admin')
                existing = self.api('POST', EMPLOYEE_ACCOUNTS, {
                    'employee_id': self.employee_b.id, 'login': self.member.login,
                    'assignments': self.grants(self.branch_b, self.employee_role),
                })
                self.assertEqual((existing.status_code, existing.json()['code']), (409, 'account_exists'), existing.text)
                self.assertIn('existing_account', existing.json()['details'])
                new = self.api('POST', EMPLOYEE_ACCOUNTS, {
                    'employee_id': fresh_file.id, 'login': 'new.person@example.test',
                    'assignments': self.grants(self.branch_b, self.employee_role),
                })
                self.assertEqual((new.status_code, new.json()['code']), (403, 'feature_not_included'), new.text)
                self.assertEqual(
                    {key: new.json()['details'].get(key) for key in ('reason', 'limit_key')},
                    {'reason': 'limit', 'limit_key': 'users.limit'},
                )
