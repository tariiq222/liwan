# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_integrations_sa.controllers.helpers import (
    EXTERNAL_ID_MAX,
    check_fields,
    find_connection,
    offered_providers,
    parse_optional_text,
    parse_secrets,
    parse_text,
    public_base,
    reject,
)
from odoo.addons.liwan_integrations_sa.models.constants import (
    AUTH_EXTERNAL,
    AUTH_KEYS,
    FEATURE,
    MANAGE,
    READ,
)
from odoo.addons.liwan_integrations_sa.serializers.connection import (
    dump_connection,
    dump_external,
    dump_provider,
)

CREATE_FIELDS = {'provider', 'external_id', 'label', 'app_id', 'secrets'}
PATCH_FIELDS = {'label', 'app_id', 'secrets', 'state'}
PATCH_STATES = ('disabled', 'pending')


def _attribute(provider, key, payload):
    """The cleaned ``label`` or ``app_id`` of a body; ``app_id`` only for a provider that declares it."""
    if key == 'app_id' and key not in provider['attributes']:
        reject('this provider has no app_id', key)
    return parse_optional_text(payload, key)


def _dump(connection):
    return dump_connection(connection, public_base)


def _require_connected(connection):
    """Roll the request back when the provider refused the credentials: nothing half-connected is kept."""
    if connection.state != 'connected':
        code = 'integration_rejected'
        message = request.env._('The provider refused the connection: %(reason)s', reason=connection.status_message)
        raise LiwanAccessRule(code, message, details={'reason': code})


class IntegrationConnectionController(http.Controller):

    @http.route('/api/v1/integrations/providers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(READ)
    def list_providers(self, **_):
        items = [dump_provider(definition, uses) for definition, uses in offered_providers().values()]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/integrations/connections', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(READ)
    def list_connections(self, **_):
        """The stored connections of the current company, then the derived status of each external provider."""
        offered = offered_providers()
        registry = request.env['liwan.integration.registry']
        stored = request.env['liwan.integration.connection'].search(
            [('company_id', '=', request.env.company.id), ('provider', 'in', list(offered))],
        )
        items = [_dump(connection) for connection in stored]
        items += [
            dump_external(
                definition, registry._liwan_external_status(code, request.env.company), uses,
            )
            for code, (definition, uses) in offered.items() if definition['auth'] == AUTH_EXTERNAL
        ]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/integrations/connections/<int:connection_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(READ)
    def read_connection(self, connection_id, **_):
        return _dump(find_connection(connection_id))

    @http.route('/api/v1/integrations/connections', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def create_connection(self, **payload):
        """Connect a keys provider: store the typed secrets, create the generated ones and probe the provider."""
        check_fields(payload, CREATE_FIELDS, required=('provider', 'external_id', 'secrets'))
        offered = offered_providers().get(payload['provider'])
        if not offered or offered[0]['auth'] != AUTH_KEYS:
            reject('provider must be an available provider that is connected with keys', 'provider')
        provider = offered[0]
        secrets = parse_secrets(payload, provider)
        if set(secrets) != set(provider['secrets']):
            reject(f'secrets must give {", ".join(provider["secrets"])}', 'secrets')
        values = {'provider': provider['code'], 'external_id': parse_text(payload, 'external_id', EXTERNAL_ID_MAX)}
        for key in ('label', 'app_id'):
            if key in payload:
                values[key] = _attribute(provider, key, payload)
        Connection = request.env['liwan.integration.connection']
        if Connection.search_count([('company_id', '=', request.env.company.id), ('provider', '=', values['provider']),
                                    ('external_id', '=', values['external_id'])]):
            reject('this account is already connected', 'external_id')
        connection = Connection.create(values)
        connection._liwan_store_secrets(secrets)
        connection._liwan_generate_secrets()
        connection._liwan_test()
        _require_connected(connection)
        return request.make_json_response(_dump(connection), status=201)

    @http.route('/api/v1/integrations/connections/<int:connection_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def patch_connection(self, connection_id, **payload):
        check_fields(payload, PATCH_FIELDS)
        connection = find_connection(connection_id)
        provider = connection._liwan_definition()
        state = payload.get('state')
        if 'state' in payload and state not in PATCH_STATES:
            reject('state can only be set to disabled or pending; a passing test connects the account', 'state')
        values = {key: _attribute(provider, key, payload) for key in ('label', 'app_id') if key in payload}
        if 'secrets' in payload:
            if provider['auth'] != AUTH_KEYS:
                reject('this provider is connected by authorization, not by keys', 'secrets')
            connection._liwan_store_secrets(parse_secrets(payload, provider))
        connection.write(values)
        if state == 'disabled':
            connection.write({'state': 'disabled'})
        elif state == 'pending' or 'secrets' in payload:
            if state == 'pending':
                connection.write({'state': 'pending'})
            connection._liwan_test()
            _require_connected(connection)
        return _dump(connection)

    @http.route('/api/v1/integrations/connections/<int:connection_id>/test', type='json2', auth='user',
                methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def test_connection(self, connection_id, **_):
        connection = find_connection(connection_id)
        connection._liwan_test()
        return _dump(connection)

    @http.route('/api/v1/integrations/connections/<int:connection_id>/secrets/<string:name>/rotate', type='json2',
                auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def rotate_secret(self, connection_id, name, **_):
        """A fresh generated secret; the only answer that carries a secret value, and only once."""
        connection = find_connection(connection_id)
        if name not in connection._liwan_definition()['generated_secrets']:
            reject('only a secret the service generates can be rotated', 'name')
        return {'name': name, 'value': connection._liwan_rotate_secret(name)}

    @http.route('/api/v1/integrations/connections/<int:connection_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def delete_connection(self, connection_id, **_):
        connection = find_connection(connection_id)
        uses = list(request.env['liwan.integration.registry']._liwan_connection_uses(connection))
        if uses:
            raise ApiError(
                409, 'in_use', f'the connection is used by {", ".join(uses)}; remove that use first', details={'uses': uses},
            )
        connection.unlink()
        return request.make_json_response('', status=204)
