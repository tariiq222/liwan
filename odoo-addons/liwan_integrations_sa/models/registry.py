# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

from .constants import AUTH_EXTERNAL, AUTH_KEYS, AUTH_OAUTH, AUTH_TYPES, FEATURE, OWNER
from odoo.addons.liwan_integrations_sa import providers

TUPLE_FIELDS = ('secrets', 'generated_secrets', 'attributes', 'webhook_secrets')
# The provider functions behind each capability a provider may declare: the registry refuses a declared capability
# whose function the provider's module does not define.
CAPABILITY_FUNCTIONS = {
    'messaging.send': 'send_message',
    'messaging.status': 'message_status',
    'senders.list': 'list_numbers',
    'voice.call': 'create_call',
    'voice.status': 'call_status',
    'lookup': 'lookup',
}
# The use a sender of each channel holds its connection for.
SENDER_USES = {'sms': 'messaging', 'whatsapp': 'messaging', 'voice': 'voice'}


def _is_text(value):
    return isinstance(value, str) and bool(value)


class LiwanIntegrationRegistry(models.AbstractModel):
    """Providers and the uses applications make of them, composed through ``super()`` like ``liwan.notify.registry``.

    The service knows no application. A provider is defined once (its auth type, secret names and attributes);
    an application registers a use of a provider and asks the service for access to the connection behind it.
    """
    _name = 'liwan.integration.registry'
    _description = 'LiwanOS integration provider and use registry'
    _liwan_scope = 'global'

    @api.model
    def _liwan_provider_definitions(self):
        """Pure descriptors of the providers; an application or bridge adds its own through ``super()``."""
        return (
            {
                'code': 'meta', 'owner': OWNER, 'auth': AUTH_KEYS,
                'secrets': ('access_token', 'app_secret'), 'generated_secrets': ('verify_token',),
                'attributes': ('app_id',), 'webhook_secrets': ('app_secret', 'verify_token'), 'settings_path': None,
                'exclusive': False,
                'external_id_pattern': r'\d{5,32}',
            },
            {
                'code': 'tiktok', 'owner': OWNER, 'auth': AUTH_OAUTH,
                'secrets': (), 'generated_secrets': (), 'attributes': (), 'webhook_secrets': (), 'settings_path': None,
                # The webhook is routed by the account id alone, so one database holds an account once.
                'exclusive': True,
                'external_id_pattern': r'[A-Za-z0-9_-]{1,128}',
            },
            {
                # The auth token is both the API credential and the key Twilio signs every callback with.
                'code': 'twilio', 'owner': OWNER, 'auth': AUTH_KEYS,
                'secrets': ('auth_token',), 'generated_secrets': (), 'attributes': (), 'webhook_secrets': ('auth_token',),
                'settings_path': None, 'exclusive': False,
                'external_id_pattern': r'AC[0-9a-f]{32}',
                'capabilities': ('senders.list', 'messaging.send', 'messaging.status', 'voice.call', 'voice.status', 'lookup'),
            },
        )

    @api.model
    def _liwan_use_definitions(self):
        """Pure descriptors ``{'key', 'provider', 'owner', 'feature_key', 'scopes', 'webhook_path'}``.

        The service's own uses: LiwanOS sets Twilio's callback URLs per request, so no webhook URL is shown.
        """
        return (
            {
                'key': 'twilio.messaging', 'provider': 'twilio', 'owner': OWNER, 'feature_key': FEATURE,
                'scopes': (), 'webhook_path': None,
            },
            {
                'key': 'twilio.voice', 'provider': 'twilio', 'owner': OWNER, 'feature_key': FEATURE,
                'scopes': (), 'webhook_path': None,
            },
            {
                'key': 'twilio.lookup', 'provider': 'twilio', 'owner': OWNER, 'feature_key': FEATURE,
                'scopes': (), 'webhook_path': None,
            },
        )

    @api.model
    def _liwan_provider_map(self):
        providers = {}
        for item in self._liwan_provider_definitions():
            code = item.get('code')
            if not _is_text(code) or code in providers:
                raise ValidationError(self.env._('liwan_integrations: a provider code is missing or duplicated: %(code)s', code=code))
            if not _is_text(item.get('owner')):
                raise ValidationError(self.env._('liwan_integrations: provider %(code)s has no owner', code=code))
            if item.get('auth') not in AUTH_TYPES:
                raise ValidationError(self.env._('liwan_integrations: provider %(code)s has an unknown auth type', code=code))
            for name in TUPLE_FIELDS:
                if not isinstance(item.get(name), tuple) or not all(_is_text(value) for value in item[name]):
                    raise ValidationError(self.env._(
                        'liwan_integrations: provider %(code)s needs a tuple of names for %(name)s', code=code, name=name,
                    ))
            if not isinstance(item.get('exclusive'), bool):
                raise ValidationError(self.env._('liwan_integrations: provider %(code)s needs a boolean exclusive', code=code))
            self._liwan_check_external_id_pattern(item)
            self._liwan_check_provider_shape(item)
            self._liwan_check_capabilities(item)
            providers[code] = {**item, 'capabilities': item.get('capabilities', ())}
        return providers

    @api.model
    def _liwan_check_capabilities(self, item):
        """The optional ``capabilities`` tuple names known capabilities that the provider's module implements."""
        code = item['code']
        capabilities = item.get('capabilities', ())
        if not isinstance(capabilities, tuple) or not all(value in CAPABILITY_FUNCTIONS for value in capabilities):
            raise ValidationError(self.env._('liwan_integrations: provider %(code)s declares an unknown capability', code=code))
        module = providers.MODULES.get(code)
        missing = [value for value in capabilities if not callable(getattr(module, CAPABILITY_FUNCTIONS[value], None))]
        if missing:
            raise ValidationError(self.env._(
                'liwan_integrations: provider %(code)s declares %(capability)s but does not implement it',
                code=code, capability=missing[0],
            ))

    @api.model
    def _liwan_check_external_id_pattern(self, item):
        """A stored provider names the regex its account ids fully match; an external one has none."""
        pattern = item.get('external_id_pattern')
        if item['auth'] == AUTH_EXTERNAL:
            valid = pattern is None
        else:
            try:
                valid = _is_text(pattern) and bool(re.compile(pattern))
            except re.error:
                valid = False
        if not valid:
            raise ValidationError(self.env._('liwan_integrations: provider %(code)s has an invalid account id pattern', code=item['code']))

    @api.model
    def _liwan_check_provider_shape(self, item):
        code = item['code']
        external = item['auth'] == AUTH_EXTERNAL
        if external != _is_text(item.get('settings_path')):
            raise ValidationError(self.env._(
                'liwan_integrations: provider %(code)s names a settings path exactly when it is external', code=code,
            ))
        if not set(item['webhook_secrets']) <= {*item['secrets'], *item['generated_secrets']}:
            raise ValidationError(self.env._('liwan_integrations: provider %(code)s names a webhook secret it does not store', code=code))
        if external and (item['secrets'] or item['generated_secrets'] or item['attributes'] or item['webhook_secrets']):
            raise ValidationError(self.env._('liwan_integrations: external provider %(code)s stores nothing here', code=code))
        if item['auth'] == AUTH_OAUTH and (item['secrets'] or item['generated_secrets']):
            raise ValidationError(self.env._('liwan_integrations: oauth provider %(code)s has no typed secrets', code=code))

    @api.model
    def _liwan_use_map(self):
        providers = self._liwan_provider_map()
        features = self.env['liwan.feature.registry']._liwan_feature_map()
        uses = {}
        for item in self._liwan_use_definitions():
            key = item.get('key')
            if not _is_text(key) or key in uses:
                raise ValidationError(self.env._('liwan_integrations: a use key is missing or duplicated: %(key)s', key=key))
            if item.get('provider') not in providers:
                raise ValidationError(self.env._('liwan_integrations: use %(key)s names an unknown provider', key=key))
            if not _is_text(item.get('owner')):
                raise ValidationError(self.env._('liwan_integrations: use %(key)s has no owner', key=key))
            if item.get('feature_key') not in features:
                raise ValidationError(self.env._('liwan_integrations: use %(key)s names an unregistered feature', key=key))
            if not isinstance(item.get('scopes'), tuple) or not all(_is_text(scope) for scope in item['scopes']):
                raise ValidationError(self.env._('liwan_integrations: use %(key)s needs a tuple of scopes', key=key))
            webhook_path = item.get('webhook_path')
            if webhook_path is not None and not (_is_text(webhook_path) and webhook_path.startswith('/')):
                raise ValidationError(self.env._('liwan_integrations: use %(key)s has an invalid webhook path', key=key))
            uses[key] = item
        return uses

    @api.model
    def _liwan_open_uses(self):
        """The uses whose feature is open for the tenant, in registration order."""
        service = self.env['liwan.entitlement.service']
        return tuple(use for use in self._liwan_use_map().values() if service._liwan_feature_read(use['feature_key']))

    @api.model
    def _liwan_external_status(self, code, company):
        """``{'state', 'status_message', 'last_checked'}`` of an external provider, derived at read time.

        The owner of the provider overrides this for its own code; the base answer is the neutral one.
        """
        return {'state': 'not_configured', 'status_message': '', 'last_checked': None}

    @api.model
    def _liwan_connection_uses(self, connection):
        """The use keys that hold ``connection`` now; an application extends this from its own records.

        The service's own records hold it too: an active sender holds the use of its channel, a message
        that may still reach the provider (queued or unconfirmed) holds the messaging use, and a call not
        in a final state holds the voice use.
        """
        channels = self.env['liwan.integration.sender'].search(
            [('connection_id', '=', connection.id), ('active', '=', True)],
        ).mapped('channel')
        uses = [f'{connection.provider}.{SENDER_USES[channel]}' for channel in channels]
        if self.env['liwan.integration.messaging']._liwan_has_pending(connection):
            uses.append(f'{connection.provider}.messaging')
        if self.env['liwan.integration.voice']._liwan_has_pending(connection):
            uses.append(f'{connection.provider}.voice')
        return tuple(dict.fromkeys(uses))
