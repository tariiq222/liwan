# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import PAYMOB_CREDENTIALS, WebVuePaymentsCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_payments.controllers.providers import PaymentProviderController

PROVIDER_KEYS = {
    'id', 'code', 'name', 'state', 'credentials', 'configured', 'methods', 'account_country', 'account_country_options',
}
LIST = '/api/v1/payments/providers'
CONTROLLER_LOGGER = 'odoo.addons.webvue_payments.controllers.providers'
PROVIDER_LOGGER = 'odoo.addons.payment.models.payment_provider'
PAYMOB_TOKEN = 'paymob_bearer_token_never_logged'


class FakeResponse:
    """The parts of ``requests.Response`` the stock payment request helpers read."""

    ok = True
    status_code = 200
    reason = 'OK'

    def __init__(self, url, body):
        self.url = url
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        return None


def paymob_gateway(method, url, **kwargs):
    """A Paymob account with one online card gateway."""
    if url.endswith('/api/auth/tokens'):
        return FakeResponse(url, {'token': PAYMOB_TOKEN})
    if method == 'GET':
        return FakeResponse(url, {'results': [{
            'id': 11, 'gateway_type': 'VPC', 'integration_type': 'online', 'is_auth': False,
            'created_at': '2026-10-28T10:00:00', 'integration_name': 'card',
        }]})
    return FakeResponse(url, {})


@tagged('post_install', '-at_install', 'webvue')
class TestPaymentProviders(WebVuePaymentsCase):

    def provider_url(self, provider=None, suffix=''):
        return f'{LIST}/{(provider or self.paymob).id}{suffix}'

    def patch_provider(self, payload, provider=None):
        return self.api('PATCH', self.provider_url(provider), json=payload)

    def stub_sync(self, result='success', error=None):
        """Replace the stock Paymob sync (network calls) for one test."""
        def sync(provider):
            if error:
                raise error
            return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {'type': result}}
        self.patch(type(self.env['payment.provider']), 'action_sync_paymob_payment_methods', sync)

    def fresh(self):
        """The Paymob provider as the HTTP requests left it (the test cache does not see their writes)."""
        self.env.invalidate_all()
        return self.paymob

    def assert_no_secret_in(self, text):
        for value in (*PAYMOB_CREDENTIALS.values(), PAYMOB_TOKEN):
            self.assertNotIn(value, text)

    def test_the_list_shows_the_current_company_paymob_with_the_whitelisted_shape(self):
        self.login_admin()
        response = self.api('GET', LIST)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['total'], len(body['items']))
        item = next(row for row in body['items'] if row['code'] == 'paymob')
        self.assertEqual(set(item), PROVIDER_KEYS)
        self.assertEqual((item['id'], item['state'], item['configured']), (self.paymob.id, 'disabled', False))
        self.assertEqual([entry['field'] for entry in item['credentials']], list(PAYMOB_CREDENTIALS))
        self.assertEqual(item['account_country_options'], ['AE', 'EG', 'OM', 'SA'])

    def test_other_companies_and_providers_webvue_does_not_offer_are_the_same_404(self):
        other = self.env['res.company'].create({'name': 'Payments company B'})
        foreign = self.paymob.copy({'company_id': other.id})
        unoffered = self.env['payment.provider'].create({'name': 'Not offered', 'code': 'none'})
        self.login_admin()
        ids = {row['id'] for row in self.api('GET', LIST).json()['items']}
        self.assertFalse(ids & {foreign.id, unoffered.id})
        for provider in (foreign, unoffered):
            for method, suffix, payload in (('PATCH', '', {'state': 'disabled'}), ('POST', '/sync', None)):
                with self.subTest(provider=provider.name, method=method):
                    response = self.api(method, self.provider_url(provider, suffix), json=payload)
                    self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))

    def test_credentials_are_write_only(self):
        self.login_admin()
        response = self.patch_provider({'credentials': PAYMOB_CREDENTIALS})
        self.assertEqual(response.status_code, 200)
        self.assert_no_secret_in(response.text)
        self.assertTrue(response.json()['configured'])
        self.assertTrue(all(entry['present'] for entry in response.json()['credentials']))
        self.assertEqual(self.fresh().sudo().paymob_secret_key, PAYMOB_CREDENTIALS['paymob_secret_key'])
        self.assert_no_secret_in(self.api('GET', LIST).text)

    def test_an_employee_cannot_read_the_secret_key(self):
        self.paymob.sudo().write({'paymob_secret_key': PAYMOB_CREDENTIALS['paymob_secret_key']})
        with self.assertRaises(AccessError):
            self.paymob.with_user(self.employee).read(['paymob_secret_key'])

    def test_switching_on_needs_every_credential_then_checks_the_gateway(self):
        self.stub_sync()
        self.login_admin()
        self.patch_provider({'credentials': {'paymob_public_key': PAYMOB_CREDENTIALS['paymob_public_key']}})
        refused = self.patch_provider({'state': 'test'})
        self.assertEqual(
            (refused.status_code, refused.json()['code'], refused.json()['field']),
            (422, 'provider_not_configured', 'credentials.paymob_secret_key'),
        )
        self.assertEqual(self.fresh().state, 'disabled')
        accepted = self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'state': 'test'})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual((accepted.json()['state'], accepted.json()['account_country']), ('test', 'SA'))
        provider = self.fresh()
        self.assertEqual(provider.available_currency_ids.mapped('name'), ['SAR'])
        self.assertTrue(provider.is_published)
        self.assertIn('card', accepted.json()['methods'])
        live = self.patch_provider({'state': 'enabled'})
        self.assertEqual((live.json()['state'], self.fresh().is_published), ('enabled', True))
        off = self.patch_provider({'state': 'disabled'})
        self.assertEqual((off.json()['state'], self.fresh().is_published), ('disabled', False))

    def test_a_failed_gateway_check_keeps_nothing_of_the_update(self):
        self.login_admin()
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS})
        for stub, code in (
            ({'error': ValidationError('Paymob: invalid key egy_sk_test_never_returned')}, 'provider_sync_failed'),
            ({'error': KeyError('token')}, 'provider_sync_failed'),
            ({'result': 'warning'}, 'methods_missing'),
        ):
            with self.subTest(code=code, stub=stub), mute_logger(CONTROLLER_LOGGER):
                self.stub_sync(**stub)
                response = self.patch_provider({'state': 'test', 'account_country': 'AE'})
                self.assertEqual((response.status_code, response.json()['code']), (422, code))
                self.assert_no_secret_in(response.text)
                provider = self.fresh()
                self.assertEqual((provider.state, provider.paymob_account_country_id.code), ('disabled', False))

    def test_the_account_country_is_a_tenant_choice_with_saudi_arabia_by_default(self):
        self.stub_sync()
        self.login_admin()
        response = self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'account_country': 'AE', 'state': 'test'})
        self.assertEqual((response.status_code, response.json()['account_country']), (200, 'AE'))
        self.assertEqual(self.fresh().available_currency_ids.mapped('name'), ['AED'])
        refused = self.patch_provider({'account_country': 'US'})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'account_country'))

    def test_the_update_refuses_unknown_and_invalid_input(self):
        self.login_admin()
        cases = (
            ({}, 'invalid', None),
            ({'name': 'Renamed'}, 'unknown_field', 'name'),
            ({'state': 'paused'}, 'invalid', 'state'),
            ({'credentials': {}}, 'invalid', 'credentials'),
            ({'credentials': {'paymob_password': 'x'}}, 'unknown_field', 'credentials.paymob_password'),
            ({'credentials': {'paymob_api_key': '   '}}, 'invalid', 'credentials.paymob_api_key'),
            ({'credentials': {'paymob_api_key': ' ' + 'k' * 513 + ' '}}, 'invalid', 'credentials.paymob_api_key'),
        )
        for payload, code, field in cases:
            with self.subTest(payload=payload):
                response = self.patch_provider(payload)
                self.assertEqual((response.status_code, response.json()['code']), (422, code))
                self.assertEqual(response.json().get('field'), field)
        self.assertFalse(self.fresh()._webvue_payments_configured())

    def test_a_padded_credential_of_the_maximum_length_is_trimmed_and_accepted(self):
        self.login_admin()
        response = self.patch_provider({'credentials': {'paymob_api_key': ' ' + 'k' * 512 + ' '}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.fresh().paymob_api_key, 'k' * 512)

    def test_sync_needs_a_switched_on_and_configured_gateway(self):
        self.login_admin()
        off = self.api('POST', self.provider_url(suffix='/sync'))
        self.assertEqual((off.status_code, off.json()['code']), (422, 'provider_disabled'))
        self.stub_sync()
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'state': 'test'})
        for result, status in (('success', 'synced'), ('warning', 'methods_missing')):
            with self.subTest(status=status):
                self.stub_sync(result=result)
                response = self.api('POST', self.provider_url(suffix='/sync'))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(set(response.json()), {'provider', 'status'})
                self.assertEqual(response.json()['status'], status)
                self.assertEqual(set(response.json()['provider']), PROVIDER_KEYS)
                self.assert_no_secret_in(response.text)

    def test_a_gateway_failure_answers_a_stable_code_and_logs_no_gateway_text(self):
        self.stub_sync()
        self.login_admin()
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'state': 'test'})
        self.stub_sync(error=ValidationError('Paymob: invalid key egy_sk_test_never_returned'))
        with self.assertLogs(CONTROLLER_LOGGER, level='WARNING') as logs:
            response = self.api('POST', self.provider_url(suffix='/sync'))
        self.assertEqual((response.status_code, response.json()['code']), (422, 'provider_sync_failed'))
        self.assert_no_secret_in(response.text)
        self.assert_no_secret_in('\n'.join(logs.output))

    def test_the_real_stock_sync_runs_as_the_manager_and_logs_no_key_or_token(self):
        provider = self.paymob.with_user(self.admin)
        provider.write(PAYMOB_CREDENTIALS)
        provider._webvue_payments_ensure_account_country()
        provider._webvue_payments_set_state('test')
        target = 'odoo.addons.payment.models.payment_provider.requests.request'
        with patch(target, side_effect=paymob_gateway) as request, self.assertLogs(PROVIDER_LOGGER, level='INFO') as logs:
            self.assertEqual(provider._webvue_payments_sync(), 'synced')
        self.assert_no_secret_in('\n'.join(logs.output))
        renamed = [call.kwargs.get('json') for call in request.call_args_list if call.args[0] == 'PUT']
        self.assertEqual(renamed, [{'integration_name': 'cardtest'}])

    def test_switching_on_runs_the_stock_side_effects(self):
        cron = self.env.ref('payment.cron_post_process_payment_tx')
        self.assertFalse(cron.active)
        card = self.env.ref('payment.payment_method_card')
        self.stub_sync()
        self.login_admin()
        self.patch_provider({'credentials': PAYMOB_CREDENTIALS, 'state': 'test'})
        self.env.invalidate_all()
        self.assertTrue(cron.active, 'switching a gateway on activates the payment post-processing cron')
        self.assertTrue(card.active, 'switching a gateway on activates its default payment methods')
        token = self.env['payment.token'].create({
            'provider_id': self.paymob.id, 'payment_method_id': card.id,
            'partner_id': self.employee.partner_id.id, 'provider_ref': 'webvue-test', 'payment_details': '4242',
        })
        self.patch_provider({'state': 'enabled'})
        self.env.invalidate_all()
        self.assertFalse(token.active, 'a test/live switch archives the saved tokens of the provider')

    def test_the_state_switch_checks_the_capability_and_the_company_itself(self):
        with self.assertRaises(AccessError):
            self.paymob.with_user(self.employee)._webvue_payments_set_state('test')
        other = self.env['res.company'].create({'name': 'Payments company C'})
        foreign = self.paymob.copy({'company_id': other.id})
        with self.assertRaises(AccessError):
            foreign.with_user(self.admin)._webvue_payments_set_state('disabled')

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

    def test_a_closed_feature_refuses_every_route(self):
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.login_admin()
        self.assertEqual(self.api('GET', LIST).status_code, 403)
        self.assertEqual(self.patch_provider({'state': 'disabled'}).status_code, 403)
        self.assertEqual(self.api('POST', self.provider_url(suffix='/sync')).status_code, 403)
