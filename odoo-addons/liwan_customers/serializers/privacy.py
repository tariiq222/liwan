# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unicodedata

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_customers.models.privacy_request import REASON_MAX
from odoo.addons.liwan_customers.models.privacy_service import TOKEN_TTL

ALLOWED_CONTROL = ('\n', '\t')
ERASE_KEYS = frozenset({'token', 'confirmation', 'reason'})
EXPORT_KEYS = frozenset({'reason'})


def _text(payload, key):
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', f'{key} is required', field=key)
    return value


def _reason(payload):
    reason = _text(payload, 'reason').strip()
    if any(unicodedata.category(char) == 'Cc' and char not in ALLOWED_CONTROL for char in reason):
        raise ApiError(422, 'invalid', 'reason has control characters', field='reason')
    if len(reason) > REASON_MAX:
        raise ApiError(422, 'invalid', f'reason is at most {REASON_MAX} characters', field='reason')
    return reason


def _only(payload, keys):
    unknown = sorted(set(payload) - keys)
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])


def parse_erase(payload):
    """``(token, confirmation, reason)`` of an erase request."""
    _only(payload, ERASE_KEYS)
    # The confirmation is compared exactly, so it is neither stripped nor reshaped.
    return _text(payload, 'token'), _text(payload, 'confirmation'), _reason(payload)


def parse_export(payload):
    """The ``reason`` of an export request."""
    _only(payload, EXPORT_KEYS)
    return _reason(payload)


def dump_preview(customer_id, preview):
    """``{customer: {id, erased}, items: [{key, owner, action, count, complete}], incomplete: [{key, owner, reason}],
    unchecked_models: [model], not_covered: [key], reach: {shared, covers_all}, token, expires_in}``.

    ``action`` is ``erase`` (cleared), ``retain`` (kept by law) or ``unhandled`` (an application model that links to the
    customer and has no hook: the erase cannot clear it). ``complete`` is false when the caller cannot reach every record
    of that kind. While ``incomplete`` is not empty the erase answers 409 ``erase_incomplete``; each entry's ``reason`` is
    ``application_has_no_hook``, ``session_does_not_cover_every_company`` (a customer shared across the tenant needs a
    session over the root and every branch) or ``caller_cannot_reach_all_records`` (the caller lacks the application's
    role). ``unchecked_models`` are application models that link to a customer, have no hook and showed the caller no
    record: they were not checked. ``not_covered`` lists the keys of what an erase never changes. ``expires_in`` is the
    token's lifetime in seconds.
    """
    return {
        'customer': {'id': customer_id, 'erased': preview['erased']},
        'items': preview['items'],
        'incomplete': preview['incomplete'],
        'unchecked_models': preview['unchecked_models'],
        'not_covered': preview['not_covered'],
        'reach': preview['reach'],
        'token': preview['token'],
        'expires_in': int(TOKEN_TTL.total_seconds()),
    }


def dump_erase(customer_id, request, counts):
    """``{customer_id, erased, request_id, items: [{key, count}]}``; ``erased`` is false for a no-op on an erased customer."""
    return {
        'customer_id': customer_id,
        'erased': bool(request),
        'request_id': request.id or None,
        'items': [{'key': key, 'count': count} for key, count in counts.items()],
    }
