# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio Lookup v2: validate one phone number, optionally with its line type.

Pure functions over the client helper, no ORM (https://www.twilio.com/docs/lookup/v2-api).
"""
from urllib.parse import quote

from . import client
from odoo.addons.liwan_integrations_sa.providers import errors

LOOKUP_BASE = 'https://lookups.twilio.com/v2/PhoneNumbers'
LOOKUP_HOST = 'https://lookups.twilio.com'
LINE_TYPE_FIELD = 'line_type_intelligence'


def lookup(external_id, credentials, number, line_type=False):
    """``{'valid', 'e164', 'country', 'line_type'}`` for ``number`` (E.164 or national), or a `ProviderError`.

    ``line_type`` is asked for (and returned non-null) only when requested: it is a paid package.
    An invalid number is a normal answer, not an error: ``valid`` is False and the rest is null.
    """
    params = {'Fields': LINE_TYPE_FIELD} if line_type else None
    answer = client.call(
        'GET', f'{LOOKUP_BASE}/{quote(number, safe="")}', credentials, external_id, params=params,
    )
    if not isinstance(answer.get('valid'), bool):
        msg = 'The provider answered no validity for the number.'
        raise errors.ProviderError(msg, retryable=False)
    line_type_intelligence = answer.get('line_type_intelligence')
    return {
        'valid': answer['valid'],
        'e164': answer.get('phone_number') if isinstance(answer.get('phone_number'), str) else None,
        'country': answer.get('country_code') if isinstance(answer.get('country_code'), str) else None,
        'line_type': line_type_intelligence.get('type')
        if line_type and isinstance(line_type_intelligence, dict) and isinstance(line_type_intelligence.get('type'), str)
        else None,
    }
