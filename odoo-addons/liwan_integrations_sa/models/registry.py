# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

from .constants import AUTH_EXTERNAL, AUTH_KEYS, AUTH_OAUTH, AUTH_TYPES, OWNER

TUPLE_FIELDS = ('secrets', 'generated_secrets', 'attributes')


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
                'attributes': ('app_id',), 'settings_path': None, 'exclusive': False,
            },
            {
                'code': 'tiktok', 'owner': OWNER, 'auth': AUTH_OAUTH,
                'secrets': (), 'generated_secrets': (), 'attributes': (), 'settings_path': None,
                # The webhook is routed by the account id alone, so one database holds an account once.
                'exclusive': True,
            },
        )

    @api.model
    def _liwan_use_definitions(self):
        """Pure descriptors ``{'key', 'provider', 'owner', 'feature_key', 'scopes', 'webhook_path'}``; none by default."""
        return ()

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
            self._liwan_check_provider_shape(item)
            providers[code] = item
        return providers

    @api.model
    def _liwan_check_provider_shape(self, item):
        code = item['code']
        external = item['auth'] == AUTH_EXTERNAL
        if external != _is_text(item.get('settings_path')):
            raise ValidationError(self.env._(
                'liwan_integrations: provider %(code)s names a settings path exactly when it is external', code=code,
            ))
        if external and (item['secrets'] or item['generated_secrets'] or item['attributes']):
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
        """The use keys that hold ``connection`` now; an application extends this from its own records."""
        return ()
