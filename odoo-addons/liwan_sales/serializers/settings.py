# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_sales.models.sales_settings import (
    ANSWER_MODES,
    RESEND_MODES,
    SIGNATURE_MODES,
    VISIBILITY_MODES,
)

WRITABLE_KEYS = (
    'visibility', 'validity_days', 'discount_limit_percent', 'default_terms', 'customer_answer', 'acceptance_confirms',
    'answered_resend', 'signature_methods',
)
INTEGER_RANGES = {'validity_days': (0, 3650), 'discount_limit_percent': (0, 100)}


def dump_settings(settings, can_manage):
    """The settings wire shape; ``can_manage`` is whether the caller passes the authorization of a settings write."""
    return {
        'visibility': settings.visibility,
        'validity_days': settings.validity_days,
        'discount_limit_percent': settings.discount_limit_percent,
        'default_terms': settings.default_terms or '',
        'customer_answer': settings.customer_answer,
        'acceptance_confirms': settings.acceptance_confirms,
        'answered_resend': settings.answered_resend,
        'signature_methods': settings.signature_methods,
        **settings._liwan_wire_extras(),
        'can_manage': can_manage,
        'revision': settings.revision,
    }


def _parse_value(key, value):
    if key == 'visibility':
        if value not in VISIBILITY_MODES:
            raise ApiError(422, 'invalid', f'visibility must be one of {VISIBILITY_MODES}', field=key)
    elif key == 'customer_answer':
        if value not in ANSWER_MODES:
            raise ApiError(422, 'invalid', f'customer_answer must be one of {ANSWER_MODES}', field=key)
    elif key == 'answered_resend':
        if value not in RESEND_MODES:
            raise ApiError(422, 'invalid', f'answered_resend must be one of {RESEND_MODES}', field=key)
    elif key == 'signature_methods':
        if value not in SIGNATURE_MODES:
            raise ApiError(422, 'invalid', f'signature_methods must be one of {SIGNATURE_MODES}', field=key)
    elif key == 'acceptance_confirms':
        if not isinstance(value, bool):
            raise ApiError(422, 'invalid', 'acceptance_confirms must be true or false', field=key)
    elif key == 'default_terms':
        if not isinstance(value, str):
            raise ApiError(422, 'invalid', 'default_terms must be text', field=key)
    else:
        low, high = INTEGER_RANGES[key]
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise ApiError(422, 'invalid', f'{key} must be an integer from {low} to {high}', field=key)
    return value


def parse_settings_patch(payload, parsers):
    """``(values, revision)`` of a settings write, or a 422. ``parsers`` are the keys an installed bridge adds, each
    with the function that checks its value (``liwan.sales.settings._liwan_patch_parsers``)."""
    unknown = sorted(set(payload) - {*WRITABLE_KEYS, *parsers, 'revision'})
    if unknown:
        raise ApiError(422, 'invalid', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    revision = payload.get('revision')
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ApiError(422, 'invalid', 'revision must be a positive integer', field='revision')
    values = {key: _parse_value(key, payload[key]) for key in WRITABLE_KEYS if key in payload}
    values.update({key: parser(payload[key]) for key, parser in parsers.items() if key in payload})
    if not values:
        raise ApiError(422, 'invalid', 'nothing to change')
    return values, revision
