# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company membership: adding an account of the tenant to a second company, changing its roles there, removing it."""
from unittest import mock

from odoo.fields import Command
from odoo.http import root
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    MEMBERSHIPS,
    NOT_FOUND_ID,
    MembershipCase,
)

USERS = '/api/v1/admin/users'


def refusal(test, response, status, code):
    test.assertEqual((response.status_code, response.json().get('code')), (status, code), response.text)


@tagged('post_install', '-at_install', 'liwan')
class TestAddMembership(MembershipCase):

    def test_a_branch_administrator_adds_an_account_homed_elsewhere_and_it_works_there_with_the_given_role(self):
        self.sign_in('mb_b_admin')
        added = self.add('mb_member', self.branch_b, self.admin_role)
        self.assertEqual(added.status_code, 201, added.text)
        item = added.json()
        self.assertEqual(set(item), {'id', 'name', 'login', 'home_company', 'company', 'assignments', 'version'})
        self.assertEqual((item['id'], item['login']), (self.member.id, self.member.login))
        self.assertEqual(item['home_company'], {'id': self.branch_a.id, 'name': self.branch_a.name})
        self.assertEqual(item['company'], {'id': self.branch_b.id, 'name': self.branch_b.name})
        self.assertEqual([entry['role']['key'] for entry in item['assignments']], ['system_admin'])
        self.assertEqual(item['assignments'][0]['scope'], {'kind': 'company', 'id': self.branch_b.id, 'name': self.branch_b.name})
        self.assertEqual(self.assigned(self.member, self.branch_b), self.admin_role)
        self.assertEqual(self.member.company_ids, self.branch_a | self.branch_b)

        self.sign_in('mb_member')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        me = self.me()
        self.assertEqual((me['company']['id'], me['home_company_id']), (self.branch_b.id, self.branch_a.id))
        self.assertEqual([role['key'] for role in me['roles']], ['system_admin'])
        created = self.create_role('Made by a member from elsewhere')
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.role_company(created.json()['id']), self.branch_b)

    def test_adding_and_removing_leave_the_home_the_seat_and_the_home_roles_alone_but_move_the_versions(self):
        entitlement = self.env['liwan.entitlement.service']
        snapshot = lambda: (  # noqa: E731
            self.member.company_id, entitlement._liwan_count_held_seats(), entitlement._liwan_count_users(),
            self.assigned(self.member, self.branch_a),
        )
        versions = lambda: (self.member.liwan_access_version, self.branch_b.liwan_access_policy_version)  # noqa: E731
        before, moved = snapshot(), versions()
        self.sign_in('mb_b_admin')
        with mock.patch.object(type(entitlement), 'require_within_limit', side_effect=AssertionError('seat check')):
            self.assertEqual(self.add('mb_member', self.branch_b, self.admin_role).status_code, 201)
            self.env.invalidate_all()
            self.assertEqual(snapshot(), before)
            added = versions()
            self.assertGreater(added[0], moved[0])
            self.assertGreater(added[1], moved[1])
            removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}')
            self.assertEqual(removed.status_code, 204, removed.text)
        self.env.invalidate_all()
        self.assertEqual(snapshot(), before)
        self.assertGreater(versions()[0], added[0])
        self.assertGreater(versions()[1], added[1])
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_a_membership_with_no_roles_grants_what_a_member_without_assignment_gets(self):
        self.sign_in('mb_b_admin')
        added = self.add('mb_member', self.branch_b)
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(added.json()['assignments'], [])
        self.assertFalse(self.assigned(self.member, self.branch_b))
        self.sign_in('mb_member')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        me = self.me()
        self.assertEqual(me['roles'], [])
        held = self.env['liwan.access.service'].with_user(self.member)._liwan_capability_keys(self.member, company=self.branch_b)
        plain_held = self.env['liwan.access.service'].with_user(self.plain)._liwan_capability_keys(self.plain, company=self.branch_b)
        self.assertEqual(set(me['capabilities']), set(held))
        self.assertEqual(set(held), set(plain_held))
        self.assertEqual(self.create_role().status_code, 403)

    def test_every_account_that_cannot_be_added_answers_the_same_404(self):
        self.sign_in('mb_b_admin')
        before = self.member.company_ids | self.pending.company_ids | self.legacy.company_ids
        answers = {}
        for login in ('nobody.at.all@example.test', 'mb_gone', 'mb_support', 'mb_pending', 'mb_legacy', 'mb_portal'):
            with self.subTest(login=login):
                answer = self.add(login, self.branch_b, self.employee_role)
                refusal(self, answer, 404, 'not_found')
                answers[login] = answer.text
        self.assertEqual(len(set(answers.values())), 1)
        self.assertEqual(self.member.company_ids | self.pending.company_ids | self.legacy.company_ids, before)
        self.assertFalse(self.support.company_ids & self.branch_b)

    def test_the_codes_that_remain_are_the_ones_the_caller_could_already_know(self):
        self.sign_in('mb_b_admin')
        refusal(self, self.add('wc_plain', self.branch_b), 409, 'already_member')
        refusal(self, self.add('wc_b_user', self.branch_b), 409, 'already_member')

    def test_an_unmanaged_legacy_account_keeps_its_home_capabilities_because_it_cannot_be_added(self):
        service = self.env['liwan.access.service']
        managed, _home = service._liwan_identity_management_state(self.legacy)
        self.assertFalse(managed)
        home = service._liwan_capability_keys(self.legacy, company=self.branch_a)
        self.assertIn('access.users.grant', home)
        self.sign_in('mb_b_admin')
        refusal(self, self.add('mb_legacy', self.branch_b, self.employee_role), 404, 'not_found')
        self.env.invalidate_all()
        self.assertEqual(service._liwan_capability_keys(self.legacy, company=self.branch_a), home)

    def test_the_first_administrators_of_a_tenant_are_managed_accounts(self):
        service = self.env['liwan.access.service']
        for user in (self.root_admin, self.a_admin, self.b_admin, self.roamer):
            self.assertTrue(service._liwan_identity_management_state(user)[0], user.login)

    def test_bad_payloads_answer_422(self):
        self.sign_in('mb_b_admin')
        good = self.grants(self.branch_b, self.employee_role)
        payloads = (
            {'login': self.mail('mb_member')},
            {'assignments': good},
            {'login': 'not an email', 'assignments': good},
            {'login': self.mail('mb_member'), 'assignments': good, 'extra': 1},
            {'login': self.mail('mb_member'), 'assignments': 'x'},
            {'login': self.mail('mb_member'), 'assignments': good * 2},
            {'login': self.mail('mb_member'), 'assignments': self.grants(self.branch_a, self.employee_role)},
            {'login': self.mail('mb_member'), 'assignments': [{'role_id': NOT_FOUND_ID, 'scope': {'kind': 'company', 'id': self.branch_b.id}}]},
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                answer = self.api('POST', MEMBERSHIPS, payload)
                self.assertEqual(answer.status_code, 422, answer.text)
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_a_role_of_another_company_or_a_disabled_one_cannot_be_given(self):
        self.sign_in('mb_a_admin')
        custom = self.create_role('A only role')
        self.assertEqual(custom.status_code, 201, custom.text)
        role = self.env['liwan.access.role'].browse(custom.json()['id'])
        self.assertEqual(role.company_id, self.branch_a)
        self.sign_in('mb_b_admin')
        refusal(self, self.add('mb_member', self.branch_b, role), 422, 'invalid')
        disabled = self.env['liwan.access.role'].with_company(self.branch_b).create({
            'name_ar': 'Disabled in B', 'type': 'custom',
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ['access.users.read', 'access.roles.read']),
            ]).ids)],
            'active': False,
        })
        refusal(self, self.add('mb_member', self.branch_b, disabled), 422, 'role_disabled')
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_a_custom_role_of_the_receiving_company_can_be_given(self):
        self.sign_in('mb_b_admin')
        custom = self.create_role('B only role')
        self.assertEqual(custom.status_code, 201, custom.text)
        role = self.env['liwan.access.role'].browse(custom.json()['id'])
        added = self.add('mb_member', self.branch_b, role)
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(self.assigned(self.member, self.branch_b), role)

    def test_writing_roles_needs_the_role_assignment_capability_besides_the_grant(self):
        grant_only = self.grant_only_role()
        self._member(self.mail('mb_granter'), self.branch_b, [self.branch_b], {self.branch_b: grant_only})
        self.sign_in('mb_granter')
        refusal(self, self.add('mb_member', self.branch_b, self.employee_role), 403, 'forbidden')
        self.assertEqual(self.member.company_ids, self.branch_a)
        self.assertEqual(self.add('mb_member', self.branch_b).status_code, 201)
        version = self.memberships().json()['items'][-1]['version']
        refusal(self, self.api('PATCH', f'{MEMBERSHIPS}/{self.member.id}', {
            'expected_version': version, 'assignments': self.grants(self.branch_b, self.employee_role),
        }), 403, 'forbidden')

    def test_removing_a_member_with_roles_needs_the_role_assignment_capability_too(self):
        role = self.grant_only_role()
        self._member(self.mail('mb_granter'), self.branch_b, [self.branch_b], {self.branch_b: role})
        self.sign_in('mb_b_admin')
        self.add('mb_member', self.branch_b, self.employee_role)
        self.sign_in('mb_granter')
        refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}'), 403, 'forbidden')
        self.assertEqual(self.assigned(self.member, self.branch_b), self.employee_role)
        self.assertIn(self.branch_b, self.member.company_ids)
        # A member with no role there is removed with the grant alone.
        removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.plain.id}')
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertNotIn(self.branch_b, self.plain.company_ids)

    def test_the_caller_needs_the_grant_in_the_receiving_company(self):
        self.sign_in('wc_plain')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        refusal(self, self.add('mb_member', self.branch_b), 403, 'forbidden')
        self.sign_in('mb_a_admin')
        refusal(self, self.add('mb_member', self.branch_a), 409, 'already_member')
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_an_administrator_of_one_branch_cannot_add_anyone_to_another(self):
        self.sign_in('mb_a_admin')
        for target in (self.branch_b, self.root_company, self.fresh_branch):
            with self.subTest(target=target.name):
                refusal(self, self.add('mb_member', target, self.employee_role, company_id=target), 404, 'not_found')
        # An administrator of both works in one at a time: naming the other is the root path, which a branch has not.
        self.sign_in('wc_roamer')
        refusal(self, self.add('mb_member', self.branch_b, self.employee_role, company_id=self.branch_b), 404, 'not_found')
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_a_caller_cannot_name_a_company_outside_the_tenant_root_tree(self):
        self.sign_in('wc_root_admin')
        for target in (self.other_tree, self.archived_branch):
            with self.subTest(target=target.name):
                refusal(self, self.add('mb_member', target, company_id=target), 404, 'not_found')
        answers = {
            self.add('mb_member', self.branch_b, company_id=NOT_FOUND_ID).text,
            self.add('mb_member', self.branch_b, company_id=self.other_tree).text,
            self.add('mb_member', self.branch_b, company_id=self.archived_branch).text,
        }
        self.assertEqual(len(answers), 1)
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_a_root_administrator_adds_the_first_member_of_a_new_branch_in_every_branch_mode(self):
        for mode in ('isolated', 'delegated', 'inherited'):
            with self.subTest(mode=mode), self.undone():
                self.root_company.write({'liwan_branch_access_mode': mode})
                self.sign_in('wc_root_admin')
                own = self.add('wc_root_admin', self.fresh_branch, self.admin_role, company_id=self.fresh_branch)
                self.assertEqual(own.status_code, 201, own.text)
                self.assertEqual(own.json()['company']['id'], self.fresh_branch.id)
                other = self.add('mb_member', self.fresh_branch, self.employee_role, company_id=self.fresh_branch)
                self.assertEqual(other.status_code, 201, other.text)
                self.assertEqual(self.assigned(self.root_admin, self.fresh_branch), self.admin_role)
                self.assertEqual(self.assigned(self.member, self.fresh_branch), self.employee_role)
                self.assertEqual(self.root_admin.company_id, self.root_company)
                self.assertEqual(self.member.company_id, self.branch_a)
                listed = self.memberships(self.fresh_branch)
                self.assertEqual(listed.status_code, 200, listed.text)
                self.assertEqual({item['id'] for item in listed.json()['items']}, {self.root_admin.id, self.member.id})

    def test_a_root_account_without_the_grant_cannot_use_the_root_path_and_a_branch_administrator_neither(self):
        self.sign_in('mb_root_plain')
        refusal(self, self.add('mb_member', self.fresh_branch, company_id=self.fresh_branch), 403, 'forbidden')
        self.sign_in('mb_b_admin')
        refusal(self, self.add('mb_member', self.fresh_branch, company_id=self.fresh_branch), 404, 'not_found')
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_a_read_only_branch_refuses_a_new_member(self):
        branch = self.env['liwan.tenant.branch'].create({
            'branch_uid': 'membership-ro', 'company_id': self.fresh_branch.id, 'operation_id': 'op-membership-ro',
            'read_only': True,
        })
        self.sign_in('wc_root_admin')
        refusal(self, self.add('mb_member', self.fresh_branch, company_id=self.fresh_branch), 403, 'branch_read_only')
        self.assertEqual(self.member.company_ids, self.branch_a)
        branch.write({'read_only': False})
        self.assertEqual(self.add('mb_member', self.fresh_branch, company_id=self.fresh_branch).status_code, 201)

    def test_the_same_call_for_a_login_with_no_account_creates_an_ordinary_invitation(self):
        sent = []
        self.patch(
            type(self.env['liwan.account.mail']), '_liwan_send',
            lambda model, token, raw: sent.append((token.purpose, token.user_id.login)),
        )
        self.sign_in('mb_b_admin')
        created = self.api('POST', USERS, {
            'name': 'Brand New', 'login': 'brand.new@example.test', 'assignments': self.grants(self.branch_b, self.employee_role),
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(sent, [('invite', 'brand.new@example.test')])
        self.assertEqual(created.json()['login'], 'brand.new@example.test')

    def test_it_works_in_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('mb_b_admin')
                self.assertEqual(self.add('mb_member', self.branch_b, self.admin_role).status_code, 201)
                self.sign_in('mb_member')
                self.assertEqual(self.switch(self.branch_b).status_code, 200)
                self.assertEqual(self.create_role(f'Made in {mode}').status_code, 201)
                self.sign_in('mb_b_admin')
                self.assertEqual(self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}').status_code, 204)
                self.assertEqual(self.member.company_ids, self.branch_a)


@tagged('post_install', '-at_install', 'liwan')
class TestListChangeAndRemoveMemberships(MembershipCase):

    def test_the_list_holds_the_members_of_other_homes_with_their_roles_here(self):
        self.sign_in('mb_b_admin')
        listed = self.memberships()
        self.assertEqual(listed.status_code, 200, listed.text)
        body = listed.json()
        self.assertEqual(set(body), {'items', 'total'})
        by_id = {item['id']: item for item in body['items']}
        self.assertEqual(body['total'], len(body['items']))
        self.assertEqual(set(by_id), {self.roamer.id, self.plain.id})
        self.assertEqual(by_id[self.roamer.id]['home_company'], {'id': self.branch_a.id, 'name': self.branch_a.name})
        self.assertEqual([entry['role']['key'] for entry in by_id[self.roamer.id]['assignments']], ['system_admin'])
        self.assertEqual(by_id[self.plain.id]['assignments'], [])
        for item in body['items']:
            self.assertTrue(item['version'])

    def test_the_list_needs_the_grant_and_a_root_administrator_lists_a_branch(self):
        self.sign_in('wc_plain')
        self.switch(self.branch_b)
        refusal(self, self.memberships(), 403, 'forbidden')
        self.sign_in('wc_root_admin')
        listed = self.memberships(self.branch_b)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual({item['id'] for item in listed.json()['items']}, {self.roamer.id, self.plain.id})
        self.sign_in('mb_b_admin')
        refusal(self, self.memberships(self.branch_a), 404, 'not_found')

    def test_replacing_the_roles_checks_the_version_and_changes_only_this_company(self):
        self.sign_in('mb_b_admin')
        item = next(entry for entry in self.memberships().json()['items'] if entry['id'] == self.plain.id)
        home_before = self.assigned(self.plain, self.branch_a)
        stale = self.api('PATCH', f"{MEMBERSHIPS}/{self.plain.id}", {
            'expected_version': 'stale', 'assignments': self.grants(self.branch_b, self.employee_role),
        })
        refusal(self, stale, 409, 'conflict')
        self.assertEqual(stale.json()['details'], {'current_version': item['version']})
        changed = self.api('PATCH', f"{MEMBERSHIPS}/{self.plain.id}", {
            'expected_version': item['version'], 'assignments': self.grants(self.branch_b, self.employee_role),
        })
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual([entry['role']['key'] for entry in changed.json()['assignments']], ['employee'])
        self.assertNotEqual(changed.json()['version'], item['version'])
        self.assertEqual(self.assigned(self.plain, self.branch_b), self.employee_role)
        self.assertEqual(self.assigned(self.plain, self.branch_a), home_before)
        again = self.api('PATCH', f"{MEMBERSHIPS}/{self.plain.id}", {
            'expected_version': changed.json()['version'], 'assignments': [],
        })
        self.assertEqual(again.status_code, 200, again.text)
        self.assertFalse(self.assigned(self.plain, self.branch_b))

    def test_only_a_member_of_another_home_can_be_changed_or_removed_here(self):
        self.sign_in('mb_b_admin')
        body = {'expected_version': 'x', 'assignments': []}
        for user_id in (self.member.id, NOT_FOUND_ID):
            with self.subTest(user_id=user_id):
                refusal(self, self.api('PATCH', f'{MEMBERSHIPS}/{user_id}', body), 404, 'not_found')
                refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{user_id}'), 404, 'not_found')
        refusal(self, self.api('PATCH', f'{MEMBERSHIPS}/{self.b_user.id}', body), 409, 'home_company')
        refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{self.b_user.id}'), 409, 'home_company')

    def test_the_home_company_is_never_removed_and_nobody_removes_themselves(self):
        self.sign_in('mb_a_admin')
        refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}'), 409, 'home_company')
        self.assertEqual(self.member.company_ids, self.branch_a)
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{self.roamer.id}'), 422, 'self_access_change')
        self.assertEqual(self.roamer.company_ids, self.branch_a | self.branch_b)

    def test_the_last_holder_of_the_role_assignment_capability_stays(self):
        self.sign_in('wc_root_admin')
        added = self.add('mb_member', self.fresh_branch, self.admin_role, company_id=self.fresh_branch)
        self.assertEqual(added.status_code, 201, added.text)
        version = added.json()['version']
        refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}?company_id={self.fresh_branch.id}'), 409, 'last_access_admin')
        refusal(self, self.api('PATCH', f'{MEMBERSHIPS}/{self.member.id}', {
            'expected_version': version, 'assignments': self.grants(self.fresh_branch, self.employee_role),
            'company_id': self.fresh_branch.id,
        }), 409, 'last_access_admin')
        self.assertEqual(self.assigned(self.member, self.fresh_branch), self.admin_role)
        self.assertEqual(self.add('mb_a_admin', self.fresh_branch, self.admin_role, company_id=self.fresh_branch).status_code, 201)
        gone = self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}?company_id={self.fresh_branch.id}')
        self.assertEqual(gone.status_code, 204, gone.text)
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_removing_deletes_the_roles_there_and_sends_the_working_session_home(self):
        first = self.sign_in('wc_roamer')
        second = self.sign_in('mb_b_admin')
        root.session_store.save(first)
        self.use_session(first.sid)
        self.switch(self.branch_b)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)
        self.use_session(second.sid)
        removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.roamer.id}')
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertFalse(self.assigned(self.roamer, self.branch_b))
        self.assertEqual(self.assigned(self.roamer, self.branch_a), self.admin_role)
        self.assertEqual(self.roamer.company_ids, self.branch_a)
        self.use_session(first.sid)
        me = self.me()
        self.assertEqual(me['company']['id'], self.branch_a.id)
        self.assertEqual([company['id'] for company in me['companies']], [self.branch_a.id])

    def test_removing_needs_the_grant_and_a_root_administrator_removes_from_a_branch(self):
        self.sign_in('wc_plain')
        self.switch(self.branch_b)
        refusal(self, self.api('DELETE', f'{MEMBERSHIPS}/{self.roamer.id}'), 403, 'forbidden')
        self.sign_in('wc_root_admin')
        removed = self.api('DELETE', f'{MEMBERSHIPS}/{self.plain.id}?company_id={self.branch_b.id}')
        self.assertEqual(removed.status_code, 204, removed.text)
        self.assertEqual(self.plain.company_ids, self.branch_a | self.branch_c)


@tagged('post_install', '-at_install', 'liwan')
class TestAccountExistsDetails(MembershipCase):

    def invite(self, login, **extra):
        return self.api('POST', USERS, {
            'name': 'Someone', 'login': self.mail(login), 'assignments': self.grants(self.branch_b, self.employee_role), **extra,
        })

    def test_an_active_account_homed_elsewhere_is_named_with_its_home(self):
        self.sign_in('mb_b_admin')
        answer = self.invite('mb_member')
        refusal(self, answer, 409, 'account_exists')
        self.assertEqual(answer.json()['field'], 'login')
        self.assertEqual(answer.json()['details'], {
            'existing_account': {'name': self.member.name, 'home_company': {'id': self.branch_a.id, 'name': self.branch_a.name}},
        })
        self.assertEqual(self.member.company_ids, self.branch_a)

    def test_nothing_is_revealed_for_any_other_login(self):
        self.sign_in('mb_b_admin')
        for login in ('mb_gone', 'mb_support', 'mb_pending', 'mb_legacy', 'mb_portal', 'wc_b_user'):
            with self.subTest(login=login):
                answer = self.invite(login)
                refusal(self, answer, 409, 'account_exists')
                self.assertNotIn('details', answer.json())
        fresh = self.invite('first.time@example.test')
        self.assertEqual(fresh.status_code, 201, fresh.text)

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('mb_b_admin')
                answer = self.invite('mb_member')
                refusal(self, answer, 409, 'account_exists')
                self.assertIn('existing_account', answer.json()['details'])


@tagged('post_install', '-at_install', 'liwan')
class TestMembershipAudit(MembershipCase):

    def audit(self, action):
        return self.env['liwan.access.audit'].search([('action', '=', action), ('target_id', '=', self.member.id)])

    def test_adding_and_removing_each_log_one_entry_in_both_companies(self):
        self.sign_in('mb_b_admin')
        self.add('mb_member', self.branch_b, self.employee_role)
        added = self.audit('user.membership_added')
        self.assertEqual(sorted(added.mapped('company_id').ids), sorted([self.branch_a.id, self.branch_b.id]))
        self.assertEqual(added.mapped('actor_id'), self.b_admin)
        for entry in added:
            self.assertEqual(entry.target_type, 'user')
            self.assertEqual(entry.after['company'], {'id': self.branch_b.id, 'name': self.branch_b.name})
            self.assertEqual(entry.after['home_company'], {'id': self.branch_a.id, 'name': self.branch_a.name})
        self.api('DELETE', f'{MEMBERSHIPS}/{self.member.id}')
        removed = self.audit('user.membership_removed')
        self.assertEqual(sorted(removed.mapped('company_id').ids), sorted([self.branch_a.id, self.branch_b.id]))
        self.assertEqual(removed.mapped('actor_id'), self.b_admin)
        self.assertEqual(len(added), 2)
        self.assertEqual(len(removed), 2)

    def test_a_refused_call_logs_nothing(self):
        self.sign_in('mb_b_admin')
        self.add('mb_member', self.branch_b, self.employee_role)
        self.add('mb_member', self.branch_b, self.employee_role)
        self.assertEqual(len(self.audit('user.membership_added')), 2)

    def test_changing_the_roles_logs_one_entry_in_the_receiving_company(self):
        self.sign_in('mb_b_admin')
        version = self.add('mb_member', self.branch_b, self.employee_role).json()['version']
        self.api('PATCH', f'{MEMBERSHIPS}/{self.member.id}', {'expected_version': version, 'assignments': []})
        changed = self.audit('user.membership_roles_changed')
        self.assertEqual(changed.mapped('company_id'), self.branch_b)
        self.assertEqual(changed.mapped('actor_id'), self.b_admin)


@tagged('post_install', '-at_install', 'liwan')
class TestMembershipSelfGrant(MembershipCase):
    """A root administrator adding their own account to a branch meets the self-grant policy of the branch's root."""

    PROBE_KEY = 'probe_membership.salaries.manage'

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        group = cls.env['res.groups'].create({'name': 'Membership self-grant probe'})
        cls.env['ir.model.data'].create({
            'module': 'liwan_core', 'name': f'membership_probe_{group.id}', 'model': 'res.groups', 'res_id': group.id,
        })
        probe = cls.env['liwan.access.permission'].create({
            'key': cls.PROBE_KEY, 'name_ar': cls.PROBE_KEY, 'name_en': cls.PROBE_KEY, 'domain': 'probe_membership',
            'group_xmlid': f'liwan_core.membership_probe_{group.id}', 'custom_role_allowed': True,
            'resource': 'salaries', 'action': 'manage', 'description_ar': cls.PROBE_KEY,
        })
        cls.elevating = cls.env['liwan.access.role'].create({
            'key': 'test_membership_elevating', 'name_ar': 'Elevating', 'type': 'built_in',
            'permission_ids': [Command.set(probe.ids)],
        })

    def traces(self, user):
        """The audit and bell rows that name USER."""
        return (
            self.env['liwan.access.audit'].search_count([('target_id', '=', user.id), ('action', 'like', 'user.membership')]),
            self.env['mail.message'].search_count([('model', '=', 'res.users'), ('res_id', '=', user.id)]),
        )

    def test_a_root_administrator_adds_themselves_with_the_administrator_and_employee_roles(self):
        self.assertEqual(self.root_company.liwan_self_grant_policy, 'restricted')
        self.sign_in('wc_root_admin')
        own = self.add('wc_root_admin', self.fresh_branch, self.admin_role, self.employee_role, company_id=self.fresh_branch)
        self.assertEqual(own.status_code, 201, own.text)
        self.assertEqual(self.assigned(self.root_admin, self.fresh_branch), self.admin_role | self.employee_role)

    def test_a_root_administrator_cannot_add_themselves_with_a_role_beyond_them_under_restricted(self):
        self.sign_in('wc_root_admin')
        before = self.traces(self.root_admin)
        refused = self.add('wc_root_admin', self.fresh_branch, self.elevating, company_id=self.fresh_branch)
        refusal(self, refused, 403, 'self_grant_restricted')
        self.assertEqual(refused.json()['details'], {'roles': [self.elevating.key], 'permissions': [self.PROBE_KEY]})
        self.env.invalidate_all()
        self.assertNotIn(self.fresh_branch, self.root_admin.company_ids)
        self.assertFalse(self.assigned(self.root_admin, self.fresh_branch))
        self.assertEqual(self.traces(self.root_admin), before)

    def test_the_allowed_policy_lets_a_root_administrator_add_themselves_with_any_role(self):
        service = self.env['liwan.access.service'].with_user(self.root_admin).with_company(self.root_company)
        service._liwan_set_self_grant_policy(service._liwan_access_policy()['version'], 'allowed')
        self.sign_in('wc_root_admin')
        own = self.add('wc_root_admin', self.fresh_branch, self.admin_role, self.elevating, company_id=self.fresh_branch)
        self.assertEqual(own.status_code, 201, own.text)
        self.assertEqual(self.assigned(self.root_admin, self.fresh_branch), self.admin_role | self.elevating)

    def test_adding_another_account_with_the_same_role_is_not_a_self_grant(self):
        self.sign_in('wc_root_admin')
        other = self.add('mb_member', self.fresh_branch, self.elevating, company_id=self.fresh_branch)
        self.assertEqual(other.status_code, 201, other.text)
        self.assertEqual(self.assigned(self.member, self.fresh_branch), self.elevating)

    def test_a_member_cannot_change_their_own_roles_here(self):
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        version = next(item for item in self.memberships().json()['items'] if item['id'] == self.roamer.id)['version']
        changed = self.api('PATCH', f'{MEMBERSHIPS}/{self.roamer.id}', {
            'expected_version': version, 'assignments': self.grants(self.branch_b, self.admin_role, self.elevating),
        })
        refusal(self, changed, 422, 'self_access_change')
        self.assertEqual(self.assigned(self.roamer, self.branch_b), self.admin_role)
