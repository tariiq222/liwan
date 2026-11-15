# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The body that picks the customer a record is linked to (``customerChoiceShape`` in packages/contracts)."""
from odoo.addons.liwan_api.controllers.common import ApiError


def parse_customer_choice(payload):
    """``(customer_id, create_new)`` of a body: an existing customer, a new one, or neither (never both). Other keys
    are the caller's to check."""
    customer_id = payload.get('customer_id')
    if 'customer_id' in payload and (type(customer_id) is not int or customer_id <= 0):
        raise ApiError(422, 'invalid', 'must be a customer id', field='customer_id')
    create_new = payload.get('create_new', False)
    if create_new is not False and create_new is not True:
        raise ApiError(422, 'invalid', 'must be true or false', field='create_new')
    if customer_id is not None and create_new:
        raise ApiError(422, 'invalid', 'name a customer or ask for a new one, not both', field='create_new')
    return customer_id, create_new
