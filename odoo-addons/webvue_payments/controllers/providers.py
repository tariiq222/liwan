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
UPDATE_FIELDS = {'state', 'credentials'}
MAX_CREDENTIAL_LENGTH = 512


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
    for field, value in credentials.items():
        if field not in allowed:
            raise ApiError(422, 'unknown_field', f"credential {field!r} is not accepted", field=f'credentials.{field}')
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_CREDENTIAL_LENGTH:
            raise ApiError(422, 'invalid', "a credential is a non-empty text", field=f'credentials.{field}')
    return {field: value.strip() for field, value in credentials.items()}


def _require_configured(provider):
    missing = [field for field, present in provider._webvue_payments_credentials_present().items() if not present]
    if missing:
        raise ApiError(
            422, 'provider_not_configured', "enter every credential first", field=f'credentials.{missing[0]}',
        )


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
        unknown = set(payload) - UPDATE_FIELDS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        provider = _offered_provider(provider_id)
        if 'credentials' in payload:
            provider.write(_parse_credentials(provider, payload['credentials']))
        if 'state' in payload:
            state = payload['state']
            if state not in STATES:
                raise ApiError(422, 'invalid', f"state must be one of {', '.join(STATES)}", field='state')
            if state != 'disabled':
                _require_configured(provider)
                provider._webvue_payments_apply_defaults()
            provider._webvue_payments_set_state(state)
        return dump_provider(provider)

    @http.route('/api/v1/payments/providers/<int:provider_id>/sync', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(PROVIDERS_MANAGE)
    def sync_provider(self, provider_id, **_):
        provider = _offered_provider(provider_id)
        _require_configured(provider)
        provider._webvue_payments_apply_defaults()
        try:
            status = provider._webvue_payments_sync()
        except ValidationError as error:
            # The gateway's own text can quote request details; the tenant gets a stable code and
            # the operator log keeps the reason.
            _logger.warning("Payment provider %s (id %s) rejected the sync: %s", provider.code, provider.id, error)
            raise ApiError(422, 'provider_rejected', "the gateway rejected the stored credentials") from error
        return {'provider': dump_provider(provider), 'status': status}
