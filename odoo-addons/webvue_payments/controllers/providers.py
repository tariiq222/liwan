# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import http
from odoo.exceptions import MissingError, ValidationError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_payments.models.access_service import PROVIDERS_MANAGE
from odoo.addons.webvue_payments.serializers.provider import dump_provider

_logger = logging.getLogger(__name__)

FEATURE = 'payments.enabled'
STATES = ('disabled', 'test', 'enabled')
UPDATE_FIELDS = {'state', 'credentials', 'account_country'}
MAX_CREDENTIAL_LENGTH = 512
# What the stock sync raises when the gateway is unreachable, refuses the keys (ValidationError)
# or answers a body it cannot read (ValueError for bad JSON, KeyError for a missing key).
SYNC_FAILURES = (ValidationError, ValueError, KeyError)


def _offered_providers():
    """The current company's providers whose code WebVue offers, in registry order."""
    codes = list(request.env['webvue.payments.provider.registry']._webvue_provider_map())
    providers = request.env['payment.provider'].search([
        ('company_id', '=', request.env.company.id), ('code', 'in', codes),
    ])
    return providers.sorted(lambda provider: codes.index(provider.code))


def _offered_provider(provider_id):
    """One offered provider of the current company; anything else is the same 404."""
    provider = get_record('payment.provider', provider_id)
    if provider.company_id != request.env.company or not provider._webvue_payments_definition():
        raise MissingError(request.env._("Record does not exist"))
    return provider


def _parse_credentials(provider, credentials):
    if not isinstance(credentials, dict) or not credentials:
        raise ApiError(422, 'invalid', "credentials must be a non-empty object", field='credentials')
    allowed = provider._webvue_payments_definition()['credential_fields']
    values = {}
    for field, value in credentials.items():
        if field not in allowed:
            raise ApiError(422, 'unknown_field', f"credential {field!r} is not accepted", field=f'credentials.{field}')
        text = value.strip() if isinstance(value, str) else ''
        if not text or len(text) > MAX_CREDENTIAL_LENGTH:
            raise ApiError(422, 'invalid', "a credential is a non-empty text", field=f'credentials.{field}')
        values[field] = text
    return values


def _parse_account_country(provider, code):
    definition = provider._webvue_payments_definition().get('account_country')
    if not definition:
        raise ApiError(422, 'unknown_field', "this gateway has no account country", field='account_country')
    if code not in definition['codes']:
        raise ApiError(
            422, 'invalid', f"account_country must be one of {', '.join(definition['codes'])}", field='account_country',
        )
    return code


def _parse_state(state):
    if state not in STATES:
        raise ApiError(422, 'invalid', f"state must be one of {', '.join(STATES)}", field='state')
    return state


def _require_configured(provider):
    missing = [field for field, present in provider._webvue_payments_credentials_present().items() if not present]
    if missing:
        raise ApiError(
            422, 'provider_not_configured', "enter every credential first", field=f'credentials.{missing[0]}',
        )


def _sync(provider):
    """Run the gateway check; any failure is a stable code, never the gateway's own text."""
    try:
        return provider._webvue_payments_sync()
    except SYNC_FAILURES as error:
        # The gateway's text can quote request details: the log keeps only the provider and the error class.
        _logger.warning(
            "Payment provider %s (id %s) sync failed: %s", provider.code, provider.id, type(error).__name__,
        )
        raise ApiError(422, 'provider_sync_failed', "the gateway could not confirm the account") from error


def _require_synced(provider):
    if _sync(provider) == 'methods_missing':
        raise ApiError(422, 'methods_missing', "the gateway account lacks a payment method this gateway needs")


class PaymentProviderController(http.Controller):

    @http.route('/api/v1/payments/providers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(PROVIDERS_MANAGE)
    def list_providers(self, **_):
        items = [dump_provider(provider) for provider in _offered_providers()]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/payments/providers/<int:provider_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(PROVIDERS_MANAGE)
    def update_provider(self, provider_id, **payload):
        """Enter keys, choose the account country or switch the mode.

        Whenever the gateway is on after the update, the gateway check runs in the same request,
        because the account is prepared for one mode with one set of keys; if the check fails,
        nothing of the update is kept.
        """
        unknown = set(payload) - UPDATE_FIELDS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        provider = _offered_provider(provider_id)
        state = _parse_state(payload['state']) if 'state' in payload else provider.state
        if 'credentials' in payload:
            provider.write(_parse_credentials(provider, payload['credentials']))
        if 'account_country' in payload:
            provider._webvue_payments_set_account_country(_parse_account_country(provider, payload['account_country']))
        if state != 'disabled':
            _require_configured(provider)
            provider._webvue_payments_ensure_account_country()
        if state != provider.state:
            provider._webvue_payments_set_state(state)
        if state != 'disabled':
            _require_synced(provider)
        return dump_provider(provider)

    @http.route('/api/v1/payments/providers/<int:provider_id>/sync', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(PROVIDERS_MANAGE)
    def sync_provider(self, provider_id, **_):
        provider = _offered_provider(provider_id)
        if provider.state == 'disabled':
            raise ApiError(422, 'provider_disabled', "switch the gateway to test or live first", field='state')
        _require_configured(provider)
        status = _sync(provider)
        return {'provider': dump_provider(provider), 'status': status}
