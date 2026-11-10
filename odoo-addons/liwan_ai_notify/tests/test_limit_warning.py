# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone

from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_warn_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None,
}


@tagged('post_install', '-at_install', 'liwan')
class TestAiLimitWarning(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_warn_admin', password='ai_warn_admin_pass_123', name='Huda',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_feature(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def _bell(self, user):
        return self.env['liwan.notify.service'].with_user(user)._liwan_list(50)['items']

    def _raw(self, charge, paid):
        """A ledger row written directly, so its paid part lands on the balance without spending the free allowance."""
        self._raw_calls = getattr(self, '_raw_calls', 0) + 1
        self.env.cr.execute(
            "INSERT INTO liwan_ai_usage (company_id, user_id, conversation_id, call_id, kind, capability, billing, provider, model,"
            " outcome, input_tokens, output_tokens, tokens_reported, cost, cost_reported, charge, charge_reported, charge_paid,"
            " called_at, allowance_window_start) VALUES (%s, %s, 'r_warn_raw', %s, 'plan', 'standard', 'platform', 'acme-ai',"
            " 'acme-1', 'ok', 1, 1, true, %s, true, %s, true, %s, %s, %s)",
            [self.env.company.id, self.employee.id, f'{self._raw_calls:016x}', charge, charge, paid,
             datetime.now(timezone.utc).replace(tzinfo=None),
             self.env['liwan.ai.balance']._liwan_ai_window(datetime.now(timezone.utc).replace(tzinfo=None))[1]],
        )
        if paid:
            self.env.ref('liwan_platform.tenant_profile').sudo()._liwan_add_ai_paid(paid)

    def test_managers_are_told_once_a_month_at_eighty_percent(self):
        self._set_feature('ai.messages.monthly', 5)
        for index in range(3):
            self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': f'r_warn_{index}'})
        self.assertEqual(self._bell(self.manager), [])
        self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': 'r_warn_4'})
        items = self._bell(self.manager)
        self.assertEqual([item['kind'] for item in items], ['ai.limit_warning'])
        self.assertIn('80%', items[0]['title'])
        self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': 'r_warn_5'})
        self.assertEqual(len(self._bell(self.manager)), 1)

    def test_the_free_agents_budget_warns_on_its_own(self):
        self._set_feature('ai.assist.monthly', 5)
        self._set_feature('ai.messages.monthly', 1000)
        Audit = self.env['liwan.ai.audit'].with_user(self.employee)
        for index in range(3):
            Audit.create({**MESSAGE, 'kind': 'help', 'conversation_id': f'r_assist_{index}'})
        self.assertEqual(self._bell(self.manager), [])
        Audit.create({**MESSAGE, 'kind': 'help', 'conversation_id': 'r_assist_4'})
        items = self._bell(self.manager)
        self.assertEqual([item['kind'] for item in items], ['ai.limit_warning'])
        self.assertIn('مساعدَي', items[0]['title'])

    def test_an_ordinary_user_never_sees_the_warning(self):
        self._set_feature('ai.messages.monthly', 1)
        self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(self._bell(self.employee), [])
        self.assertEqual(len(self._bell(self.manager)), 1)

    def _record(self, charge, billing='platform', **values):
        """One usage row as the recorder account writes it (only the recorder carries a cost and a charge)."""
        self._calls = getattr(self, '_calls', 0) + 1
        item = {
            'conversation_id': 'r_warn', 'call_id': f'{self._calls:016x}', 'kind': 'plan', 'capability': 'standard', 'billing': billing,
            'provider': 'acme-ai', 'model': 'acme-1', 'outcome': 'ok', 'input_tokens': 9, 'output_tokens': 3, 'cost': charge,
            'charge': charge, 'called_at': self._now(), **values,
        }
        recorder = self.env.ref('liwan_ai.user_ai_usage')
        self.env['liwan.ai.usage'].with_user(recorder)._liwan_ai_record_for([item], self.employee.id, self.employee.company_id.id)
        self.env['liwan.ai.usage']._liwan_cron_warn_balance()

    def _balance_bells(self):
        return [item['title'] for item in self._bell(self.manager) if item['kind'] == 'ai.limit_warning']

    def test_the_balance_warns_once_below_a_fifth_and_once_it_cannot_pay_a_run(self):
        self._set_feature('ai.balance.granted', 100_000)
        self._record(70_000)
        self.assertEqual(self._balance_bells(), [])
        self._record(15_000)
        self.assertEqual(len(self._balance_bells()), 1)
        self.assertIn('20%', self._balance_bells()[0])
        self._record(1_000)
        self.assertEqual(len(self._balance_bells()), 1)
        # 4,000 units remain: above zero, but below the reserve a new paid run needs, so the assistant has stopped.
        self._record(10_000)
        bells = self._balance_bells()
        self.assertEqual(len(bells), 2)
        self.assertTrue(any('نفد' in title for title in bells))
        self._record(4_000)
        self.assertEqual(len(self._balance_bells()), 2)
        self.assertEqual(self._bell(self.employee), [])

    def test_a_top_up_arms_both_warnings_again(self):
        self._set_feature('ai.balance.granted', 100_000)
        self._record(100_000)
        self.assertEqual(len(self._balance_bells()), 1)
        self._set_feature('ai.balance.granted', 500_000)
        self._record(390_000)
        self.assertEqual(len(self._balance_bells()), 2)
        self._record(10_000)
        self.assertEqual(len(self._balance_bells()), 3)
        self._set_feature('ai.balance.granted', 900_000)
        self._record(350_000)
        self.assertEqual(len(self._balance_bells()), 4)
        self._record(5_000)
        self.assertEqual(len(self._balance_bells()), 4)

    def test_the_empty_warning_waits_until_the_allowance_cannot_pay_a_run(self):
        self._set_feature('ai.balance.granted', 100_000)
        self._set_feature('ai.allowance.monthly', 10_000)
        self._raw(96_000, 96_000)  # from the balance: 4,000 left, the whole allowance still there
        self.env['liwan.ai.usage']._liwan_cron_warn_balance()
        bells = self._balance_bells()
        self.assertEqual(len(bells), 1)
        self.assertIn('20%', bells[0])
        self._raw(10_000, 0)  # uses up the allowance; the balance did not move
        self.env['liwan.ai.usage']._liwan_cron_warn_balance()
        bells = self._balance_bells()
        self.assertEqual(len(bells), 2)
        self.assertTrue(any('نفد' in title for title in bells))

    def test_a_tenant_without_a_balance_and_the_tenant_key_never_warn_about_the_balance(self):
        self._set_feature('ai.balance.granted', None)
        self._record(10_000)
        self._set_feature('ai.balance.granted', 100_000)
        self._record(None, billing='tenant_key', cost=None)
        self.assertEqual(self._balance_bells(), [])

    def test_the_balance_cron_runs_the_method_it_names(self):
        # The scheduler is not triggered here (it would run in its own transaction, outside this test's setup): pin the record
        # instead, so a rename of the method or of the model breaks this test rather than the nightly cron.
        cron = self.env.ref('liwan_ai_notify.ir_cron_ai_balance_warning')
        self.assertEqual(cron.model_id.model, 'liwan.ai.usage')
        self.assertEqual(cron.code.strip(), 'model._liwan_cron_warn_balance()')
        self.assertTrue(callable(getattr(self.env['liwan.ai.usage'], '_liwan_cron_warn_balance', None)))
        self.assertTrue(cron.active)

    def _now(self):
        return datetime.now(timezone.utc).isoformat()
