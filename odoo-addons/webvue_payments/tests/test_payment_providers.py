# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import PAYMOB_CREDENTIALS, WebVuePaymentsCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_payments.controllers.providers import PaymentProviderController

PROVIDER_KEYS = {'id', 'code', 'name', 'state', 'credentials', 'configured', 'methods', 'webhook_url'}
LIST = '/api/v1/payments/providers'


@tagged('post_install', '-at_install', 'webvue')
class TestPaymentProviders(WebVuePaymentsCase):

    def provider_url(self, provider=None, suffix=''):
        return f'{LIST}/{(provider or self.paymob).id}{suffix}'

    def patch_provider(self, payload, provider=None):
        return self.api('PATCH', self.provider_url(provider), json=payload)

    def stub_sync(self, result=None, error=None):
        """Replace the stock Paymob sync (a network call) for one test."""
        def sync(provider):
            if error:
                raise error
            return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {'type': result}}
        self.patch(type(self.env['payment.provider']), 'action_sync_paymob_payment_methods', sync)

    def fresh(self):
        """The Paymob provider as the HTTP requests left it (the test cache does not see their writes)."""
        self.env.invalidate_all()
        return self.paymob

    def assert_no_secret_in(self, response):
        text = json.dumps(response.json())
        for value in PAYMOB_CREDENTIALS.values():
            self.assertNotIn(value, text)

    def test_the_list_shows_the_current_company_paymob_with_the_whitelisted_shape(self):
        self.login_admin()
        response = self.api('GET', LIST)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['total'], len(body['items']))
        item = next(row for row in body['items'] if row['code'] == 'paymob')
        self.assertEqual(set(item), PROVIDER_KEYS)
        self.assertEqual(item['id'], self.paymob.id)
        self.assertEqual(item['state'], 'disabled')
        self.assertFalse(item['configured'])
        self.assertEqual(
            [entry['field'] for entry in item['credentials']], list(PAYMOB_CREDENTIALS),
        )
        self.assertTrue(item['webhook_url'].endswith('/payment/paymob/webhook'))

    def test_the_list_hides_other_companies_and_providers_webvue_does_not_offer(self):
        other = self.env['res.company'].create({'name': 'Payments company B'})
        foreign = self.paymob.copy({'company_id': other.id})
        unoffered = self.env['payment.provider'].create({'name': 'Not offered', 'code': 'none'})
        self.login_admin()
        ids = {row['id'] for row in self.api('GET', LIST).json()['items']}
        self.assertNotIn(foreign.id, ids)
        self.assertNotIn(unoffered.id, ids)
        for provider in (foreign, unoffered):
            response = self.patch_provider({'state': 'disabled'}, provider)
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))

    def test_credentials_are_write_only(self):
        self.login_admin()
        response = self.patch_provider({'credentials': PAYMOB_CREDENTIALS})
        self.assertEqual(response.status_code, 200)
        self.assert_no_secret_in(response)
        self.assertTrue(response.json()['configured'])
        self.assertTrue(all(entry['present'] for entry in response.json()['credentials']))
        self.assertEqual(self.fresh().sudo().paymob_secret_key, PAYMOB_CREDENTIALS['paymob_secret_key'])
        self.assert_no_secret_in(self.api('GET', LIST))

    def test_switching_on_needs_every_credential_then_fixes_the_saudi_account(self):
        self.login_admin()
        partial = {'paymob_public_key': PAYMOB_CREDENTIALS['paymob_public_key']}
        self.patch_provider({'credentials': partial})
        refused = self.patch_provider({'state': 'test'})
        self.assertEqual(
            (refused.status_code, refused.json()['code'], refused.json()['field']),
            (422, 'provider_not_configured', 'credentials.paymob_secret_key'),
        )
        self.assertEqual(self.fresh().state, 'disabled')
        accepted = self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'state': 'test'})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()['state'], 'test')
        provider = self.fresh()
        self.assertEqual(provider.paymob_account_country_id, self.env.ref('base.sa'))
        self.assertEqual(provider.available_currency_ids.mapped('name'), ['SAR'])
        self.assertFalse(provider.is_published)
        live = self.patch_provider({'state': 'enabled'})
        self.assertEqual((live.json()['state'], self.fresh().is_published), ('enabled', True))
        off = self.patch_provider({'state': 'disabled'})
        self.assertEqual((off.json()['state'], self.fresh().is_published), ('disabled', False))

    def test_the_update_refuses_unknown_and_invalid_input(self):
        self.login_admin()
        cases = (
            ({}, 'invalid', None),
            ({'name': 'Renamed'}, 'unknown_field', 'name'),
            ({'state': 'paused'}, 'invalid', 'state'),
            ({'credentials': {}}, 'invalid', 'credentials'),
            ({'credentials': {'paymob_password': 'x'}}, 'unknown_field', 'credentials.paymob_password'),
            ({'credentials': {'paymob_api_key': '   '}}, 'invalid', 'credentials.paymob_api_key'),
        )
        for payload, code, field in cases:
            with self.subTest(payload=payload):
                response = self.patch_provider(payload)
                self.assertEqual((response.status_code, response.json()['code']), (422, code))
                self.assertEqual(response.json().get('field'), field)
        self.assertFalse(self.fresh()._webvue_payments_configured())

    def test_sync_checks_the_keys_and_reports_partial_matches(self):
        self.login_admin()
        refused = self.api('POST', self.provider_url(suffix='/sync'))
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'provider_not_configured'))
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS})
        for notification, status in (('success', 'synced'), ('warning', 'partial')):
            with self.subTest(notification=notification):
                self.stub_sync(result=notification)
                response = self.api('POST', self.provider_url(suffix='/sync'))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(set(response.json()), {'provider', 'status'})
                self.assertEqual(response.json()['status'], status)
                self.assertEqual(set(response.json()['provider']), PROVIDER_KEYS)
                self.assert_no_secret_in(response)
        self.assertEqual(self.fresh().paymob_account_country_id, self.env.ref('base.sa'))

    @mute_logger('odoo.addons.webvue_payments.controllers.providers')
    def test_a_gateway_rejection_answers_a_stable_code_without_the_gateway_text(self):
        self.login_admin()
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS})
        self.stub_sync(error=ValidationError('Paymob: invalid key egy_sk_test_never_returned'))
        response = self.api('POST', self.provider_url(suffix='/sync'))
        self.assertEqual((response.status_code, response.json()['code']), (422, 'provider_rejected'))
        self.assert_no_secret_in(response)

    def test_the_capability_gate_is_declared_and_refuses_an_employee(self):
        for handler in (
            PaymentProviderController.list_providers,
            PaymentProviderController.update_provider,
            PaymentProviderController.sync_provider,
        ):
            self.assertEqual(handler._webvue_capability_keys, ('payments.providers.manage',), handler.__name__)
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method, url in (('GET', LIST), ('PATCH', self.provider_url()), ('POST', self.provider_url(suffix='/sync'))):
            with self.subTest(method=method):
                response = self.api(method, url, json={'state': 'test'} if method == 'PATCH' else None)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.fresh().state, 'disabled')

    def test_a_closed_feature_refuses_the_routes(self):
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.login_admin()
        self.assertEqual(self.api('GET', LIST).status_code, 403)
        self.assertEqual(self.patch_provider({'state': 'disabled'}).status_code, 403)

    def test_switching_on_activates_the_payment_post_processing_cron(self):
        cron = self.env.ref('payment.cron_post_process_payment_tx')
        self.assertFalse(cron.active)
        self.login_admin()
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'state': 'test'})
        self.env.invalidate_all()
        self.assertTrue(cron.active)

    def test_the_state_switch_checks_the_capability_and_the_company_itself(self):
        with self.assertRaises(AccessError):
            self.paymob.with_user(self.employee)._webvue_payments_set_state('test')
        other = self.env['res.company'].create({'name': 'Payments company C'})
        foreign = self.paymob.copy({'company_id': other.id})
        with self.assertRaises(AccessError):
            foreign.with_user(self.admin)._webvue_payments_set_state('disabled')
