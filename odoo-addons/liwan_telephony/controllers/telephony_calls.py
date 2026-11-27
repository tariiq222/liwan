# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The call log and the lookup by number (design 4.3, 8).

Every route needs the feature, the capability and the current company, and a user with only ``telephony.use`` sees
their own calls because the record rule says so, not because this controller filters.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_visible_record,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_telephony.controllers.telephony_recordings import can_listen
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE
from odoo.addons.liwan_telephony.models.telephony_call import DIRECTIONS, STATES
from odoo.addons.liwan_telephony.serializers.telephony_call import dump_call, dump_calls

# The lookup card shows this many of the number's latest calls.
LOOKUP_CALLS = 5


def _arg(name):
    """A query argument as a non-blank string, or None when it is absent or blank."""
    raw = request.httprequest.args.get(name)
    return raw.strip() if isinstance(raw, str) and raw.strip() else None


def _selection_arg(name, selection):
    """A query argument that must name one of ``selection``, or None: anything else is 422 ``invalid``."""
    value = _arg(name)
    if value is not None and value not in dict(selection):
        raise ApiError(422, 'invalid', f'{name} must be one of {", ".join(dict(selection))}', field=name)
    return value


def list_filters():
    """``direction``, ``state`` and ``user_id`` from the query string (a json2 route receives only the body and the
    path in its arguments), as a domain; an unknown value is refused, never silently ignored."""
    filters = {
        'direction': _selection_arg('direction', DIRECTIONS),
        'state': _selection_arg('state', STATES),
        'user_id': parse_positive_int(_arg('user_id'), 'user_id') if _arg('user_id') else None,
    }
    return [(name, '=', value) for name, value in filters.items() if value]


class TelephonyCallsController(http.Controller):

    @http.route('/api/v1/telephony/calls', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def list_calls(self, **_):
        """The call log of the caller's visibility, newest first."""
        args = request.httprequest.args
        domain = list_filters()
        limit, offset = parse_page(args)
        Call = request.env['liwan.telephony.call']
        calls = Call.search(domain, limit=limit, offset=offset)
        return {'items': dump_calls(calls), 'total': Call.search_count(domain)}

    @http.route('/api/v1/telephony/calls/<int:call_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def get_call(self, call_id, **_):
        """One call, with whether this user may listen to its recording.

        A call the own-calls rule hides from the caller answers exactly like a missing one.
        """
        call = get_visible_record('liwan.telephony.call', call_id)
        return {**dump_call(call), 'canListen': can_listen()}

    @http.route('/api/v1/telephony/lookup', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def lookup(self, **_):
        """The caller card: the partner the number belongs to and the latest calls with it, newest first.

        The number is read in the current company's country (Saudi Arabia when it names none), the way calls store
        it; a number that cannot be normalized matches nothing and is refused.
        """
        number = _arg('number')
        if not number:
            raise ApiError(422, 'invalid', 'A number is required.', field='number')
        env = request.env
        Call = env['liwan.telephony.call']
        normalized = Call._liwan_e164(number, env.company)
        if not normalized:
            raise ApiError(422, 'invalid', 'The number is not a valid phone number.', field='number')
        partner = Call._liwan_partner(normalized, env.company)
        calls = Call.search([('remote_number', '=', normalized)], limit=LOOKUP_CALLS)
        return {
            'number': normalized,
            'partner': {
                'id': partner.id,
                'name': partner.display_name,
                'isCompany': partner.is_company,
                'company': {'id': partner.company_id.id, 'name': partner.company_id.display_name}
                if partner.company_id else None,
            } if partner else None,
            'calls': dump_calls(calls),
        }
