# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError


class ReconnectRequired(UserError):
    """The provider no longer honours the stored grant: the administrator must connect the account again."""
