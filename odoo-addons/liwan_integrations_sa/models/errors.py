# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError, ValidationError


class ReconnectRequired(UserError):
    """The provider no longer honours the stored grant: the administrator must connect the account again."""


class AccountTaken(ValidationError):
    """An exclusive provider's account is already connected in another company of this database."""
