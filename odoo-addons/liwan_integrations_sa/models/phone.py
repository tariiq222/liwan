# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one phone-number normalizer the messaging, voice and lookup services share."""
import phonenumbers

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


def normalize_phone(env, number, company, field='to'):
    """``number`` as E.164; a local number is read in ``company``'s country.

    A refused number raises the same ``invalid_phone`` refusal (422) the services raise today,
    naming ``field``. A number without a country (a lookup asked without one) only needs to be
    parseable; a call or message target must also be a valid number.
    """
    code = 'invalid_phone'
    message = env._('The phone number is not valid.')
    region = company.country_id.code or None
    try:
        parsed = phonenumbers.parse(number, region) if isinstance(number, str) and number.strip() else None
    except phonenumbers.NumberParseException:
        parsed = None
    if not parsed or (field != 'number' and not phonenumbers.is_valid_number(parsed)):
        raise LiwanAccessRule(code, message, field=field)
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
