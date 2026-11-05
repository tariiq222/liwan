# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_ai.models.consent_text import CONSENT_TEXT_HASH, CONSENT_VERSION
from odoo.addons.liwan_ai.serializers.monitoring import dump_monitoring
from odoo.addons.liwan_ai.serializers.settings import (
    dump_settings,
    parse_consent,
    parse_settings_patch,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

AI_FEATURE = 'ai.enabled'


def require_tenant_manager():
    """The provider mode and the residency consent bind every company of the tenant: only a settings manager of its
    root company reads or changes them, never the manager of one branch company."""
    root = request.env['liwan.entitlement.service']._liwan_profile().root_company_id
    if not request.env['liwan.access.service']._liwan_has_capability(request.env.user, AI_SETTINGS_MANAGE, company=root):
        raise ApiError(403, 'forbidden', 'the AI settings belong to the managers of the root company')


class AiSettingsController(http.Controller):
    """The tenant administrator's AI policy: provider mode, residency consent, usage and monitoring."""

    @http.route('/api/v1/ai/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_SETTINGS_MANAGE)
    def read_settings(self, **_):
        require_tenant_manager()
        return dump_settings(request.env)

    @http.route('/api/v1/ai/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def write_settings(self, **payload):
        require_tenant_manager()
        provider_mode, revision = parse_settings_patch(payload)
        settings = request.env['liwan.ai.settings']._liwan_current()
        if settings.revision != revision:
            raise ApiError(409, 'stale', 'the AI settings changed since they were read')
        settings.write({'provider_mode': provider_mode, 'revision': revision + 1})
        return dump_settings(request.env)

    @http.route('/api/v1/ai/consent', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def sign_consent(self, **payload):
        require_tenant_manager()
        parse_consent(payload)
        Consent = request.env['liwan.ai.consent']
        if not Consent._liwan_valid():
            Consent.create({
                'user_id': request.env.uid,
                'signed_at': fields.Datetime.now(),
                'text_version': CONSENT_VERSION,
                'text_hash': CONSENT_TEXT_HASH,
            })
        return dump_settings(request.env)

    @http.route('/api/v1/ai/consent/revoke', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def revoke_consent(self, **_):
        require_tenant_manager()
        # Every valid row, not one: a consent signed twice must not survive its revocation.
        consent = request.env['liwan.ai.consent']._liwan_valid_all()
        if not consent:
            raise ApiError(404, 'not_found', 'there is no consent to revoke')
        consent.write({'revoked_at': fields.Datetime.now(), 'revoked_by_id': request.env.uid})
        return dump_settings(request.env)

    @http.route('/api/v1/ai/monitoring', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_SETTINGS_MANAGE)
    def read_monitoring(self, **_):
        return dump_monitoring(request.env)
