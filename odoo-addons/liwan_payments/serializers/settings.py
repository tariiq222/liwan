# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_payments.models.payments_settings import (
    DEFAULT_EXPIRY_MINUTES,
    EXPIRY_RANGE,
)
from odoo.addons.liwan_payments.models.refund_policy import (
    COMPANY_POLICIES,
    DEFAULT_AMOUNTS,
    DEFAULT_POLICY,
    REFUND_AMOUNTS,
)

WRITABLE = {'revision', 'unpaid_order_expiry_minutes', 'invoice_when_paid', 'refund_policy', 'refund_amounts'}
CHOICES = {
    'refund_policy': {value for value, _label in COMPANY_POLICIES},
    'refund_amounts': {value for value, _label in REFUND_AMOUNTS},
}


def dump_settings(row, invoice_when_paid):
    """The company's saved settings, or the defaults (revision 0) while it has no row."""
    return {
        'unpaid_order_expiry_minutes': row.unpaid_order_expiry_minutes if row else DEFAULT_EXPIRY_MINUTES,
        'invoice_when_paid': invoice_when_paid,
        'refund_policy': row.refund_policy if row else DEFAULT_POLICY,
        'refund_amounts': row.refund_amounts if row else DEFAULT_AMOUNTS,
        'revision': row.revision if row else 0,
    }


def parse_settings(payload):
    """A PATCH body as ``{'revision': n, 'values': {...}}`` for the company row, plus ``invoice_when_paid`` if sent."""
    unknown = sorted(set(payload) - WRITABLE)
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    parsed = {'revision': revision, 'values': {}}
    if 'unpaid_order_expiry_minutes' in payload:
        minutes = payload['unpaid_order_expiry_minutes']
        low, high = EXPIRY_RANGE
        if type(minutes) is not int or not low <= minutes <= high:
            raise ApiError(422, 'invalid', 'must be a whole number from %d to %d' % EXPIRY_RANGE, field='unpaid_order_expiry_minutes')
        parsed['values']['unpaid_order_expiry_minutes'] = minutes
    for field, choices in CHOICES.items():
        if field in payload:
            if not isinstance(payload[field], str) or payload[field] not in choices:
                raise ApiError(422, 'invalid', 'must be one of %s' % ', '.join(sorted(choices)), field=field)
            parsed['values'][field] = payload[field]
    if 'invoice_when_paid' in payload:
        if type(payload['invoice_when_paid']) is not bool:
            raise ApiError(422, 'invalid', 'must be true or false', field='invoice_when_paid')
        parsed['invoice_when_paid'] = payload['invoice_when_paid']
    return parsed
