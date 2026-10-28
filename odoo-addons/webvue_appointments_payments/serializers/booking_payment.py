# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_appointments_payments.models.resource_booking_type import (
    DEPOSIT_RANGE,
    ONLINE_PAYMENTS,
)

ONLINE_PAYMENT_OPTIONS = tuple(value for value, _label in ONLINE_PAYMENTS)
TYPE_PAYMENT_FIELDS = {'online_payment', 'deposit_percent', 'price'}


def dump_type_payment(booking_type):
    """How a booking type is paid online. ``price`` is its product's list price (before taxes), null while it has none."""
    product = booking_type._webvue_product()
    return {
        'online_payment': booking_type.webvue_online_payment,
        'deposit_percent': booking_type.webvue_deposit_percent,
        'price': product.list_price if product else None,
        'currency': booking_type.company_id.currency_id.name,
    }


def parse_type_payment(payload):
    """A PATCH body as keyword arguments of ``resource.booking.type._webvue_set_payment``."""
    unknown = sorted(set(payload) - TYPE_PAYMENT_FIELDS)
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    if not payload:
        raise ApiError(422, 'invalid', 'send at least one field', field='online_payment')
    values = {}
    if 'online_payment' in payload:
        if payload['online_payment'] not in ONLINE_PAYMENT_OPTIONS:
            raise ApiError(422, 'invalid', 'choose one of: %s' % ', '.join(ONLINE_PAYMENT_OPTIONS), field='online_payment')
        values['online_payment'] = payload['online_payment']
    if 'deposit_percent' in payload:
        percent = payload['deposit_percent']
        if type(percent) is not int or not DEPOSIT_RANGE[0] <= percent <= DEPOSIT_RANGE[1]:
            raise ApiError(422, 'invalid', 'must be a whole number from %d to %d' % DEPOSIT_RANGE, field='deposit_percent')
        values['deposit_percent'] = percent
    if 'price' in payload:
        price = payload['price']
        if type(price) not in (int, float) or price <= 0:
            raise ApiError(422, 'invalid', 'must be a positive amount', field='price')
        values['price'] = float(price)
    return values


def dump_booking_payment(payment):
    """The payment facts of a booking's online order, or ``status: none`` for a booking without one."""
    if payment is None:
        return {'status': 'none', 'refund_due': False, 'currency': None, 'amount_total': None, 'amount_due': None, 'expires_at': None}
    return {**payment, 'expires_at': iso(payment['expires_at'])}
