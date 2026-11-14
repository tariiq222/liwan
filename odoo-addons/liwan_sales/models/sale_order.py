# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .access_service import DOCUMENTS_ASSIGN, ORDERS_CONFIRM, QUOTATIONS_MANAGE
from odoo.addons.liwan_products.models.products_service import MAX_QUANTITY

# The wire kind of each stock display type; a subsection is reported as a section.
LINE_KINDS = {False: 'product', 'line_section': 'section', 'line_subsection': 'section', 'line_note': 'note'}
# The stock states of a quotation: `sent` is one, though no Sales route produces it yet.
QUOTATION_STATES = ('draft', 'sent')
QUANTITY_BOUNDS = f'quantity must be a number greater than zero, at most {MAX_QUANTITY}'
DISCOUNT_BOUNDS = 'discount_percent must be a number from 0 to 100'


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def valid_quantity(value):
    """Whether ``value`` is a quantity a Sales line may carry (``QUANTITY_BOUNDS``)."""
    return _is_number(value) and 0 < value <= MAX_QUANTITY


def valid_discount(value):
    """Whether ``value`` is a discount percent a Sales line may carry (``DISCOUNT_BOUNDS``)."""
    return _is_number(value) and 0 <= value <= 100


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    # Set by the Sales service on create: a document a member of staff wrote, as opposed to an online order. Every
    # Sales write refuses a document without it.
    liwan_staff_document = fields.Boolean(readonly=True, copy=False, index=True)

    def _liwan_actions(self, user):
        """What ``user`` may do with this order now: the state table of the Sales plan (D1), in one place.

        Every action but ``duplicate`` needs a staff document that the user owns or may assign. The routes of a
        transition authorise it with this answer.
        """
        self.ensure_one()
        keys = self.env['liwan.sales.visibility']._liwan_keys(user, self.company_id)
        manage = QUOTATIONS_MANAGE in keys
        confirm = ORDERS_CONFIRM in keys
        assign = DOCUMENTS_ASSIGN in keys
        mine = self.liwan_staff_document and (self.user_id == user or assign)
        quotation = self.state in QUOTATION_STATES
        confirmed = self.state == 'sale'
        return {
            'edit': bool(mine and manage and self.state == 'draft'),
            'confirm': bool(mine and confirm and quotation),
            'cancel': bool(mine and ((quotation and manage) or (confirmed and not self.locked and confirm))),
            'reopen': bool(mine and confirm and self.state == 'cancel'),
            'lock': bool(mine and confirm and confirmed and not self.locked),
            'unlock': bool(mine and confirm and confirmed and self.locked),
            'duplicate': manage,
            'assign': bool(self.liwan_staff_document and assign),
        }
