# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The company's lines and extensions (design sections 5, 8).

Every route needs the feature, the current company and ``telephony.manage`` to write, and ``telephony.use`` to read.
A write names the field it refuses: an unknown key, a wrong type and an out-of-range value each answer 422
``invalid``. No provider password is stored or travels: nothing here carries one.
"""
import re

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE
from odoo.addons.liwan_telephony.models.telephony_extension import EXTENSION_NUMBER
from odoo.addons.liwan_telephony.models.telephony_line import (
    AUTH_METHODS,
    CONCURRENT_MAX,
    CONCURRENT_MIN,
    DIAL_PREFIX_MAX_DIGITS,
    E164,
    HOST_MAX_LENGTH,
    KINDS,
    NAME_MAX_LENGTH,
    PORT_MAX,
    PORT_MIN,
    PROVIDER_HOST,
)
from odoo.addons.liwan_telephony.serializers.telephony_extension import (
    dump_extension,
    dump_extensions,
)
from odoo.addons.liwan_telephony.serializers.telephony_line import dump_line, dump_lines

LINE_KEYS = frozenset({
    'name', 'kind', 'authMethod', 'providerHost', 'providerPort', 'numbers', 'outboundFormat', 'callerId',
    'maxConcurrent',
})
EXTENSION_KEYS = frozenset({'number', 'userId'})
EXTENSION_NUMBER_PATTERN = re.compile(EXTENSION_NUMBER)
E164_EXAMPLE = 'for example +966501234567'


def _refuse(field, message):
    raise ApiError(422, 'invalid', message, field=field)


def _no_extra_keys(payload, keys):
    extra = sorted(set(payload) - keys)
    if extra:
        _refuse(extra[0], 'field %r is not writable' % extra[0])


def _choice(value, selection, field):
    if value not in dict(selection):
        _refuse(field, f'{field} must be one of {", ".join(dict(selection))}')
    return value


def _range(value, low, high, field):
    if type(value) is not int or not low <= value <= high:
        _refuse(field, f'{field} must be between {low} and {high}')
    return value


def _host(value):
    if not isinstance(value, str) or len(value) > HOST_MAX_LENGTH or not PROVIDER_HOST.fullmatch(value):
        _refuse('providerHost', 'providerHost must be a host name or an IPv4 address')
    return value


def _dial_prefix(value):
    if (
        not isinstance(value, str) or len(value) > DIAL_PREFIX_MAX_DIGITS
        or (value and not (value.isascii() and value.isdecimal()))
    ):
        _refuse('outboundFormat', f'outboundFormat must be at most {DIAL_PREFIX_MAX_DIGITS} digits')
    return value


def _e164(field):
    def check(value):
        if not isinstance(value, str) or not E164.fullmatch(value):
            _refuse(field, f'{field} must be in E.164, {E164_EXAMPLE}')
        return value
    return check


def _numbers(value):
    if not isinstance(value, list):
        _refuse('numbers', f'numbers must be a list, each in E.164, {E164_EXAMPLE}')
    for number in value:
        if not isinstance(number, str) or not E164.fullmatch(number):
            _refuse('numbers', f'every number must be in E.164, {E164_EXAMPLE}')
    if len(set(value)) != len(value):
        _refuse('numbers', 'a number appears twice')
    return value


def _nullable(payload, key, check):
    """``null`` clears the field; any other value goes through ``check``."""
    return False if payload[key] is None else check(payload[key])


def parse_line(payload, creating):
    """The model values of a line write. On a create the name is required; every other field keeps its value."""
    _no_extra_keys(payload, LINE_KEYS)
    values = {}
    if creating or 'name' in payload:
        if creating and 'name' not in payload:
            _refuse('name', 'A line needs a name.')
        name = payload['name']
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX_LENGTH:
            _refuse('name', f'name must be 1 to {NAME_MAX_LENGTH} characters')
        values['name'] = name.strip()
    if 'kind' in payload:
        values['kind'] = _choice(payload['kind'], KINDS, 'kind')
    if 'authMethod' in payload:
        values['auth_method'] = _choice(payload['authMethod'], AUTH_METHODS, 'authMethod')
    if 'providerHost' in payload:
        values['provider_host'] = _nullable(payload, 'providerHost', _host)
    if 'providerPort' in payload:
        values['provider_port'] = _range(payload['providerPort'], PORT_MIN, PORT_MAX, 'providerPort')
    if 'numbers' in payload:
        values['number_ids'] = [(6, 0, 0), *[(0, 0, {'number': number}) for number in _numbers(payload['numbers'])]]
    if 'outboundFormat' in payload:
        values['outbound_format'] = _nullable(payload, 'outboundFormat', _dial_prefix) or False
    if 'callerId' in payload:
        values['caller_id'] = _nullable(payload, 'callerId', _e164('callerId'))
    if 'maxConcurrent' in payload:
        values['max_concurrent'] = _range(payload['maxConcurrent'], CONCURRENT_MIN, CONCURRENT_MAX, 'maxConcurrent')
    return values


def _extension_user(user_id):
    """The active internal user of the current company that ``userId`` names, or 422 naming ``userId``."""
    if type(user_id) is not int or user_id <= 0:
        _refuse('userId', 'userId must be a user id')
    user = request.env['res.users'].search([
        ('id', '=', user_id), ('active', '=', True), ('share', '=', False),
        ('company_ids', 'in', request.env.company.ids),
    ], limit=1)
    if not user:
        _refuse('userId', 'The user is not an active internal user of the current company.')
    return user


class TelephonyLinesController(http.Controller):

    @http.route('/api/v1/telephony/lines', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def list_lines(self, **_):
        lines = request.env['liwan.telephony.line'].search([])
        return {'items': dump_lines(lines), 'total': len(lines)}

    @http.route('/api/v1/telephony/lines', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.manage')
    def create_line(self, **payload):
        return dump_line(request.env['liwan.telephony.line'].create(parse_line(payload, creating=True)))

    @http.route('/api/v1/telephony/lines/<int:line_id>', type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.manage')
    def patch_line(self, line_id, **payload):
        """A line of the current company; another company's line answers like a missing one."""
        line = get_record('liwan.telephony.line', line_id)
        values = parse_line(payload, creating=False)
        if values:
            line.write(values)
        return dump_line(line)

    @http.route('/api/v1/telephony/extensions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def list_extensions(self, **_):
        extensions = request.env['liwan.telephony.extension'].search([])
        return {'items': dump_extensions(extensions), 'total': len(extensions)}

    @http.route('/api/v1/telephony/extensions', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.manage')
    def create_extension(self, **payload):
        """A new extension of the current company, within the tenant's extension limit."""
        _no_extra_keys(payload, EXTENSION_KEYS)
        number = payload.get('number')
        if not isinstance(number, str) or not EXTENSION_NUMBER_PATTERN.fullmatch(number):
            _refuse('number', 'number must be 2 to 10 digits')
        if request.env['liwan.telephony.extension'].with_context(active_test=False).search_count([('number', '=', number)]):
            _refuse('number', 'An extension number is unique in a company.')
        values = {'number': number}
        if payload.get('userId') is not None:
            values['user_id'] = _extension_user(payload['userId']).id
        # The limit is claimed under the tenant profile lock before the row exists.
        request.env['liwan.entitlement.service']._liwan_claim_extensions(1)
        return dump_extension(request.env['liwan.telephony.extension'].create(values))
