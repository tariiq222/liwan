# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from odoo.exceptions import AccessDenied
from odoo.tests import new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.liwan_api.models import login_throttle
from odoo.addons.liwan_api.models.login_throttle import (
    AUDIT_ACTION,
    BASE_DELAY,
    FREE_FAILURES,
    MAX_DELAY,
    delay_after,
)
from odoo.addons.liwan_api.tests.common import LiwanApiCase

PASSWORD = 'throttle-pass-123'
CREDENTIAL = {'type': 'password'}
START = datetime(2026, 1, 1, 12, 0, 0)
# Failures that reach the cap: the first count whose delay is MAX_DELAY.
CAP_FAILURES = next(count for count in range(FREE_FAILURES, 100) if delay_after(count) == timedelta(seconds=MAX_DELAY))


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestLoginThrottle(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.alice = new_test_user(cls.env, login='throttle_alice@example.com', password=PASSWORD,
                                  name='Alice', groups='liwan_core.group_employee')
        cls.bob = new_test_user(cls.env, login='throttle_bob@example.com', password=PASSWORD,
                                name='Bob', groups='liwan_core.group_employee')

    def setUp(self):
        super().setUp()
        self.now = START
        self.patch(login_throttle, '_now', lambda: self.now)
        # Odoo's own cooldown reads the request; the throttle runs only when there is one, so the tests supply it.
        request = MagicMock()
        request.cookies.get.return_value = None
        request.httprequest.environ = {'REMOTE_ADDR': '10.0.0.1'}
        for module in ('odoo.addons.base.models.res_users', 'odoo.addons.liwan_api.models.res_users'):
            patcher = patch(f'{module}.request', request)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.mails = []
        self.patch(
            type(self.env['liwan.account.mail']), '_liwan_send_notice',
            lambda model, recipient, name, purpose: self.mails.append((recipient, name, purpose)),
        )

    def _login(self, login, password):
        with mute_logger('odoo.addons.base.models.res_users'):
            return self.env['res.users']._login({**CREDENTIAL, 'login': login, 'password': password}, {'interactive': False})

    def _refused(self, login, password):
        # Not ``assertRaises``: Odoo's wraps the block in a savepoint it rolls back, which in a test would also
        # undo the failure the throttle committed on its own cursor.
        try:
            self._login(login, password)
        except AccessDenied as refusal:
            return refusal
        self.fail('the sign-in was not refused')
        return None

    def _fail(self, login, times, step=timedelta(seconds=MAX_DELAY + 1)):
        """``times`` wrong attempts, each after the previous delay has run out."""
        for _ in range(times):
            self._refused(login, 'wrong')
            self.now += step

    def _row(self, login):
        # The counter is written by raw SQL on another cursor, so the ORM cache of this test cannot know it.
        self.env.invalidate_all()
        key = self.env['liwan.login.throttle']._liwan_key(login)
        return self.env['liwan.login.throttle'].search([('key', '=', key)])

    def test_the_delay_doubles_from_the_first_free_limit_up_to_the_cap(self):
        self.assertEqual(delay_after(FREE_FAILURES - 1), timedelta(0))
        self.assertEqual(delay_after(FREE_FAILURES), timedelta(seconds=BASE_DELAY))
        self.assertEqual(delay_after(FREE_FAILURES + 1), timedelta(seconds=2 * BASE_DELAY))
        self.assertEqual(delay_after(FREE_FAILURES + 4), timedelta(seconds=16 * BASE_DELAY))
        self.assertEqual(delay_after(CAP_FAILURES), timedelta(seconds=MAX_DELAY))
        self.assertEqual(delay_after(10_000), timedelta(seconds=MAX_DELAY))

    def test_the_attempt_after_five_failures_is_refused_even_with_the_right_password_until_the_delay_ends(self):
        self._fail(self.alice.login, FREE_FAILURES - 1, step=timedelta(seconds=1))
        self.assertTrue(self._login(self.alice.login, PASSWORD), 'four failures are still free')
        self._fail(self.alice.login, FREE_FAILURES, step=timedelta(seconds=1))
        self._refused(self.alice.login, PASSWORD)
        self.now += timedelta(seconds=BASE_DELAY - 2)
        self._refused(self.alice.login, PASSWORD)
        self.now += timedelta(seconds=3)
        self.assertEqual(self._login(self.alice.login, PASSWORD)['uid'], self.alice.id)

    def test_a_delayed_attempt_is_not_counted_and_does_not_extend_the_delay(self):
        self._fail(self.alice.login, FREE_FAILURES, step=timedelta(seconds=1))
        self.now += timedelta(seconds=BASE_DELAY // 2)
        self._refused(self.alice.login, 'wrong')
        self.assertEqual(self._row(self.alice.login).failures, FREE_FAILURES)

    def test_failures_are_counted_on_their_own_cursor_so_the_refused_request_cannot_roll_them_back(self):
        with patch.object(self.registry, 'cursor', wraps=self.registry.cursor) as opened:
            for expected in (1, 2, 3):
                self._refused(self.alice.login, 'wrong')
                self.assertEqual(self._row(self.alice.login).failures, expected)
            self.assertEqual(opened.call_count, 3)

    def test_another_account_is_not_slowed_by_the_failures_of_one(self):
        self._fail(self.alice.login, FREE_FAILURES, step=timedelta(seconds=1))
        self._refused(self.alice.login, PASSWORD)
        self.assertEqual(self._login(self.bob.login, PASSWORD)['uid'], self.bob.id)

    def test_the_login_is_normalized_so_spelling_does_not_dodge_the_counter(self):
        for variant in (' Throttle_Alice@Example.com', 'THROTTLE_ALICE@EXAMPLE.COM ', self.alice.login,
                        'throttle_alice@example.com  ', 'Throttle_alice@example.com'):
            self._refused(variant, 'wrong')
        self._refused(self.alice.login, PASSWORD)

    def test_a_success_clears_the_counter(self):
        self._fail(self.alice.login, FREE_FAILURES - 1, step=timedelta(seconds=1))
        self._login(self.alice.login, PASSWORD)
        self.assertFalse(self._row(self.alice.login))
        self._fail(self.alice.login, FREE_FAILURES - 1, step=timedelta(seconds=1))
        self.assertTrue(self._login(self.alice.login, PASSWORD))

    def test_an_unknown_login_is_throttled_like_a_known_one(self):
        known = self._refused(self.alice.login, 'wrong')
        self._fail('nobody@example.com', FREE_FAILURES, step=timedelta(seconds=1))
        delayed = self._refused('nobody@example.com', 'wrong')
        self.assertEqual(self._row('nobody@example.com').failures, FREE_FAILURES)
        self.assertEqual(str(delayed), str(known))
        self.assertEqual(type(delayed), type(known))

    def test_a_delayed_answer_is_the_same_refusal_as_a_wrong_password(self):
        wrong = self._refused(self.alice.login, 'wrong')
        self._fail(self.alice.login, FREE_FAILURES - 1, step=timedelta(seconds=1))
        delayed = self._refused(self.alice.login, PASSWORD)
        self.assertEqual((type(delayed), str(delayed), delayed.args), (type(wrong), str(wrong), wrong.args))

    def test_the_cap_mails_the_owner_once_and_leaves_one_audit_row(self):
        audit = self.env['liwan.access.audit']
        self._fail(self.alice.login, CAP_FAILURES - 1)
        self.assertFalse(self.mails)
        self.assertFalse(audit.search([('action', '=', AUDIT_ACTION)]))
        self._fail(self.alice.login, 3)
        self.assertEqual(self.mails, [(self.alice.login, 'Alice', 'login_throttled')])
        rows = audit.search([('action', '=', AUDIT_ACTION)])
        self.assertEqual(rows.mapped('target_id'), [self.alice.id])
        self.assertEqual(rows.after, {'failures': CAP_FAILURES, 'delay_seconds': MAX_DELAY})
        self.assertFalse(rows.actor_id)

    def test_the_notice_is_armed_again_after_a_success(self):
        self._fail(self.alice.login, CAP_FAILURES)
        self._login(self.alice.login, PASSWORD)
        self._fail(self.alice.login, CAP_FAILURES)
        self.assertEqual(len(self.mails), 2)

    def test_the_notice_is_armed_again_after_a_day_without_failures(self):
        self._fail(self.alice.login, CAP_FAILURES)
        self.now += login_throttle.IDLE_ROW_AGE
        self._fail(self.alice.login, CAP_FAILURES)
        self.assertEqual(len(self.mails), 2)

    def test_an_unknown_login_at_the_cap_has_nobody_to_notify(self):
        self._fail('nobody@example.com', CAP_FAILURES)
        self.assertFalse(self.mails)
        self.assertFalse(self.env['liwan.access.audit'].search([('action', '=', AUDIT_ACTION)]))

    def test_a_failed_notice_does_not_change_the_refusal_and_keeps_the_count(self):
        def broken(model, recipient, name, purpose):
            raise ValueError(recipient)

        with patch.object(type(self.env['liwan.account.mail']), '_liwan_send_notice', broken):
            with mute_logger('odoo.addons.liwan_api.models.login_throttle'):
                self._fail(self.alice.login, CAP_FAILURES)
        row = self._row(self.alice.login)
        self.assertEqual(row.failures, CAP_FAILURES)
        self.assertFalse(row.notified_at, 'a notice that failed stays unclaimed')
        self.assertFalse(self.env['liwan.access.audit'].search([('action', '=', AUDIT_ACTION)]))
        self._fail(self.alice.login, 1)
        self.assertEqual(self.mails, [(self.alice.login, 'Alice', 'login_throttled')])
        self.assertTrue(self._row(self.alice.login).notified_at)

    def test_the_cap_reached_by_a_spelling_variant_notifies_the_real_account_once(self):
        self._fail(' Throttle_ALICE@Example.com ', CAP_FAILURES + 2)
        self.assertEqual(self.mails, [(self.alice.login, 'Alice', 'login_throttled')])
        self.assertEqual(self.env['liwan.access.audit'].search([('action', '=', AUDIT_ACTION)]).target_id, self.alice.id)

    def test_nobody_is_notified_when_the_login_matches_two_accounts(self):
        twin = new_test_user(self.env, login='THROTTLE_ALICE@example.com', password=PASSWORD, name='Twin',
                             groups='liwan_core.group_employee')
        self._fail(self.alice.login, CAP_FAILURES)
        self.assertEqual(twin.login.casefold(), self.alice.login)
        self.assertFalse(self.mails)

    def test_a_counter_fault_still_surfaces_the_plain_refusal(self):
        def broken(model, key, login):
            raise ValueError(login)

        with patch.object(type(self.env['liwan.login.throttle']), '_liwan_record_failure', broken):
            with mute_logger('odoo.addons.liwan_api.models.res_users'):
                refusal = self._refused(self.alice.login, 'wrong')
        self.assertEqual(type(refusal), AccessDenied)

    def test_the_vacuum_drops_only_idle_rows(self):
        self._refused('old@example.com', 'wrong')
        self.now += login_throttle.IDLE_ROW_AGE + timedelta(hours=1)
        self._refused('new@example.com', 'wrong')
        self.env['liwan.login.throttle']._gc_idle_throttles()
        self.assertFalse(self._row('old@example.com'))
        self.assertTrue(self._row('new@example.com'))

    def test_a_user_id_is_throttled_under_its_login(self):
        users = self.env['res.users']
        for _ in range(FREE_FAILURES):
            with mute_logger('odoo.addons.base.models.res_users'):
                try:
                    users._check_uid_passwd(self.alice.id, 'wrong')
                except AccessDenied:
                    continue
            self.fail('the password was not refused')
        self.assertEqual(self._row(self.alice.login).failures, FREE_FAILURES)
        self._refused(self.alice.login, PASSWORD)

    def test_no_request_means_no_throttle(self):
        with patch('odoo.addons.liwan_api.models.res_users.request', None):
            with mute_logger('odoo.addons.base.models.res_users'), self.assertRaises(AccessDenied):
                self.env['res.users']._login({**CREDENTIAL, 'login': self.alice.login, 'password': 'wrong'},
                                             {'interactive': False})
        self.assertFalse(self._row(self.alice.login))
