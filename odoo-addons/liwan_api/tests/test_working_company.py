# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The working company switch: which company a session acts in, and what that leaves alone."""
from types import SimpleNamespace
from unittest import mock

from odoo.fields import Command
from odoo.http import root
from odoo.tests import get_db_name, tagged

from odoo.addons.liwan_api.controllers import common
from odoo.addons.liwan_api.controllers.common import (
    EXPECTED_COMPANY_HEADER,
    WORKING_COMPANY_KEY,
    working_company,
)
from odoo.addons.liwan_api.tests.common import (
    NOT_FOUND_ID,
    PASSWORD,
    SWITCH,
    WorkingCompanyCase,
)


@tagged('post_install', '-at_install', 'liwan')
class TestWorkingCompany(WorkingCompanyCase):

    def test_a_session_starts_in_the_home_company_and_lists_the_companies_it_may_switch_to(self):
        self.sign_in('wc_roamer')
        me = self.me()
        self.assertEqual(me['company'], {'id': self.branch_a.id, 'name': self.branch_a.name})
        self.assertEqual(me['home_company_id'], self.branch_a.id)
        self.assertEqual(me['companies'], [
            {'id': self.branch_a.id, 'name': self.branch_a.name},
            {'id': self.branch_b.id, 'name': self.branch_b.name},
        ])

    def test_a_user_with_one_company_lists_only_that_one(self):
        self.sign_in('wc_b_user')
        me = self.me()
        self.assertEqual(me['companies'], [{'id': self.branch_b.id, 'name': self.branch_b.name}])
        self.assertEqual(me['home_company_id'], self.branch_b.id)

    def test_switching_then_creating_a_record_makes_it_belong_to_the_working_company(self):
        self.sign_in('wc_roamer')
        self.assertEqual(self.role_company(self.create_role('Made at home').json()['id']), self.branch_a)
        switched = self.switch(self.branch_b)
        self.assertEqual(switched.status_code, 200, switched.text)
        self.assertEqual(switched.json()['company']['id'], self.branch_b.id)
        self.assertEqual(switched.json()['home_company_id'], self.branch_a.id)
        self.assertEqual([company['id'] for company in switched.json()['companies']],
                         [self.branch_a.id, self.branch_b.id])
        me = self.me()
        self.assertEqual((me['company']['id'], me['home_company_id']), (self.branch_b.id, self.branch_a.id))
        created = self.create_role('Made at branch')
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.role_company(created.json()['id']), self.branch_b)

    def test_a_member_without_a_role_in_the_branch_gets_what_a_member_without_assignment_gets(self):
        self.sign_in('wc_plain')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        me = self.me()
        self.assertEqual(me['company']['id'], self.branch_b.id)
        self.assertEqual(me['roles'], [])
        held = self.env['liwan.access.service'].with_user(self.plain)._liwan_capability_keys(
            self.plain, company=self.branch_b,
        )
        self.assertEqual(set(me['capabilities']), set(held))
        self.assertEqual(self.create_role().status_code, 403)

    def test_the_home_capabilities_stay_those_of_the_home_company_after_a_switch(self):
        # Homed in A with the employee and administrator roles, a member of B with no role there. The employee role
        # is empty in the foundation alone (applications add its keys, HR self-service among them), so the
        # administrator role is what makes the two companies differ in every install.
        user = self._member('wc_home_staff', self.branch_a, [self.branch_a, self.branch_b], {self.branch_a: self.admin_role})
        self.env['liwan.access.assignment'].create({'user_id': user.id, 'role_id': self.employee_role.id, 'company_id': self.branch_a.id})
        self.sign_in('wc_home_staff')
        at_home = self.me()
        self.assertEqual(at_home['home_capabilities'], at_home['capabilities'])
        employee_keys = set(self.employee_role.permission_ids.mapped('key'))
        admin_keys = set(self.admin_role.permission_ids.mapped('key'))
        self.assertLessEqual(employee_keys | admin_keys, set(at_home['home_capabilities']))
        switched = self.switch(self.branch_b)
        self.assertEqual(switched.status_code, 200, switched.text)
        self.assertEqual(switched.json()['home_capabilities'], at_home['capabilities'])
        me = self.me()
        held_in_b = self.env['liwan.access.service'].with_user(user).with_company(self.branch_b)._liwan_capability_keys(
            user, company=self.branch_b,
        )
        self.assertEqual(me['capabilities'], sorted(held_in_b))
        self.assertNotIn('access.users.assign_roles', me['capabilities'])
        self.assertIn('access.users.assign_roles', me['home_capabilities'])
        self.assertEqual(me['home_capabilities'], at_home['capabilities'])
        self.assertEqual(me['home_capabilities'], sorted(me['home_capabilities']))

    def test_an_administrator_switched_into_a_branch_keeps_the_home_capabilities_of_home(self):
        self.sign_in('wc_roamer')
        at_home = self.me()
        self.switch(self.branch_b)
        me = self.me()
        self.assertEqual(me['home_capabilities'], at_home['capabilities'])

    def test_a_company_the_caller_cannot_switch_to_answers_like_one_that_does_not_exist(self):
        self.sign_in('wc_roamer')
        answers = [
            self.api('POST', SWITCH, {'company_id': company_id}) for company_id in (self.outside_branch.id, NOT_FOUND_ID)
        ]
        self.sign_in('wc_archived_member')
        answers.append(self.api('POST', SWITCH, {'company_id': self.archived_branch.id}))
        for answer in answers:
            self.assertEqual((answer.status_code, answer.json()['code']), (404, 'not_found'), answer.text)
        self.assertEqual(len({answer.text for answer in answers}), 1)

    def test_a_malformed_body_answers_422(self):
        self.sign_in('wc_roamer')
        for body in ({}, {'company_id': None}, {'company_id': 'x'}, {'company_id': True}, {'company_id': 0},
                     {'company_id': self.branch_b.id, 'other': 1}):
            with self.subTest(body=body):
                answer = self.api('POST', SWITCH, body)
                self.assertEqual((answer.status_code, answer.json()['code']), (422, 'invalid'), answer.text)
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)

    def test_removing_the_membership_returns_the_next_request_to_the_home_company(self):
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)
        self.env['liwan.access.assignment'].search([
            ('user_id', '=', self.roamer.id), ('company_id', '=', self.branch_b.id),
        ]).unlink()
        self.roamer.company_ids = [Command.unlink(self.branch_b.id)]
        me = self.me()
        self.assertEqual(me['company']['id'], self.branch_a.id)
        self.assertEqual([company['id'] for company in me['companies']], [self.branch_a.id])

    def test_in_isolated_mode_a_root_administrator_without_membership_cannot_switch_into_a_branch(self):
        self.root_company.write({'liwan_branch_access_mode': 'isolated'})
        self.sign_in('wc_root_admin')
        answer = self.switch(self.branch_b)
        self.assertEqual((answer.status_code, answer.json()['code']), (404, 'not_found'), answer.text)
        self.assertEqual(self.me()['company']['id'], self.root_company.id)

    def test_two_sessions_of_one_user_work_in_two_companies_at_once(self):
        first = self.sign_in('wc_roamer')
        second = self.sign_in('wc_roamer')
        root.session_store.save(first)
        self.use_session(first.sid)
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.use_session(second.sid)
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)
        created = self.create_role('Made in the second session')
        self.assertEqual(self.role_company(created.json()['id']), self.branch_a)
        self.use_session(first.sid)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)
        created = self.create_role('Made in the first session')
        self.assertEqual(self.role_company(created.json()['id']), self.branch_b)

    def test_a_switch_moves_nothing_on_the_user(self):
        entitlement = self.env['liwan.entitlement.service']
        seats = entitlement._liwan_count_held_seats()
        before = (self.roamer.company_id, self.roamer.company_ids, self.roamer.liwan_access_version)
        self.sign_in('wc_roamer')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.env.invalidate_all()
        self.assertEqual((self.roamer.company_id, self.roamer.company_ids, self.roamer.liwan_access_version), before)
        self.assertEqual(entitlement._liwan_count_held_seats(), seats)

    def test_the_switch_works_in_both_commercial_modes(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        for mode, source in (('saas', 'control_plane'), ('non_saas', 'local_policy')):
            with self.subTest(mode=mode):
                # Fixture-only conversion; production ORM conversion is deliberately forbidden.
                self.env.cr.execute(
                    'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
                    [mode, source, profile.id],
                )
                profile.invalidate_recordset()
                self.sign_in('wc_roamer')
                switched = self.switch(self.branch_b)
                self.assertEqual(switched.status_code, 200, switched.text)
                self.assertEqual(self.me()['company']['id'], self.branch_b.id)
                self.assertEqual(self.me()['commercial']['mode'], mode)
                created = self.create_role(f'Made in {mode}')
                self.assertEqual(created.status_code, 201, created.text)
                self.assertEqual(self.role_company(created.json()['id']), self.branch_b)
                self.assertEqual(self.switch(self.branch_a).json()['company']['id'], self.branch_a.id)
                self.assertEqual(self.me()['company']['id'], self.branch_a.id)

    def test_a_switch_from_a_stale_page_is_refused_and_changes_nothing(self):
        self.sign_in('wc_roamer')
        stale = self.url_open(
            SWITCH, json={'company_id': self.branch_b.id},
            headers={'Content-Type': 'application/json', EXPECTED_COMPANY_HEADER: str(self.branch_b.id)}, method='POST',
        )
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'request_context_changed'), stale.text)
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.assertEqual(self.me()['company']['id'], self.branch_b.id)

    def test_a_read_only_account_may_switch_and_is_then_refused_an_ordinary_write(self):
        self.env['liwan.entitlement.service'].sudo()._liwan_apply_flags(self.roamer, {'liwan_read_only': True})
        self.sign_in('wc_roamer')
        switched = self.switch(self.branch_b)
        self.assertEqual(switched.status_code, 200, switched.text)
        self.assertEqual(switched.json()['company']['id'], self.branch_b.id)
        self.assertEqual(self.api('GET', '/api/v1/admin/users').status_code, 200)
        refused = self.create_role()
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'user_read_only'), refused.text)

    def test_a_new_sign_in_does_not_inherit_the_working_company_of_the_previous_session(self):
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        self.url_open('/web/session/destroy', json={'jsonrpc': '2.0', 'method': 'call', 'id': 0, 'params': {}},
                      headers={'Content-Type': 'application/json'})
        self.sign_in('wc_roamer')
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)

    def test_a_two_step_sign_in_over_a_working_session_starts_in_the_home_company(self):
        self.roamer.write({'liwan_mobile': '+966590000077', 'email': 'wc_roamer@example.test'})
        sent = []
        self.patch(
            type(self.env['liwan.sms.gateway']), '_liwan_send',
            lambda model, channel, destination, body: sent.append(body),
        )
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        self.url_open('/web/session/authenticate', json={
            'jsonrpc': '2.0', 'method': 'call', 'id': 0,
            'params': {'db': get_db_name(), 'login': 'wc_roamer', 'password': PASSWORD},
        }, headers={'Content-Type': 'application/json'})
        self.assertEqual(self.api('POST', '/api/v1/auth/code', {'channel': 'sms'}).status_code, 200)
        finished = self.api('POST', '/api/v1/auth/verify', {'code': sent[-1].split()[-1]})
        self.assertEqual(finished.status_code, 200, finished.text)
        self.assertEqual(finished.json()['company']['id'], self.branch_a.id)
        self.assertEqual(finished.json()['home_capabilities'], finished.json()['capabilities'])
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)


@tagged('post_install', '-at_install', 'liwan')
class TestWorkingCompanyResolution(WorkingCompanyCase):
    """The function a request pins from, without a web session."""

    def resolve(self, stored, user=None):
        user = user or self.roamer
        request = SimpleNamespace(env=self.env(user=user), session={WORKING_COMPANY_KEY: stored} if stored else {})
        with mock.patch.object(common, 'request', request):
            return working_company()

    def test_no_stored_value_is_the_home_company(self):
        self.assertEqual(self.resolve(None), self.branch_a)

    def test_a_stored_membership_is_the_working_company(self):
        self.assertEqual(self.resolve(self.branch_b.id), self.branch_b)

    def test_a_value_that_is_not_an_active_membership_is_the_home_company(self):
        for stored in (self.root_company.id, NOT_FOUND_ID, 'x'):
            with self.subTest(stored=stored):
                self.assertEqual(self.resolve(stored), self.branch_a)
        self.assertEqual(self.resolve(self.branch_b.id, user=self.plain), self.branch_b)
        self.assertEqual(self.resolve(self.branch_a.id, user=self.b_user), self.branch_b)

    def test_an_archived_company_is_the_home_company(self):
        self.assertEqual(self.resolve(self.archived_branch.id, user=self.archived_member), self.branch_a)


@tagged('post_install', '-at_install', 'liwan')
class TestExpectedCompanyHeader(WorkingCompanyCase):

    def count_roles(self):
        return self.env['liwan.access.role'].search_count([('type', '=', 'custom')])

    def test_a_stale_company_header_is_refused_and_writes_nothing_outside_finance(self):
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        before = self.count_roles()
        stale = self.create_role('Stale', headers={EXPECTED_COMPANY_HEADER: str(self.branch_a.id)})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'request_context_changed'), stale.text)
        self.assertEqual(self.count_roles(), before)

    def test_the_same_write_without_the_header_or_with_the_current_company_succeeds(self):
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        self.assertEqual(self.create_role('Without header').status_code, 201)
        current = self.create_role('Current', headers={EXPECTED_COMPANY_HEADER: str(self.branch_b.id)})
        self.assertEqual(current.status_code, 201, current.text)

    def test_the_header_is_checked_on_reads_too_and_never_selects_a_company(self):
        self.sign_in('wc_roamer')
        stale = self.url_open('/api/v1/me', headers={EXPECTED_COMPANY_HEADER: str(self.branch_b.id)})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'request_context_changed'), stale.text)
        self.assertEqual(self.me()['company']['id'], self.branch_a.id)

    def test_a_malformed_header_answers_422(self):
        self.sign_in('wc_roamer')
        before = self.count_roles()
        for value in ('', '0', '01', '+1', '1.0', '9' * 17, 'x'):
            with self.subTest(value=value):
                refused = self.create_role('Malformed', headers={EXPECTED_COMPANY_HEADER: value})
                self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid_request_context'),
                                 refused.text)
        self.assertEqual(self.count_roles(), before)

    def test_a_personal_route_compares_the_header_with_the_working_company(self):
        self.sign_in('wc_roamer')
        self.switch(self.branch_b)
        working = self.url_open('/api/v1/me', headers={EXPECTED_COMPANY_HEADER: str(self.branch_b.id)})
        self.assertEqual(working.status_code, 200, working.text)


@tagged('post_install', '-at_install', 'liwan')
class TestUserAdministrationInTheWorkingCompany(WorkingCompanyCase):

    def test_an_administrator_switched_into_a_branch_manages_the_users_homed_there(self):
        self.sign_in('wc_roamer')
        at_home = self.api('GET', '/api/v1/admin/users')
        self.assertEqual(at_home.status_code, 200, at_home.text)
        self.assertIn(self.roamer.id, {item['id'] for item in at_home.json()['items']})
        self.assertNotIn(self.b_user.id, {item['id'] for item in at_home.json()['items']})

        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        listed = self.api('GET', '/api/v1/admin/users')
        self.assertEqual(listed.status_code, 200, listed.text)
        ids = {item['id'] for item in listed.json()['items']}
        self.assertIn(self.b_user.id, ids)
        self.assertNotIn(self.roamer.id, ids)
        self.assertEqual(self.api('GET', f'/api/v1/admin/users/{self.b_user.id}').status_code, 200)
        foreign = self.api('GET', f'/api/v1/admin/users/{self.roamer.id}')
        self.assertEqual((foreign.status_code, foreign.json()['code']), (404, 'not_found'), foreign.text)
