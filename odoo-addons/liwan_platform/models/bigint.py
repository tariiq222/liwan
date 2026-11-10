# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


class BigInteger(fields.Integer):
    """An exact integer stored as ``int8``, for running totals that must outgrow the 2^31 limit of ``fields.Integer``.

    It is an Integer in every other respect (same ORM type, same values), so no client or serializer changes.
    """
    _column_type = ('int8', 'int8')
