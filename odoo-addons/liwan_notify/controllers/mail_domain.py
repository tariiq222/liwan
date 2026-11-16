# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_tenant_access,
)
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_notify.models.access_service import MAIL_DOMAIN_MANAGE
from odoo.addons.liwan_notify.models.mail_domain import (
    LiwanMailRefused,
    MailDomainBusy,
    MailDomainInputError,
)
from odoo.addons.liwan_notify.models.mail_domain_provider import (
    MailDomainTaken,
    MailProviderError,
)

ROUTE = '/api/v1/mail/domain'
TEST_KIND = 'mail.domain.test'
# A record the provider has not filled yet (empty name or value) is left out until it is ready.
RECORD_KEYS = ('kind', 'type', 'name', 'value')
COMMERCIAL_UNAVAILABLE = 'commercial self-service is not enabled for this installation'


def _require_saas():
    """The domain card is a SaaS path (spec 5.6): 404 ``commercial_unavailable`` elsewhere."""
    if request.env['liwan.entitlement.service']._liwan_profile().commercial_mode != 'saas':
        raise ApiError(404, 'commercial_unavailable', COMMERCIAL_UNAVAILABLE)


def _dump(row):
    """The whitelisted shape of the tenant's domain; an absent row is ``not_started``."""
    configured = request.env['liwan.mail.domain']._liwan_provider_configured()
    if not row:
        return {
            'state': 'not_started', 'domain': None, 'from_local_part': None, 'sender_address': None, 'records': [],
            'return_path_expires_at': None, 'return_path_recreated_at': None, 'verified_at': None, 'last_error': None,
            'paused': False, 'pause_reason': None, 'provider_configured': configured,
        }

    return {
        'state': row.state,
        'domain': row.domain,
        'from_local_part': row.from_local_part,
        'sender_address': row._liwan_address(),
        'records': [
            {key: record[key] for key in RECORD_KEYS}
            for record in row.records or [] if all(record.get(key) for key in RECORD_KEYS)
        ],
        'return_path_expires_at': iso(row._liwan_return_path_expires_at()),
        'return_path_recreated_at': iso(row.return_path_recreated_at),
        'verified_at': iso(row.verified_at) if row.state in ('verified', 'failed') else None,
        'last_error': row.last_error or None,
        'paused': row.paused,
        'pause_reason': row.pause_reason or None,
        'provider_configured': configured,
    }


def _current_or_404():
    row = request.env['liwan.mail.domain']._liwan_current()
    if not row:
        raise ApiError(404, 'not_found', 'no mail domain is set')
    return row


def _paused(refusal):
    """409 ``mail_paused``: a paused domain is not removed or replaced until the operator resumes it."""
    return ApiError(409, refusal.code, str(refusal), details={'reason': refusal.reason})


def _busy():
    return ApiError(409, 'busy', 'the mail domain is being updated; try again in a moment')


def _provider_error():
    return ApiError(502, 'provider_error', 'the mail provider did not answer; try again later')


class MailDomainController(http.Controller):
    """The tenant's own sending domain (spec 5.7): read, start, verify, test, remove, usage. The cron recreates the return path."""

    @http.route(ROUTE, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_tenant_access(operation='read')
    @requires_capability(MAIL_DOMAIN_MANAGE)
    def get_domain(self, **_):
        _require_saas()
        return _dump(request.env['liwan.mail.domain']._liwan_current())

    @http.route(f'{ROUTE}/start', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_tenant_access(operation='write')
    @requires_capability(MAIL_DOMAIN_MANAGE)
    def start(self, domain=None, from_local_part=None, **_):
        _require_saas()
        model = request.env['liwan.mail.domain']
        if not model._liwan_provider_configured():
            raise ApiError(503, 'provider_unavailable', 'the mail provider is not configured')
        try:
            return _dump(model._liwan_start(domain, from_local_part))
        except MailDomainInputError as error:
            raise ApiError(422, 'invalid', str(error), field=error.field) from None
        except MailDomainTaken:
            raise ApiError(409, 'domain_taken', 'this domain is already registered') from None
        except LiwanMailRefused as refusal:
            raise _paused(refusal) from None

    @http.route(f'{ROUTE}/verify', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_tenant_access(operation='write')
    @requires_capability(MAIL_DOMAIN_MANAGE)
    def verify(self, **_):
        _require_saas()
        row = _current_or_404()
        try:
            row._liwan_check()
        except MailDomainBusy:
            raise _busy() from None
        return _dump(row)

    @http.route(f'{ROUTE}/test-send', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_tenant_access(operation='write')
    @requires_capability(MAIL_DOMAIN_MANAGE)
    def test_send(self, **_):
        _require_saas()
        user = request.env.user
        if not user.email:
            raise ApiError(422, 'invalid', 'your account has no email address', field='email')
        send = request.env['liwan.mail.send']
        try:
            mail = send._liwan_send(
                'res.users', user.id, TEST_KIND, [user.email], request.env._('Test email from LiwanOS'),
                request.env._('<p>Your company domain sends email correctly.</p>'),
            )
        except LiwanMailRefused as refusal:
            raise ApiError(422, refusal.code, str(refusal), details={'reason': refusal.reason}) from None
        row = send._liwan_outbox().browse(mail.id)
        return {'mail_id': row.id, 'state': row.state}

    @http.route(ROUTE, type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_tenant_access(operation='write')
    @requires_capability(MAIL_DOMAIN_MANAGE)
    def remove(self, **_):
        _require_saas()
        row = _current_or_404()
        if row.state == 'not_started':
            raise ApiError(404, 'not_found', 'no mail domain is set')
        try:
            row._liwan_remove()
        except LiwanMailRefused as refusal:
            raise _paused(refusal) from None
        except MailDomainBusy:
            raise _busy() from None
        except MailProviderError:
            raise _provider_error() from None
        return _dump(row)

    @http.route(f'{ROUTE}/usage', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_tenant_access(operation='read')
    @requires_capability(MAIL_DOMAIN_MANAGE)
    def usage(self, **_):
        _require_saas()
        return request.env['liwan.mail.send']._liwan_usage()
