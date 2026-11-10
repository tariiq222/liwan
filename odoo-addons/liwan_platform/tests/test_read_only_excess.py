# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_platform.models.res_users import GRANT

ASSIGNMENT_ROLE = 'liwan_core.role_employee'


class ExcessCase(TransactionCase):
    """Users and branches above a purchased limit."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.record._liwan_initialize_legacy_policy(
            cls.env['liwan.feature.registry']._liwan_installed_module_ids(),
        )
        cls.service = cls.env['liwan.entitlement.service'].sudo()
        cls.access = cls.env['liwan.access.service']

    def _set_limit(self, key, value):
        self.record.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.record.features, key: value},
        })

    def _users(self, count, prefix='excess_user'):
        return [
            new_test_user(self.env, login=f'{prefix}_{index}', groups='liwan_core.group_employee')
            for index in range(count)
        ]

    def _write_as(self, user):
        return self.env['ir.attachment'].with_user(user).create({
            'name': 'by-user.txt', 'raw': b'x' * 10, 'mimetype': 'text/plain',
        })

    def _four_users_over_a_limit_of_three(self):
        base = self.service._liwan_count_users()
        self._set_limit('users.limit', base + 4)
        users = self._users(4)
        self._set_limit('users.limit', base + 3)
        return base, users


@tagged('post_install', '-at_install', 'liwan')
class TestExcessUsersAreReadOnly(ExcessCase):

    def test_the_user_above_the_limit_cannot_write_and_the_others_can(self):
        base, users = self._four_users_over_a_limit_of_three()
        self.assertEqual(self.service._liwan_count_users(), base + 3)
        self.assertEqual([user.liwan_read_only for user in users], [False, False, False, True])
        for user in users[:3]:
            self.assertTrue(self._write_as(user).exists())
        with self.assertRaises(LiwanAccessRule) as caught:
            self._write_as(users[3])
        self.assertEqual((caught.exception.code, caught.exception.status), ('user_read_only', 403))
        self.assertEqual(self.service._liwan_excess_counts()['users.limit'], 1)

    def test_a_grant_holder_stays_full_over_older_users(self):
        base = self.service._liwan_count_users()
        self._set_limit('users.limit', base + 3)
        older = self._users(2)
        admin = new_test_user(self.env, login='excess_admin', groups='liwan_core.group_access_admin')
        self._set_limit('users.limit', base + 2)
        self.assertFalse(admin.liwan_read_only)
        self.assertTrue(older[-1].liwan_read_only)
        self.assertFalse(older[0].liwan_read_only)

    def test_settle_is_idempotent_and_does_not_reshuffle(self):
        _base, users = self._four_users_over_a_limit_of_three()
        before = [user.liwan_read_only for user in users]
        self.assertFalse(self.service._liwan_settle_excess())
        self.assertEqual([user.liwan_read_only for user in users], before)

    def test_a_purchase_reopens_by_priority_then_age_and_keeps_a_customer_choice(self):
        base = self.service._liwan_count_users()
        self._set_limit('users.limit', base + 4)
        users = self._users(4)
        self._set_limit('users.limit', base + 1)
        self.assertEqual([user.liwan_read_only for user in users], [False, True, True, True])
        users[3].sudo().liwan_seat_priority = 1
        self._set_limit('users.limit', base + 2)
        self.assertEqual([user.liwan_read_only for user in users], [False, True, True, False])
        self.service._liwan_apply_flags(users[1], {'liwan_read_only': True, 'liwan_seat_choice': 'customer'})
        self._set_limit('users.limit', base + 4)
        self.assertEqual([user.liwan_read_only for user in users], [False, True, False, False])
        self.assertEqual(self.service._liwan_count_users(), base + 3)

    def _invite(self, admin, login):
        return self.access.with_user(admin)._liwan_invite_account(
            login, f'{login}@example.com',
            [{'role_id': self.env.ref(ASSIGNMENT_ROLE).id, 'scope': {'kind': 'company', 'id': self.env.company.id}}],
        )

    def test_service_accounts_hold_no_seat(self):
        eligible = set(self.service._liwan_seat_users().ids)
        for xmlid in ('liwan_ai.user_ai_usage', 'liwan_ai.user_ai_indexer'):
            account = self.env.ref(xmlid, raise_if_not_found=False)
            if account:
                self.assertNotIn(account.id, eligible)

    def test_a_pending_invitation_holds_a_seat_for_the_check_but_is_no_full_seat(self):
        admin = new_test_user(self.env, login='excess_inviter', groups='liwan_core.group_access_admin')
        full = self.service._liwan_count_users()
        self._set_limit('users.limit', full + 1)
        invitee = self._invite(admin, 'pending.invitee')
        self.assertEqual((self.service._liwan_count_users(), self.service._liwan_count_held_seats()), (full, full + 1))
        self.assertNotIn(invitee.id, self.service._liwan_seat_users().ids)
        # Read-only accounts only come from a limit decrease: a second invitation past the limit is refused.
        with self.assertRaises(LiwanAccessRule) as caught:
            self._invite(admin, 'second.invitee')
        self.assertEqual(caught.exception.details['reason'], 'limit')
        # The limit drops meanwhile: the invitee is not demoted by the settle and accepts into no free seat.
        self._set_limit('users.limit', full)
        self.assertFalse(invitee.liwan_read_only)
        _token, raw = self.access._liwan_tokens()._liwan_issue(invitee, 'invite')
        self.access._liwan_accept_invitation(raw, '+966500000091', 'accepted_password_123')
        self.assertTrue(invitee.liwan_read_only)
        self.assertEqual(self.service._liwan_count_users(), full)

    def test_inviting_a_cancelled_invitation_again_needs_a_free_seat(self):
        admin = new_test_user(self.env, login='excess_reinviter', groups='liwan_core.group_access_admin')
        full = self.service._liwan_count_users()
        self._set_limit('users.limit', full + 1)
        invitee = self._invite(admin, 'cancelled.invitee')
        self.access.with_user(admin)._liwan_cancel_invitation(invitee, self.access._liwan_user_version(invitee))
        self._invite(admin, 'filler.invitee')
        with self.assertRaises(LiwanAccessRule):
            self._invite(admin, 'cancelled.invitee')

    def test_an_invitee_accepting_into_a_free_seat_becomes_full(self):
        before = self.service._liwan_count_users()
        admin = new_test_user(self.env, login='excess_inviter_two', groups='liwan_core.group_access_admin')
        self._set_limit('users.limit', before + 3)
        invitee = self.access.with_user(admin)._liwan_invite_account(
            'Free Seat Invitee', 'free.seat@example.com',
            [{'role_id': self.env.ref(ASSIGNMENT_ROLE).id, 'scope': {'kind': 'company', 'id': self.env.company.id}}],
        )
        _token, raw = self.access._liwan_tokens()._liwan_issue(invitee, 'invite')
        self.access._liwan_accept_invitation(raw, '+966500000092', 'accepted_password_123')
        self.assertFalse(invitee.liwan_read_only)
        self.assertEqual(self.service._liwan_count_users(), before + 2)


@tagged('post_install', '-at_install', 'liwan')
class TestSeatToggle(ExcessCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(cls.env, login='seat_admin', groups='liwan_core.group_access_admin')

    def _version(self, user):
        return self.access._liwan_user_version(user)

    def _set_seat(self, user, **kwargs):
        service = self.access.with_user(self.admin)
        return service._liwan_set_seat(user.with_user(self.admin), self._version(user), **kwargs)

    def test_making_a_user_full_goes_through_the_limit(self):
        _base, users = self._four_users_over_a_limit_of_three()
        with self.assertRaises(LiwanAccessRule) as caught:
            self._set_seat(users[3], read_only=False)
        self.assertEqual(caught.exception.details['limit_key'], 'users.limit')
        self.assertTrue(users[3].liwan_read_only)
        self._set_seat(users[0], read_only=True)
        self._set_seat(users[3], read_only=False)
        self.assertFalse(users[3].liwan_read_only)
        self.assertEqual(users[3].liwan_seat_choice, 'customer')
        self.assertTrue(users[0].liwan_read_only)
        self.assertEqual(self.service._liwan_count_users(), self.service._liwan_count_usage('users.limit'))

    def test_the_priority_is_stored_and_a_user_cannot_flag_themselves(self):
        users = self._users(1)
        self._set_seat(users[0], priority=3)
        self.assertEqual(users[0].liwan_seat_priority, 3)
        with self.assertRaises(LiwanAccessRule) as caught:
            self.access.with_user(self.admin)._liwan_set_seat(
                self.admin, self._version(self.admin), read_only=True,
            )
        self.assertEqual(caught.exception.code, 'self_access_change')

    def test_a_read_only_administrator_cannot_change_a_seat_or_their_own_flag(self):
        users = self._users(1)
        self.service._liwan_apply_flags(self.admin, {'liwan_read_only': True})
        with self.assertRaises(LiwanAccessRule) as caught:
            self._set_seat(users[0], read_only=True)
        self.assertEqual(caught.exception.code, 'user_read_only')
        with self.assertRaises(AccessError):
            self.admin.with_user(self.admin).write({'liwan_read_only': False})
        self.assertTrue(self.admin.liwan_read_only)

    def test_protected_account_mutation_keeps_the_last_full_grant_holder(self):
        company = self.env['res.company'].create({'name': 'Only Full Seat Admin'})
        admin = new_test_user(
            self.env, login='only_full_grant_admin', groups='liwan_core.group_access_admin',
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        self.env['liwan.access.assignment'].create({
            'user_id': admin.id, 'role_id': self.env.ref('liwan_core.role_system_admin').id,
            'company_id': company.id,
        })
        admin = admin.with_company(company)
        self.assertTrue(self.access.with_company(company)._liwan_has_capability(admin, GRANT, company=company))
        for values in ({'liwan_read_only': True}, {'active': False}):
            with self.subTest(values=values), self.assertRaises(LiwanAccessRule) as caught:
                with self.env.cr.savepoint():
                    admin._liwan_access_write(values, GRANT)
            self.assertEqual(caught.exception.code, 'last_access_admin')
        self.assertTrue(admin.active)
        self.assertFalse(admin.liwan_read_only)

    def test_an_account_without_grant_can_release_its_seat_in_a_company_without_a_grant_holder(self):
        company = self.env['res.company'].create({'name': 'Staff Company'})
        user = new_test_user(
            self.env, login='seat_staff_only', groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        self.assertFalse(self.access._liwan_has_capability(user, GRANT, company=company))
        user.write({'liwan_read_only': True})
        self.assertTrue(user.liwan_read_only)

    def test_disabling_a_user_reopens_the_next_read_only_account(self):
        _base, users = self._four_users_over_a_limit_of_three()
        self.access.with_user(self.admin)._liwan_disable_user(users[0].with_user(self.admin), self._version(users[0]))
        self.assertFalse(users[3].liwan_read_only)

    def test_an_access_write_that_disables_an_account_frees_its_seat(self):
        """The settle follows the account's `active` flag, not one route (the HR archive goes through `_liwan_access_write`)."""
        _base, users = self._four_users_over_a_limit_of_three()
        users[0]._liwan_access_write({'active': False}, 'access.users.disable')
        self.assertFalse(users[3].liwan_read_only)

    def test_a_plain_orm_write_that_disables_an_account_frees_its_seat(self):
        _base, users = self._four_users_over_a_limit_of_three()
        users[0].write({'active': False})
        self.assertFalse(users[3].liwan_read_only)

    def test_a_limit_of_zero_keeps_one_full_access_administrator(self):
        self._four_users_over_a_limit_of_three()
        self._set_limit('users.limit', 0)
        full = self.env['res.users'].browse(self.service._liwan_full_seat_ids())
        self.assertEqual(len(full), 1)
        self.assertTrue(self.access._liwan_has_capability(full, GRANT, company=full.company_id))
        self.assertFalse(self.service._liwan_settle_excess(), 'the settle is idempotent')
        self._set_limit('users.limit', None)
        self.assertEqual(len(self.service._liwan_seat_users().filtered('liwan_read_only')), 0)

    def test_a_read_only_administrator_is_not_a_surviving_access_administrator(self):
        company = self.env['res.company'].create({'name': 'Survival Co'})
        role = self.env.ref('liwan_core.role_system_admin')
        full_admin, read_only_admin = (
            new_test_user(
                self.env, login=f'survival_{index}', groups='base.group_user',
                company_id=company.id, company_ids=[Command.set(company.ids)],
            ) for index in range(2)
        )
        for user in (full_admin, read_only_admin):
            self.env['liwan.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': company.id})
        self.service._liwan_apply_flags(read_only_admin, {'liwan_read_only': True})
        with self.assertRaises(LiwanAccessRule) as caught:
            self.access._liwan_assert_admin_survives(company, excluding_user=full_admin)
        self.assertEqual(caught.exception.code, 'last_access_admin')
        self.access._liwan_assert_admin_survives(company, excluding_user=read_only_admin)
