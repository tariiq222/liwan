# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

from psycopg2 import IntegrityError

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.liwan_ai.models.ai_balance import RUN_RESERVE
from odoo.addons.liwan_ai.serializers.usage import dump_usage
from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_balance_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None,
}
AI_KEYS = ('ai.balance.granted', 'ai.allowance.trial', 'ai.allowance.monthly')
GRANTED = 'ai.balance.granted'
TRIAL = 'ai.allowance.trial'
MONTHLY = 'ai.allowance.monthly'


@tagged('post_install', '-at_install', 'liwan')
class TestAiBalance(AiProbe, LiwanApiCase):
    """The prepaid balance (spec 2026-11-10 §5): deduction at write time, the pre-run check, the policy and the ceiling."""

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_balance_admin', password='ai_balance_admin_pass_123', name='Huda',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)
        self.recorder = self.env.ref('liwan_ai.user_ai_usage')
        self.Usage = self.env['liwan.ai.usage']
        self.Balance = self.env['liwan.ai.balance']
        self.profile = self.env.ref('liwan_platform.tenant_profile')
        self.now = datetime.now(timezone.utc)
        self._set_features({GRANTED: 1_000_000, TRIAL: 0, MONTHLY: 0})
        self._calls = 0

    def _set_features(self, values):
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**(self.profile.features or {}), **values}})

    def _set_trial(self, start, end):
        self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'ai_trial_start': start, 'ai_trial_end': end})

    def _call_id(self):
        self._calls += 1
        return f'{self._calls:016x}'

    def _item(self, charge, **values):
        item = {
            'conversation_id': 'r_balance', 'call_id': self._call_id(), 'kind': 'plan', 'capability': 'standard', 'billing': 'platform',
            'provider': 'acme-ai', 'model': 'acme-1', 'outcome': 'ok', 'input_tokens': 10, 'output_tokens': 5, 'cost': charge,
            'charge': charge, 'called_at': self.now.isoformat(),
        }
        return {**item, **values}

    def _record(self, *items):
        """Rows as the recorder account writes them, in this transaction."""
        rows = self.Usage.with_user(self.recorder)._liwan_ai_record_for(
            list(items), self.employee.id, self.employee.company_id.id,
        )
        return rows.sudo().mapped('charge_paid')

    def _raw(self, charge, paid, called_at, billing='platform', user=None, company=None, add_to_total=True, window_start=None):
        """A ledger row written directly, to place it in a window the service route would not accept; its paid part joins the
        running total as the recorder's write does.
        It is settled against the window of its call unless ``window_start`` says otherwise."""
        window_start = window_start or self.Balance._liwan_ai_window(called_at)[1]
        self.env.cr.execute(
            "INSERT INTO liwan_ai_usage (company_id, user_id, conversation_id, call_id, kind, capability, billing, provider, model,"
            " outcome, input_tokens, output_tokens, tokens_reported, cost, cost_reported, charge, charge_reported, charge_paid,"
            " called_at, allowance_window_start) VALUES (%s, %s, 'r_raw', %s, 'plan', 'standard', %s, 'acme-ai', 'acme-1', 'ok', 1, 1,"
            " true, %s, true, %s, true, %s, %s, %s)",
            [(company or self.env.company).id, (user or self.employee).id, self._call_id(), billing, charge, charge, paid, called_at,
             window_start],
        )
        if paid and add_to_total:
            self.profile.sudo()._liwan_add_ai_paid(paid)

    def _non_saas(self):
        """Fixture-only conversion: production ORM conversion is forbidden."""
        self.env.cr.execute(
            "UPDATE liwan_tenant_profile SET commercial_mode='non_saas', entitlement_source='local_policy', valid_until=NULL WHERE id=%s",
            [self.profile.id],
        )
        self.env.invalidate_all()

    def _charge_paid_at(self, charge, at):
        row = {'billing': 'platform', 'charge_reported': True, 'charge': charge, 'called_at': at}
        return self.Balance._liwan_ai_settle(row)['charge_paid']

    # -- deduction at write time ----------------------------------------------------------------------------------------------

    def test_a_call_inside_the_free_allowance_takes_nothing_from_the_balance(self):
        self._set_features({MONTHLY: 500})
        self.assertEqual(self._record(self._item(15)), [0])
        self.assertEqual(self.Balance._liwan_ai_state()['balance_left'], 1_000_000)

    def test_a_call_over_the_free_allowance_is_split(self):
        self._set_features({MONTHLY: 20})
        self.assertEqual(self._record(self._item(15)), [0])
        self.assertEqual(self._record(self._item(15)), [10])
        self.assertEqual(self._record(self._item(7)), [7])

    def test_without_an_allowance_the_whole_charge_is_paid(self):
        self.assertEqual(self._record(self._item(15)), [15])

    def test_the_rows_of_one_batch_share_the_allowance_in_order(self):
        self._set_features({MONTHLY: 20})
        quota = self.profile.quota_revision
        self.assertEqual(self._record(self._item(15), self._item(15), self._item(4)), [0, 10, 4])
        # The tenant's quota fence was written, so a batch on an older snapshot fails serialization instead of recounting stale rows.
        self.profile.invalidate_recordset()
        self.assertGreater(self.profile.quota_revision, quota)

    def test_a_re_sent_row_is_deducted_once(self):
        item = self._item(15)
        self.assertEqual(self._record(item), [15])
        self.assertEqual(self._record(item), [15])
        self.assertEqual(self.Balance._liwan_ai_paid_total(), 15)

    def test_only_charged_platform_calls_are_deducted(self):
        self.assertEqual(self._record(
            self._item(None, cost=None), self._item(0),
            self._item(None, billing='tenant_key', cost=None), self._item(None, billing='setup', cost=9),
        ), [0, 0, 0, 0])

    def test_a_tenant_without_a_balance_deducts_nothing(self):
        self._set_features({GRANTED: None})
        self.assertEqual(self._record(self._item(15)), [0])

    def test_the_allowance_renews_with_the_next_window(self):
        self._set_features({MONTHLY: 100})
        month_start = self.Balance._liwan_ai_window(fields.Datetime.now())[1]
        self._raw(100, 0, month_start - timedelta(hours=1))  # last month: used up the whole allowance of that month
        self._raw(60, 0, month_start + timedelta(minutes=1))  # this month
        self.assertEqual(self._charge_paid_at(30, month_start + timedelta(minutes=2)), 0)
        self.assertEqual(self._charge_paid_at(50, month_start + timedelta(minutes=2)), 10)
        # A late report settles against the window the call happened in, not the one it is written in.
        self.assertEqual(self._charge_paid_at(50, month_start - timedelta(hours=2)), 50)

    def test_the_trial_uses_its_own_allowance_in_five_day_windows(self):
        start = fields.Datetime.now().replace(microsecond=0) - timedelta(days=6)  # the second window began a day ago
        self._set_trial(start, start + timedelta(days=30))
        self._set_features({TRIAL: 100, MONTHLY: 10})
        self._raw(100, 0, start + timedelta(days=1))  # the first window is used up and gone
        self._raw(40, 0, start + timedelta(days=5, hours=1))
        now = fields.Datetime.now()
        self.assertEqual(self._charge_paid_at(50, now), 0)
        self.assertEqual(self._charge_paid_at(80, now), 20)
        self.assertEqual(self._charge_paid_at(30, start + timedelta(days=2)), 30)
        self.assertEqual(self.Balance._liwan_ai_allowance(now)[1::2], (60, start + timedelta(days=10)))

    def test_after_the_trial_the_monthly_allowance_applies(self):
        start = fields.Datetime.now() - timedelta(days=20)
        self._set_trial(start, start + timedelta(days=10))
        self._set_features({TRIAL: 1000, MONTHLY: 10})
        self.assertEqual(self._charge_paid_at(30, fields.Datetime.now()), 20)
        self.assertEqual(self._charge_paid_at(30, start + timedelta(days=1)), 0)

    def test_balance_left_is_the_granted_total_less_every_paid_part(self):
        for index in range(40):
            self._raw(30, 25, fields.Datetime.now() - timedelta(days=60 + index))
        state = self.Balance._liwan_ai_state()
        self.assertEqual((state['balance_granted'], state['balance_left']), (1_000_000, 999_000))
        self._raw(2_000_000, 2_000_000, fields.Datetime.now())
        self.assertEqual(self.Balance._liwan_ai_state()['balance_left'], 0)

    # -- the wire ------------------------------------------------------------------------------------------------------------

    def test_charge_paid_is_not_accepted_from_either_route(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        wire = self._item(None, cost=None, charge_paid=5)
        response = self.api('POST', '/api/v1/ai/usage', {'items': [wire]})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'items.0.charge_paid'))
        with self.assertRaises(ValidationError) as caught:
            self._record(self._item(15, charge_paid=0))
        self.assertEqual(caught.exception.liwan_field, 'charge_paid')
        self.assertFalse(self.Usage.search([]))

    def test_the_serializer_returns_the_paid_part(self):
        row = self.Usage.with_user(self.recorder)._liwan_ai_record_for([self._item(15)], self.employee.id, self.employee.company_id.id)
        self.assertEqual(dump_usage(row.sudo())['charge_paid'], 15)

    # -- the pre-run check ---------------------------------------------------------------------------------------------------

    def _send(self, **values):
        self.authenticate('api_emp', 'api_emp_pass_123')
        return self.api('POST', '/api/v1/ai/audit', {**MESSAGE, **values})

    def _empty_balance(self):
        self._set_features({GRANTED: 100})
        self._raw(100, 100, fields.Datetime.now())

    def test_a_run_starts_while_the_balance_has_something_left(self):
        self._set_features({GRANTED: 4 * RUN_RESERVE})
        self._raw(2 * RUN_RESERVE, 2 * RUN_RESERVE, fields.Datetime.now())
        self.assertEqual(self._send().status_code, 200)

    def test_a_new_run_is_refused_when_the_allowance_and_the_balance_are_used_up(self):
        self._empty_balance()
        refused = self._send()
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'ai_balance_empty'))
        self.assertIsNone(refused.json()['details']['resets_at'])
        self.assertEqual(self.env['liwan.ai.audit'].search_count([('kind', '=', 'message')]), 0)

    def test_the_refusal_names_when_an_existing_allowance_renews(self):
        self._empty_balance()
        self._set_features({MONTHLY: 50})
        self._raw(50, 0, fields.Datetime.now())
        refused = self._send()
        self.assertEqual(refused.json()['code'], 'ai_balance_empty')
        self.assertEqual(refused.json()['details']['resets_at'], self.Balance._liwan_ai_policy_fields()['allowance_resets_at'])
        self.assertTrue(refused.json()['details']['resets_at'].endswith('Z'))

    def test_a_free_allowance_left_lets_the_run_start_with_an_empty_balance(self):
        self._empty_balance()
        self._set_features({MONTHLY: 2 * RUN_RESERVE})
        self.assertEqual(self._send().status_code, 200)

    def test_the_free_agents_the_tenant_key_and_a_tenant_without_a_balance_are_never_refused(self):
        self._empty_balance()
        self.assertEqual(self._send(conversation_id='r_help', kind='help').status_code, 200)
        self.env['liwan.ai.settings']._liwan_current().provider_mode = 'tenant_key'
        self.assertEqual(self._send(conversation_id='r_key').status_code, 200)
        self.env['liwan.ai.settings']._liwan_current().provider_mode = 'platform'
        self._set_features({GRANTED: None})
        self.assertEqual(self._send(conversation_id='r_unlimited').status_code, 200)

    def test_the_monthly_spend_ceiling_stops_new_runs(self):
        self._set_features({GRANTED: 10_000_000})
        settings = self.env['liwan.ai.settings']._liwan_current()
        settings.monthly_spend_ceiling = 100
        self._raw(99, 99, fields.Datetime.now())
        self.assertEqual(self._send().status_code, 200)
        self._raw(1, 1, fields.Datetime.now())
        refused = self._send(conversation_id='r_ceiling')
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'ai_spend_ceiling'))
        self.assertTrue(refused.json()['details']['resets_at'].endswith('Z'))
        settings.monthly_spend_ceiling = 0
        self.assertEqual(self._send(conversation_id='r_no_ceiling').status_code, 200)

    def test_a_reached_ceiling_stops_a_run_the_allowance_cannot_pay_on_its_own(self):
        # A remaining allowance below one run's reserve can only pay part of the run, so the rest would cross the ceiling.
        self._set_features({GRANTED: 10_000_000, MONTHLY: RUN_RESERVE - 1})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 100
        self._raw(100, 100, fields.Datetime.now())
        refused = self._send()
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'ai_spend_ceiling'))

    def test_the_ceiling_exemption_counts_the_runs_already_in_flight(self):
        # With the ceiling reached, two runs in flight leave room for one reserve: the allowance must cover all three, not one.
        self._set_features({GRANTED: 10_000_000, MONTHLY: 2 * RUN_RESERVE})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 100
        self._raw(100, 100, fields.Datetime.now())
        self.assertEqual(self._send(conversation_id='r_in_flight_1').status_code, 200)
        self.assertEqual(self._send(conversation_id='r_in_flight_2').status_code, 200)
        refused = self._send(conversation_id='r_in_flight_3')
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'ai_spend_ceiling'))

    def test_the_ceiling_stops_paid_spend_only_and_the_free_allowance_comes_first(self):
        self._set_features({GRANTED: 10_000_000, MONTHLY: 2 * RUN_RESERVE})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 100
        self._raw(100, 100, fields.Datetime.now())
        # Free allowance left: the run is paid by it, so the reached ceiling does not stop it.
        self.assertEqual(self._send().status_code, 200)
        self._raw(2 * RUN_RESERVE, 0, fields.Datetime.now())
        refused = self._send(conversation_id='r_after_free')
        self.assertEqual(refused.json()['code'], 'ai_spend_ceiling')

    def test_both_refusals_carry_the_reset_time_in_details_and_the_policy(self):
        self._set_features({GRANTED: 100, MONTHLY: 50})
        self._raw(100, 100, fields.Datetime.now())
        self._raw(50, 0, fields.Datetime.now())
        empty = self._send().json()
        policy = self.Balance._liwan_ai_policy_fields()
        self.assertEqual((empty['code'], policy['blocked']), ('ai_balance_empty', 'ai_balance_empty'))
        self.assertEqual(empty['details'], {'resets_at': policy['blocked_resets_at']})
        self.assertEqual(policy['blocked_resets_at'], policy['allowance_resets_at'])
        self._set_features({GRANTED: 10_000_000})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 100
        ceiling = self._send(conversation_id='r_ceiling_shape').json()
        policy = self.Balance._liwan_ai_policy_fields()
        self.assertEqual((ceiling['code'], policy['blocked']), ('ai_spend_ceiling', 'ai_spend_ceiling'))
        self.assertEqual(set(ceiling['details']), {'resets_at'})
        self.assertEqual(ceiling['details']['resets_at'], policy['blocked_resets_at'])
        self.assertTrue(ceiling['details']['resets_at'].endswith('Z'))
        self._set_features({MONTHLY: 0, GRANTED: 100})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 0
        self.assertEqual(self._send(conversation_id='r_none').json()['details'], {'resets_at': None})

    def test_last_months_spend_does_not_count_against_the_ceiling(self):
        self._set_features({GRANTED: 10_000_000})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 100
        self._raw(500, 500, self.Balance._liwan_ai_window(fields.Datetime.now())[1] - timedelta(minutes=1))
        self.assertEqual(self._send().status_code, 200)

    # -- the policy ----------------------------------------------------------------------------------------------------------

    def test_the_policy_carries_the_balance_for_a_manager_and_no_token_fields(self):
        self._set_features({GRANTED: 1_000_000, MONTHLY: 300_000})
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 700_000
        self._raw(400_000, 100_000, fields.Datetime.now())
        policy = self.env['liwan.ai.tool.registry'].with_user(self.manager)._liwan_ai_policy()
        self.assertNotIn('tokens_monthly', policy)
        self.assertNotIn('tokens_used', policy)
        self.assertTrue(policy['allowance_resets_at'].endswith('Z'))
        self.assertEqual({key: policy[key] for key in (
            'balance_granted', 'balance_left', 'allowance', 'allowance_left', 'spend_ceiling', 'spend_this_month', 'blocked',
        )}, {
            'balance_granted': 1_000_000, 'balance_left': 900_000, 'allowance': 300_000, 'allowance_left': 0, 'spend_ceiling': 700_000,
            'spend_this_month': 100_000, 'blocked': None,
        })

    def test_an_ordinary_user_gets_the_verdict_and_no_billing_figures(self):
        self._set_features({GRANTED: 100, MONTHLY: 0})
        self._raw(100, 100, fields.Datetime.now())
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 700
        policy = self.env['liwan.ai.tool.registry'].with_user(self.employee)._liwan_ai_policy()
        for key in ('balance_granted', 'balance_left', 'allowance', 'allowance_left', 'spend_ceiling', 'spend_this_month'):
            self.assertIsNone(policy[key], key)
        self.assertEqual(policy['blocked'], 'ai_balance_empty')
        self.assertIsNone(policy['blocked_resets_at'])
        self.assertIsNone(policy['allowance_resets_at'])
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/ai/tools').json()['limits']['policy']
        self.assertEqual((body['blocked'], body['balance_left'], body['spend_this_month']), ('ai_balance_empty', None, None))
        self.authenticate('ai_balance_admin', 'ai_balance_admin_pass_123')
        body = self.api('GET', '/api/v1/ai/tools').json()['limits']['policy']
        self.assertEqual((body['blocked'], body['balance_left'], body['spend_this_month']), ('ai_balance_empty', 0, 100))

    def test_the_policy_of_a_tenant_without_a_balance_is_unlimited(self):
        self._set_features({GRANTED: None})
        policy = self.env['liwan.ai.tool.registry'].with_user(self.manager)._liwan_ai_policy()
        keys = ('balance_granted', 'balance_left', 'allowance', 'allowance_left', 'allowance_resets_at', 'spend_ceiling', 'blocked')
        self.assertEqual({key: policy[key] for key in keys}, dict.fromkeys(keys))
        self.assertEqual(policy['spend_this_month'], 0)

    def test_a_ceiling_is_reported_only_while_a_balance_exists(self):
        # The ceiling caps what the balance pays: a tenant without one (customer-hosted, or nothing granted yet) has none.
        self.env['liwan.ai.settings']._liwan_current().monthly_spend_ceiling = 700
        self._set_features({GRANTED: None})
        policy = self.env['liwan.ai.tool.registry'].with_user(self.manager)._liwan_ai_policy()
        self.assertIsNone(policy['spend_ceiling'])
        self._set_features({GRANTED: 10_000})
        policy = self.env['liwan.ai.tool.registry'].with_user(self.manager)._liwan_ai_policy()
        self.assertEqual(policy['spend_ceiling'], 700)

    def test_an_allowance_of_zero_has_no_reset_time(self):
        self.assertIsNone(self.env['liwan.ai.tool.registry']._liwan_ai_policy()['allowance_resets_at'])

    # -- the ceiling setting -------------------------------------------------------------------------------------------------

    def test_only_a_settings_manager_changes_the_ceiling(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        revision = self.env['liwan.ai.settings']._liwan_current().revision
        denied = self.api('PATCH', '/api/v1/ai/settings', {'monthly_spend_ceiling': 500, 'revision': revision})
        self.assertEqual(denied.status_code, 403)
        self.authenticate('ai_balance_admin', 'ai_balance_admin_pass_123')
        changed = self.api('PATCH', '/api/v1/ai/settings', {'monthly_spend_ceiling': 500, 'revision': revision})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()['monthly_spend_ceiling'], 500)
        self.assertEqual(self.api('GET', '/api/v1/ai/settings').json()['monthly_spend_ceiling'], 500)

    def test_the_ceiling_is_validated(self):
        self.authenticate('ai_balance_admin', 'ai_balance_admin_pass_123')
        revision = self.env['liwan.ai.settings']._liwan_current().revision
        for value in (-1, 1.5, True, '10', None, 2_147_483_648):
            with self.subTest(value=value):
                response = self.api('PATCH', '/api/v1/ai/settings', {'monthly_spend_ceiling': value, 'revision': revision})
                self.assertEqual((response.status_code, response.json()['field']), (422, 'monthly_spend_ceiling'))
        accepted = self.api('PATCH', '/api/v1/ai/settings', {'monthly_spend_ceiling': 2_147_483_647, 'revision': revision})
        self.assertEqual(accepted.status_code, 200)

    # -- trial end, deployment mode, running total, foreign keys --------------------------------------------------------------

    def test_a_trial_that_ends_mid_month_leaves_the_monthly_allowance_whole(self):
        month_start = self.Balance._liwan_ai_window(fields.Datetime.now())[1]
        self._set_trial(month_start - timedelta(days=3), month_start + timedelta(days=2))
        self._set_features({TRIAL: 100, MONTHLY: 50})
        self._raw(100, 0, month_start + timedelta(days=1))  # covered by the trial allowance
        after = month_start + timedelta(days=3)
        self.assertEqual(self.Balance._liwan_ai_window(after)[:2], (MONTHLY, month_start + timedelta(days=2)))
        self.assertEqual(self._charge_paid_at(30, after), 0)
        self.assertEqual(self._charge_paid_at(80, after), 30)
        self._raw(40, 0, month_start + timedelta(days=2, hours=1))  # a monthly-allowance row after the trial counts
        self.assertEqual(self._charge_paid_at(30, after), 20)

    def test_a_customer_hosted_installation_has_no_balance(self):
        self._non_saas()
        self._set_features({GRANTED: 0, MONTHLY: 0})
        self.assertIsNone(self.Balance._liwan_ai_granted())
        self.assertEqual(self._record(self._item(15)), [0])
        self.assertEqual(self.profile.ai_paid_total, 0)
        self.assertEqual(self._send().status_code, 200)
        self.assertEqual(self.Balance._liwan_ai_policy_fields()['blocked'], None)

    def test_a_saas_tenant_with_nothing_bought_is_blocked(self):
        self._set_features({GRANTED: 0})
        refused = self._send()
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'ai_balance_empty'))

    def test_a_local_policy_may_omit_the_three_keys_and_a_delivered_one_may_not(self):
        features = {key: value for key, value in self.profile.features.items() if key not in AI_KEYS}
        writer = self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True})
        with self.assertRaisesRegex(ValidationError, 'missing required keys: .*ai.balance.granted'):
            writer.write({'features': features})
        self._non_saas()
        writer = self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True})
        writer.write({'features': features})
        self.assertNotIn(AI_KEYS[0], self.profile.features)

    def test_the_running_total_equals_the_sum_of_the_rows(self):
        self._set_features({MONTHLY: 20})
        self._record(self._item(15), self._item(15))
        self._record(self._item(7), self._item(None, cost=None))
        self._record(self._item(3), self._item(0), self._item(None, billing='setup', cost=9))
        self.env.cr.execute('SELECT COALESCE(SUM(charge_paid), 0) FROM liwan_ai_usage')
        rows_sum = self.env.cr.fetchone()[0]
        self.profile.invalidate_recordset()
        self.assertEqual((self.profile.ai_paid_total, self.Balance._liwan_ai_paid_total()), (rows_sum, rows_sum))
        self.assertGreater(rows_sum, 0)
        self.assertEqual(self.Balance._liwan_ai_state()['balance_left'], 1_000_000 - rows_sum)

    def test_a_profile_cannot_start_with_a_spent_total(self):
        with self.assertRaisesRegex(ValidationError, 'starts at zero'):
            self.env['liwan.tenant.profile'].sudo().create({'ai_paid_total': 5})

    def test_the_migration_backfills_the_allowance_window(self):
        path = Path(__file__).parents[1] / 'migrations' / '19.0.1.15.0' / 'post-balance.py'
        spec = importlib.util.spec_from_file_location('post_balance', path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        called_at = fields.Datetime.now()
        self._raw(30, 12, called_at, add_to_total=False)
        self._raw(30, 0, called_at, billing='tenant_key', add_to_total=False)
        self.env.cr.execute('UPDATE liwan_ai_usage SET allowance_window_start = NULL')
        migration.migrate(self.env.cr, '19.0.1.14.0')
        self.env.cr.execute('SELECT billing, allowance_window_start FROM liwan_ai_usage ORDER BY id')
        # A charged platform row settles against the Riyadh month the migration stored; an own-key row records no window.
        self.assertEqual(self.env.cr.fetchall(), [('platform', self.Balance._liwan_ai_window(called_at)[1]), ('tenant_key', None)])

    def test_the_running_total_outgrows_a_32_bit_integer(self):
        self.profile.sudo()._liwan_add_ai_paid(3_000_000_000)
        self.profile.invalidate_recordset()
        self.assertEqual(self.profile.ai_paid_total, 3_000_000_000)

    def test_the_migration_sets_the_total_to_the_sum_of_the_rows(self):
        path = Path(__file__).parents[1] / 'migrations' / '19.0.1.15.0' / 'pre-balance.py'
        spec = importlib.util.spec_from_file_location('pre_balance', path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        self._raw(30, 12, fields.Datetime.now(), add_to_total=False)
        self._raw(30, 8, fields.Datetime.now(), add_to_total=False)
        self.env.cr.execute('UPDATE liwan_tenant_profile SET ai_paid_total = 777 WHERE id = %s', [self.profile.id])
        migration.migrate(self.env.cr, '19.0.1.14.0')
        self.env.cr.execute('SELECT COALESCE(SUM(charge_paid), 0) FROM liwan_ai_usage')
        expected = self.env.cr.fetchone()[0]
        self.profile.invalidate_recordset()
        self.assertEqual((self.profile.ai_paid_total, expected), (20, 20))

    def test_a_user_or_company_with_usage_or_audit_rows_cannot_be_deleted(self):
        user = new_test_user(self.env, login='ai_balance_leaver', groups='liwan_core.group_employee')
        company = self.env['res.company'].create({'name': 'AI balance branch'})
        self._raw(5, 0, fields.Datetime.now(), user=user)
        self._raw(5, 0, fields.Datetime.now(), company=company)
        self.env.cr.execute(
            "INSERT INTO liwan_ai_audit (company_id, user_id, conversation_id, kind, result) VALUES (%s, %s, 'r_gone', 'message', 'ok')",
            [self.env.company.id, user.id],
        )
        for record in (user, company):
            with self.subTest(record=record), self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.env.cr.savepoint():
                record.unlink()
        self.env.cr.execute('DELETE FROM liwan_ai_usage WHERE user_id = %s', [user.id])
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.env.cr.savepoint():
            user.unlink()  # the audit row alone also refuses it

    # -- the running total is the deduction's alone ---------------------------------------------------------------------------

    def test_nothing_but_the_deduction_writes_the_running_total(self):
        admin = new_test_user(self.env, login='ai_balance_sysadmin', groups='base.group_system')
        for user in (admin, self.recorder, self.manager, self.employee):
            with self.subTest(user=user.login), self.assertRaises(AccessError):
                self.profile.with_user(user).write({'ai_paid_total': 5})
        # An elevated environment alone is not enough, nor the operator's own context.
        with self.assertRaises(AccessError):
            self.profile.sudo().write({'ai_paid_total': 5})
        with self.assertRaises(AccessError):
            self.profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'ai_paid_total': 5})
        self.profile.invalidate_recordset()
        self.assertEqual(self.profile.ai_paid_total, 0)

    def test_the_settings_route_cannot_reach_the_running_total(self):
        self.authenticate('ai_balance_admin', 'ai_balance_admin_pass_123')
        revision = self.env['liwan.ai.settings']._liwan_current().revision
        response = self.api('PATCH', '/api/v1/ai/settings', {'ai_paid_total': 5, 'revision': revision})
        self.assertEqual((response.status_code, response.json()['code']), (422, 'unknown_field'))
        self.assertNotIn('ai_paid_total', [item['key'] for item in self.env['liwan.ai.setting.registry']._liwan_ai_setting_map().values()])

    def test_the_running_total_only_increases_through_the_deduction(self):
        writer = self.profile.sudo()
        writer._liwan_add_ai_paid(40)
        for amount in (0, -3, True, 2.5):
            with self.subTest(amount=amount), self.assertRaises(ValidationError):
                writer._liwan_add_ai_paid(amount)
        with self.assertRaises(ValidationError):
            writer.with_context(**{'liwan_platform.ai_paid_total': True}).write({'ai_paid_total': 10})
        writer.invalidate_recordset()
        self.assertEqual(writer.ai_paid_total, 40)

    # -- the billing timezone is the platform's -------------------------------------------------------------------------------

    def test_the_company_timezone_changes_no_window(self):
        partner = self.profile.root_company_id.partner_id.sudo()
        now = fields.Datetime.now()
        before = (self.Balance._liwan_ai_window(now), self.env['liwan.ai.audit']._liwan_ai_month_start())
        for zone in ('Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/London'):
            partner.tz = zone
            self.env.invalidate_all()
            self.assertEqual((self.Balance._liwan_ai_window(now), self.env['liwan.ai.audit']._liwan_ai_month_start()), before, zone)

    def test_free_left_follows_the_window_recorded_on_a_row_not_its_date(self):
        self._set_features({MONTHLY: 100})
        month_start = self.Balance._liwan_ai_window(fields.Datetime.now())[1]
        # Called just after the boundary but settled against the previous window, and the reverse.
        previous = self.Balance._liwan_ai_window(month_start - timedelta(seconds=1))[1]
        self._raw(100, 0, month_start + timedelta(seconds=1), window_start=previous)
        self._raw(60, 0, month_start - timedelta(seconds=1), window_start=month_start)
        self.assertEqual(self._charge_paid_at(30, month_start + timedelta(hours=1)), 0)
        self.assertEqual(self._charge_paid_at(50, month_start + timedelta(hours=1)), 10)
        self.assertEqual(self._charge_paid_at(10, month_start - timedelta(hours=1)), 10)

    def test_a_charged_row_records_its_window_and_an_uncharged_one_does_not(self):
        self._set_features({MONTHLY: 100})
        charged, plain = self.Usage.with_user(self.recorder)._liwan_ai_record_for(
            [self._item(15), self._item(None, cost=None)], self.employee.id, self.employee.company_id.id,
        ).sudo()
        self.assertEqual(charged.allowance_window_start, self.Balance._liwan_ai_window(fields.Datetime.now())[1])
        self.assertFalse(plain.allowance_window_start)
        with self.assertRaises(ValidationError) as caught:
            self._record(self._item(15, allowance_window_start='2026-01-01T00:00:00Z'))
        self.assertEqual(caught.exception.liwan_field, 'allowance_window_start')

    # -- the reserve for runs in flight ---------------------------------------------------------------------------------------

    def _balance_for(self, runs):
        self._set_features({GRANTED: runs * RUN_RESERVE, MONTHLY: 0})

    def test_runs_in_flight_reserve_their_worst_case_cost(self):
        self._balance_for(2)
        self.assertEqual(self._send(conversation_id='r_one').status_code, 200)
        self.assertEqual(self._send(conversation_id='r_two').status_code, 200)
        refused = self._send(conversation_id='r_three')
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'ai_balance_empty'))
        self.assertEqual(self.Balance._liwan_ai_policy_fields()['blocked'], 'ai_balance_empty')

    def test_a_new_message_is_accepted_once_the_runs_in_flight_have_timed_out(self):
        self._balance_for(2)
        self._send(conversation_id='r_one')
        self._send(conversation_id='r_two')
        self.assertEqual(self._send(conversation_id='r_three').status_code, 403)
        self.env.cr.execute("UPDATE liwan_ai_audit SET create_date = create_date - interval '5 minutes'")
        self.assertEqual(self._send(conversation_id='r_four').status_code, 200)

    def test_a_balance_below_one_reserve_refuses_even_when_positive(self):
        self._set_features({GRANTED: RUN_RESERVE - 1, MONTHLY: 0})
        self.assertEqual(self._send().json()['code'], 'ai_balance_empty')

    def test_a_tenant_with_ample_balance_is_not_limited_by_the_reserve(self):
        self._balance_for(1000)
        for index in range(6):
            self.assertEqual(self._send(conversation_id=f'r_ample_{index}').status_code, 200, index)

    def test_a_tenant_without_a_balance_reserves_nothing(self):
        self._set_features({GRANTED: None})
        for index in range(4):
            self.assertEqual(self._send(conversation_id=f'r_free_{index}').status_code, 200)
