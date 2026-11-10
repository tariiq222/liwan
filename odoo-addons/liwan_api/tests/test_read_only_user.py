# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo.fields import Command
from odoo.tests import get_db_name, new_test_user, tagged

from .common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

# Routes that end the caller's own session or are not data reads.
SKIPPED_READ_ROUTES = re.compile(r'^/api/v1/(public/|auth/|logout|session)')


@tagged('post_install', '-at_install', 'liwan')
class TestReadOnlyUserApi(LiwanApiCase):
    """A read-only account signs in, reads and exports everything it may, keeps its own credentials, and writes nothing else."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.service = cls.env['liwan.entitlement.service'].sudo()
        cls.profile = cls.env.ref('liwan_platform.tenant_profile')
        cls.employee.write({'liwan_mobile': '+966590000021', 'email': 'api_emp@example.test'})
        cls.admin = new_test_user(
            cls.env, login='ro_admin', password='ro_admin_pass_123', groups='base.group_user',
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.admin.id, 'role_id': cls.env.ref('liwan_core.role_system_admin').id,
            'company_id': cls.company.id,
        })
        cls.service._liwan_apply_flags(cls.employee, {'liwan_read_only': True})

    def _password_step(self, login='api_emp', password='api_emp_pass_123'):
        return self.url_open(
            '/web/session/authenticate',
            json={'jsonrpc': '2.0', 'method': 'call', 'id': 0, 'params': {'db': get_db_name(), 'login': login, 'password': password}},
            headers={'Content-Type': 'application/json'},
        )

    def test_a_read_only_account_signs_in_with_the_code_and_reads(self):
        sent = []
        self.patch(
            type(self.env['liwan.sms.gateway']), '_liwan_send',
            lambda model, channel, destination, body: sent.append(body),
        )
        step = self._password_step()
        self.assertNotIn('error', step.json(), step.text)
        issued = self.api('POST', '/api/v1/auth/code', {'channel': 'sms'})
        self.assertEqual(issued.status_code, 200, issued.text)
        verified = self.api('POST', '/api/v1/auth/verify', {'code': sent[-1].split()[-1]})
        self.assertEqual(verified.status_code, 200, verified.text)
        me = self.api('GET', '/api/v1/me')
        self.assertEqual((me.status_code, me.json()['login']), (200, 'api_emp'))

    def test_the_read_routes_of_every_installed_application_answer_without_a_read_only_refusal(self):
        """Many reads write (logs, sessions, presence): the allow-list is whatever this walk needs, and nothing more."""
        self.authenticate('api_emp', 'api_emp_pass_123')
        # Detail routes too, with the first id: a read that writes before it looks the record up shows here.
        paths = sorted({
            path for rule in self.env['ir.http'].routing_map().iter_rules()
            if rule.rule.startswith('/api/v1/') and 'GET' in (rule.methods or ()) and not SKIPPED_READ_ROUTES.match(rule.rule)
            and '<' not in (path := re.sub(r'<int:\w+>', '1', rule.rule))
        })
        self.assertGreater(len(paths), 100)
        refused = []
        for path in paths:
            response = self.api('GET', path)
            body = response.json() if response.headers.get('Content-Type', '').startswith('application/json') else {}
            if isinstance(body, dict) and body.get('code') in ('user_read_only', 'branch_read_only'):
                refused.append(path)
        self.assertEqual(refused, [])

    def test_credentials_mobile_and_notification_state_stay_writable(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        mobile = self.api('PATCH', '/api/v1/me/mobile', {'mobile': '+966590000022'})
        self.assertEqual((mobile.status_code, mobile.json()['mobile']), (200, '+966590000022'))
        weak = self.api('POST', '/api/v1/me/password', {'current': 'api_emp_pass_123', 'new': 'short'})
        self.assertEqual((weak.status_code, weak.json()['code']), (422, 'weak_password'))
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).status_code, 200)

    def test_the_account_reports_it_is_read_only_and_keeps_its_own_preferences_and_password(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertIs(self.api('GET', '/api/v1/me').json()['read_only'], True)
        appearance = self.api('PATCH', '/api/v1/me/appearance', {'mode': 'dark', 'font_size': 'large'})
        self.assertEqual((appearance.status_code, appearance.json()['appearance']), (200, {'mode': 'dark', 'font_size': 'large'}))
        mails = self.env['mail.mail'].search_count([('email_to', 'ilike', 'api_emp@example.test')])
        changed = self.api('POST', '/api/v1/me/password', {'current': 'api_emp_pass_123', 'new': 'a-new-twelve-chars'})
        self.assertEqual((changed.status_code, changed.json()['read_only']), (200, True), changed.text)
        # Odoo queues its security notice to the person's own address; the fence lets that one mail through.
        self.assertGreater(self.env['mail.mail'].search_count([('email_to', 'ilike', 'api_emp@example.test')]), mails)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)

    def test_an_administrator_who_is_read_only_cannot_write(self):
        self.service._liwan_apply_flags(self.admin, {'liwan_read_only': True})
        self.authenticate('ro_admin', 'ro_admin_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/users').status_code, 200)
        response = self.api('POST', '/api/v1/admin/users', {
            'name': 'Blocked', 'login': 'blocked.ro@example.com',
            'assignments': [{'role_id': self.env.ref('liwan_core.role_employee').id, 'scope': {'kind': 'company', 'id': self.company.id}}],
        })
        self.assertEqual((response.status_code, response.json()['code']), (403, 'user_read_only'), response.text)
        own = self.api('PATCH', f'/api/v1/admin/users/{self.admin.id}/seat', {
            'expected_version': self.env['liwan.access.service']._liwan_user_version(self.admin), 'read_only': False,
        })
        self.assertIn(own.status_code, (403, 422), own.text)
        self.assertTrue(self.admin.liwan_read_only)


@tagged('post_install', '-at_install', 'liwan')
class TestSeatAdminApi(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.profile = cls.env.ref('liwan_platform.tenant_profile')
        cls.service = cls.env['liwan.entitlement.service'].sudo()
        cls.admin = new_test_user(
            cls.env, login='seat_api_admin', password='seat_api_admin_pass_123', groups='base.group_user',
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.admin.id, 'role_id': cls.env.ref('liwan_core.role_system_admin').id,
            'company_id': cls.company.id,
        })

    def _limit(self, key, value):
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**self.profile.features, key: value}})

    def _version(self, user):
        return self.env['liwan.access.service']._liwan_user_version(user)

    def test_seats_report_full_seats_and_the_read_only_remainder(self):
        base = self.service._liwan_count_users()
        self._limit('users.limit', base + 2)
        new_test_user(self.env, login='seat_api_a', groups='liwan_core.group_employee')
        new_test_user(self.env, login='seat_api_b', groups='liwan_core.group_employee')
        self._limit('users.limit', base + 1)
        self.authenticate('seat_api_admin', 'seat_api_admin_pass_123')
        seats = self.api('GET', '/api/v1/admin/users/seats').json()
        self.assertEqual(seats, {'used': base + 1, 'limit': base + 1, 'read_only': 1})

    def test_the_seat_route_toggles_within_the_limit_and_refuses_beyond_it(self):
        base = self.service._liwan_count_users()
        self._limit('users.limit', base + 2)
        first = new_test_user(self.env, login='seat_api_c', groups='liwan_core.group_employee')
        second = new_test_user(self.env, login='seat_api_d', groups='liwan_core.group_employee')
        self._limit('users.limit', base + 1)
        self.authenticate('seat_api_admin', 'seat_api_admin_pass_123')
        refused = self.api('PATCH', f'/api/v1/admin/users/{second.id}/seat', {
            'expected_version': self._version(second), 'read_only': False,
        })
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertTrue(second.liwan_read_only)
        self.assertEqual(self.api('PATCH', f'/api/v1/admin/users/{first.id}/seat', {
            'expected_version': self._version(first), 'read_only': True,
        }).json()['read_only'], True)
        reopened = self.api('PATCH', f'/api/v1/admin/users/{second.id}/seat', {
            'expected_version': self._version(second), 'read_only': False, 'priority': 2,
        })
        self.assertEqual(reopened.status_code, 200, reopened.text)
        body = reopened.json()
        self.assertEqual((body['read_only'], body['seat_choice'], body['seat_priority']), (False, 'customer', 2))
        self.assertIn('set_seat', self.api('GET', f'/api/v1/admin/users/{second.id}').json()['allowed_actions'])

    def test_the_seat_route_validates_its_body_and_the_version(self):
        user = new_test_user(self.env, login='seat_api_e', groups='liwan_core.group_employee')
        self.authenticate('seat_api_admin', 'seat_api_admin_pass_123')
        url = f'/api/v1/admin/users/{user.id}/seat'
        for body in (
            {'expected_version': self._version(user)},
            {'expected_version': self._version(user), 'read_only': 'yes'},
            {'expected_version': self._version(user), 'priority': -1},
            {'expected_version': self._version(user), 'priority': 2_147_483_648},
            {'expected_version': self._version(user), 'read_only': True, 'priority': None},
            {'expected_version': self._version(user), 'read_only': None, 'priority': 1},
            {'expected_version': self._version(user), 'read_only': True, 'extra': 1},
            {'read_only': True},
        ):
            self.assertEqual(self.api('PATCH', url, body).status_code, 422, body)
        stale = self.api('PATCH', url, {'expected_version': 'u0-r0', 'read_only': True})
        self.assertEqual(stale.status_code, 409)
        largest = self.api('PATCH', url, {'expected_version': self._version(user), 'priority': 2_147_483_647})
        self.assertEqual((largest.status_code, largest.json().get('seat_priority')), (200, 2_147_483_647))

    def test_the_seat_route_needs_the_grant_capability(self):
        user = new_test_user(self.env, login='seat_api_f', groups='liwan_core.group_employee')
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/admin/users/{user.id}/seat', {
            'expected_version': self._version(user), 'read_only': True,
        })
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_the_branch_routes_list_and_toggle_seats_behind_company_administration(self):
        self._limit('branches.extra_limit', 2)
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True})._liwan_apply_branches(
            'op-seat', 'rev-1', [{'branch_id': 'seat-b1', 'name': 'Seat B1'}, {'branch_id': 'seat-b2', 'name': 'Seat B2'}],
        )
        company = self.env['liwan.tenant.branch'].search([('branch_uid', '=', 'seat-b1')]).company_id
        branches = self.env['liwan.tenant.branch'].search([('branch_uid', 'in', ['seat-b1', 'seat-b2'])]).company_id
        self.admin.write({'company_ids': [Command.link(branch_id) for branch_id in branches.ids]})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/branches').status_code, 403)
        self.authenticate('seat_api_admin', 'seat_api_admin_pass_123')
        listed = self.api('GET', '/api/v1/admin/branches')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual({item['name'] for item in listed.json()['items']} >= {'Seat B1', 'Seat B2'}, True, listed.text)
        changed = self.api('PATCH', f'/api/v1/admin/branches/{company.id}/seat', {'read_only': True, 'priority': 1})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(
            (changed.json()['read_only'], changed.json()['seat_choice'], changed.json()['restore_priority']),
            (True, 'customer', 1),
        )
        self.assertEqual(self.api('PATCH', f'/api/v1/admin/branches/{company.id}/seat', {}).status_code, 422)
        oversized = self.api('PATCH', f'/api/v1/admin/branches/{company.id}/seat', {'priority': 2_147_483_648})
        self.assertEqual((oversized.status_code, oversized.json().get('field')), (422, 'priority'))
        self.assertEqual(self.api('PATCH', f'/api/v1/admin/branches/{company.id}/seat', {
            'read_only': None, 'priority': 1,
        }).status_code, 422)
        largest = self.api('PATCH', f'/api/v1/admin/branches/{company.id}/seat', {'priority': 2_147_483_647})
        self.assertEqual((largest.status_code, largest.json().get('restore_priority')), (200, 2_147_483_647))
        self.assertEqual(self.api('PATCH', '/api/v1/admin/branches/999999/seat', {'read_only': True}).status_code, 404)

    def test_a_seat_is_not_offered_for_a_pending_invitee_and_acceptance_reports_the_outcome(self):
        used = self.service._liwan_count_users()
        self._limit('users.limit', used + 1)
        invitee = self.env['liwan.access.service'].with_user(self.admin)._liwan_invite_account(
            'Pending Seat', 'pending.seat@example.com',
            [{'role_id': self.env.ref('liwan_core.role_employee').id, 'scope': {'kind': 'company', 'id': self.company.id}}],
        )
        self.authenticate('seat_api_admin', 'seat_api_admin_pass_123')
        actions = self.api('GET', f'/api/v1/admin/users/{invitee.id}').json()['allowed_actions']
        self.assertIn('cancel_invitation', actions)
        self.assertNotIn('set_seat', actions)
        refused = self.api('PATCH', f'/api/v1/admin/users/{invitee.id}/seat', {
            'expected_version': self._version(invitee), 'read_only': True,
        })
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'seat_not_applicable'))
        # The limit drops before the invitee accepts: no full seat is free, so the account comes out read-only.
        self._limit('users.limit', used)
        _token, raw = self.env['liwan.access.service']._liwan_tokens()._liwan_issue(invitee, 'invite')
        accepted = self.api('POST', '/api/v1/public/account/invitation/accept', {
            'token': raw, 'mobile': '+966590000077', 'password': 'a-twelve-chars-pass',
        })
        self.assertEqual((accepted.status_code, accepted.json()), (200, {'login': 'pending.seat@example.com', 'read_only': True}))

    def test_a_branch_administrator_cannot_list_or_change_branch_seats(self):
        self._limit('branches.extra_limit', 2)
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True})._liwan_apply_branches(
            'op-scope', 'rev-1', [{'branch_id': 'scope-b1', 'name': 'Scope B1'}],
        )
        branch = self.env['liwan.tenant.branch'].search([('branch_uid', '=', 'scope-b1')]).company_id
        scoped = new_test_user(
            self.env, login='branch_scope_admin', password='branch_scope_admin_pass_123', groups='base.group_user',
            company_id=branch.id, company_ids=[Command.set(branch.ids)],
        )
        self.env['liwan.access.assignment'].create({
            'user_id': scoped.id, 'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': branch.id,
        })
        self.authenticate('branch_scope_admin', 'branch_scope_admin_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/branches').status_code, 403)
        self.assertEqual(self.api('PATCH', f'/api/v1/admin/branches/{branch.id}/seat', {'read_only': True}).status_code, 403)
