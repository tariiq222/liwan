# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import os
from datetime import timedelta
from unittest.mock import patch

from odoo import Command, fields
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import (
    PROBE_FEATURE,
    LiwanApiCase,
    register_probe_feature,
    set_probe_feature,
)
from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_integrations_sa.providers import tiktok

PASSWORD = 'integrations_pass_123'
ACCOUNT_ID = '123456789012345'
ACCESS_TOKEN = 'EAAB-access-token-0123456789'
APP_SECRET = 'app-secret-0123456789abcdef'
OPEN_ID = 'tiktok-business-open-id-1'
TIKTOK_ACCESS = 'tiktok-access-token-1'
TIKTOK_REFRESH = 'tiktok-refresh-token-1'
CLIENT_KEY = 'client-key-0123456789'
CLIENT_SECRET = 'client-secret-0123456789'
REDIRECT_URI = 'https://liwan.test/api/v1/integrations/oauth/tiktok/callback'
META_USE = {
    'key': 'test.meta', 'provider': 'meta', 'owner': 'liwan_integrations_sa', 'feature_key': PROBE_FEATURE,
    'scopes': (), 'webhook_path': '/api/v1/test/hooks/meta',
}
TIKTOK_USE = {
    'key': 'test.tiktok', 'provider': 'tiktok', 'owner': 'liwan_integrations_sa', 'feature_key': PROBE_FEATURE,
    'scopes': ('user.info.basic', 'message.list.read'), 'webhook_path': None,
}
SECRETS = {'access_token': ACCESS_TOKEN, 'app_secret': APP_SECRET}
META_BODY = {'provider': 'meta', 'external_id': ACCOUNT_ID, 'app_id': '1122334455', 'secrets': SECRETS}


def grant(open_id=OPEN_ID, scopes=None, expires_in=timedelta(days=1), refresh_in=timedelta(days=365)):
    """A TikTok authorization as the provider module returns it, expiring ``expires_in`` from now."""
    now = fields.Datetime.now()
    return tiktok.TokenGrant(
        open_id=open_id,
        scopes=frozenset(tiktok.SCOPES if scopes is None else scopes),
        access_token=TIKTOK_ACCESS,
        refresh_token=TIKTOK_REFRESH,
        expires_at=now + expires_in,
        refresh_expires_at=now + refresh_in,
    )


def extend_registry(case, *, providers=(), uses=(), method_overrides=None):
    """Add test-only providers and uses to the registry for the length of one test."""
    registry = type(case.env['liwan.integration.registry'])
    original_providers, original_uses = registry._liwan_provider_definitions, registry._liwan_use_definitions
    case.patch(registry, '_liwan_provider_definitions', lambda model: (*original_providers(model), *providers))
    case.patch(registry, '_liwan_use_definitions', lambda model: (*original_uses(model), *uses))
    for name, method in (method_overrides or {}).items():
        case.patch(registry, name, method)


class LiwanIntegrationsCase(LiwanApiCase):
    """A system administrator, a reader, the two test uses (meta and tiktok) and a secret-storage key."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        key_patch = patch.dict(os.environ, {secret_box.KEY_ENV: base64.urlsafe_b64encode(os.urandom(32)).decode()})
        key_patch.start()
        cls.addClassCleanup(key_patch.stop)
        cls.admin = new_test_user(
            cls.env, login='integrations_admin', password=PASSWORD, name='Integrations administrator',
            groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.env.company.id,
        }])
        cls.reader = new_test_user(
            cls.env, login='integrations_reader', password=PASSWORD, name='Integrations reader',
            groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': 'integrations_reader', 'name_ar': 'قارئ الربط', 'name_en': 'Integrations reader', 'type': 'custom',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([('key', '=', 'integrations.read')]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.reader, [{'role_id': role.id, 'company_id': cls.env.company.id}],
        )
        cls.env['ir.config_parameter'].sudo().set_param('web.base.url', 'https://liwan.test')

    def setUp(self):
        super().setUp()
        register_probe_feature(self)
        set_probe_feature(self, enabled=True)
        extend_registry(self, uses=(META_USE, TIKTOK_USE))

    def login(self, user):
        self.authenticate(user.login, PASSWORD)

    def make_meta(self, external_id=ACCOUNT_ID, company=None, **values):
        """A connected Meta connection with its two typed secrets and its generated handshake token."""
        Connection = self.env['liwan.integration.connection']
        connection = Connection.create({
            'company_id': (company or self.env.company).id, 'provider': 'meta', 'external_id': external_id,
            'app_id': '1122334455', 'state': 'connected', **values,
        })
        connection._liwan_store_secrets(SECRETS)
        connection._liwan_generate_secrets()
        return connection

    def make_tiktok(self, authorization=None, company=None):
        """A connected TikTok connection holding ``authorization`` (a fresh one by default)."""
        authorization = authorization or grant()
        connection = self.env['liwan.integration.connection'].create({
            'company_id': (company or self.env.company).id, 'provider': 'tiktok', 'external_id': authorization.open_id,
        })
        connection._liwan_oauth_store(authorization, 'shop')
        return connection

    def assertNoSecrets(self, response, *values):
        for value in (ACCESS_TOKEN, APP_SECRET, TIKTOK_ACCESS, TIKTOK_REFRESH, *values):
            self.assertNotIn(value, response.text)

    def assertError(self, response, status, code):
        self.assertEqual((response.status_code, response.json().get('code')), (status, code), response.text)
