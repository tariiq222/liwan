# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The refund rules of a product, as a selling application's settings route shows and changes them."""
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_payments.models.refund_policy import (
    COMPANY_DEFAULT,
    MAX_TIERS,
    NOTICE_HOURS_RANGE,
    REFUND_AMOUNTS,
    REFUND_POLICIES,
)

REFUND_RULE_FIELDS = {'refund_policy', 'refund_amounts', 'refund_tiers'}
CHOICES = {
    'refund_policy': {value for value, _label in COMPANY_DEFAULT + REFUND_POLICIES},
    'refund_amounts': {value for value, _label in COMPANY_DEFAULT + REFUND_AMOUNTS},
}
TIER_FIELDS = {'notice_hours', 'percent'}


def parse_refund_rules(payload):
    """The refund rule fields of a PATCH body as keyword arguments of ``_webvue_set_refund_rules``."""
    values = {}
    for field, choices in CHOICES.items():
        if field in payload:
            if not isinstance(payload[field], str) or payload[field] not in choices:
                raise ApiError(422, 'invalid', 'must be one of %s' % ', '.join(sorted(choices)), field=field)
            values[field] = payload[field]
    if 'refund_tiers' in payload:
        values['refund_tiers'] = _parse_tiers(payload['refund_tiers'])
    return values


def _parse_tiers(tiers):
    message = 'at most %d tiers of whole notice_hours from %d to %d and percent from 0 to 100, one per notice' % (
        MAX_TIERS, *NOTICE_HOURS_RANGE,
    )
    if not isinstance(tiers, list) or len(tiers) > MAX_TIERS:
        raise ApiError(422, 'invalid', message, field='refund_tiers')
    low, high = NOTICE_HOURS_RANGE
    for tier in tiers:
        if (
            not isinstance(tier, dict) or set(tier) != TIER_FIELDS
            or type(tier['notice_hours']) is not int or not low <= tier['notice_hours'] <= high
            or type(tier['percent']) is not int or not 0 <= tier['percent'] <= 100
        ):
            raise ApiError(422, 'invalid', message, field='refund_tiers')
    if len({tier['notice_hours'] for tier in tiers}) != len(tiers):
        raise ApiError(422, 'invalid', message, field='refund_tiers')
    return [{'notice_hours': tier['notice_hours'], 'percent': tier['percent']} for tier in tiers]
