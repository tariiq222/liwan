# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request parsing and lookups shared by the integrations controllers."""
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_integrations_sa.models.constants import MANAGE

TEXT_MAX = 128
SECRET_MIN = 8
SECRET_MAX = 1024
EXTERNAL_ID_MAX = 64


def reject(message, field=None):
    """Answer 422 `invalid` naming `field`."""
    raise ApiError(422, 'invalid', message, field=field)


def not_found():
    return ApiError(404, 'not_found', 'record does not exist')


def check_fields(payload, allowed, required=()):
    """Reject unknown and missing keys of a JSON body with a 422 naming the field."""
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        reject(f'field {unknown[0]!r} is not accepted', unknown[0])
    missing = [key for key in required if key not in payload]
    if missing:
        reject(f'field {missing[0]!r} is required', missing[0])
    if not payload:
        reject('no fields to update')


def parse_text(payload, key, maximum, minimum=1):
    value = payload[key].strip() if isinstance(payload[key], str) else None
    if value is None or not minimum <= len(value) <= maximum:
        reject(f'{key} must be a string of {minimum} to {maximum} characters', key)
    return value


def parse_optional_text(payload, key):
    """The trimmed text of ``key``, or False for null or blank (the field is cleared)."""
    return parse_text(payload, key, TEXT_MAX) if payload[key] else False


def parse_secrets(payload, provider):
    """``{name: value}`` of the typed secrets of a body; a name the provider does not declare is refused."""
    value = payload['secrets']
    if not isinstance(value, dict):
        reject('secrets must be an object of secret values', 'secrets')
    if not value:
        reject('secrets must name at least one secret', 'secrets')
    unknown = sorted(set(value) - set(provider['secrets']))
    if unknown:
        reject(f'secret {unknown[0]!r} is not accepted by this provider', 'secrets')
    return {name: parse_text(value, name, SECRET_MAX, SECRET_MIN) for name in value}


def public_base():
    """The pinned public origin of the tenant (`web.base.url`), never the request's own root; 422 when none is set.

    Without it a webhook URL would be a bare path no provider can call. ``get_base_url`` is Odoo's own public
    accessor, which reads the parameter elevated for any caller.
    """
    base = (request.env['liwan.integration.connection'].get_base_url() or '').strip().rstrip('/')
    if not base:
        reject(request.env._('Set the public base URL of this site before copying a webhook address.'))
    return base.replace('http://', 'https://', 1)


def holds_manage(company):
    return request.env['liwan.access.service']._liwan_has_capability(request.env.user, MANAGE, company=company)


def find_connection(connection_id):
    """The connection of the current company, or 404: another company's row answers like a missing one."""
    connection = request.env['liwan.integration.connection'].search(
        [('id', '=', connection_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not connection:
        raise not_found()
    return connection


def offered_providers():
    """``{code: (definition, open uses)}`` of the providers at least one open use of which makes available."""
    registry = request.env['liwan.integration.registry']
    providers = registry._liwan_provider_map()
    offered = {}
    for use in registry._liwan_open_uses():
        offered.setdefault(use['provider'], (providers[use['provider']], []))[1].append(use)
    return offered
