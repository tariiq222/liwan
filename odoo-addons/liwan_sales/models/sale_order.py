# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .access_service import DOCUMENTS_ASSIGN, ORDERS_CONFIRM, QUOTATIONS_MANAGE
from .sales_settings import ANSWER_MODES
from odoo.addons.liwan_products.models.products_service import is_number

# The wire kind of each stock display type; a subsection is reported as a section.
LINE_KINDS = {False: 'product', 'line_section': 'section', 'line_subsection': 'section', 'line_note': 'note'}
# The stock states of a quotation.
QUOTATION_STATES = ('draft', 'sent')
# The values a send and a reopen write to leave no answer, snapshot or signature of an earlier send on the order.
ANSWER_RESET = {
    'liwan_answer_mode': False,
    'liwan_acceptance_confirms': False,
    'liwan_answer': False,
    'liwan_answered_on': False,
    'liwan_decline_reason': False,
    'require_signature': False,
    'signature': False,
    'signed_by': False,
    'signed_on': False,
}
DISCOUNT_BOUNDS = 'discount_percent must be a number from 0 to 100'


def valid_discount(value):
    """Whether ``value`` is a discount percent a Sales line may carry (``DISCOUNT_BOUNDS``)."""
    return is_number(value) and 0 <= value <= 100


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    # Set by the Sales service on create: a document a member of staff wrote, as opposed to an online order. Every
    # Sales write refuses a document without it.
    liwan_staff_document = fields.Boolean(readonly=True, copy=False, index=True)
    # Set when the quotation is sent, from the tenant's settings of that moment (a later change does not touch it):
    # what the customer may do on the public page, and whether accepting confirms the order. Empty before the first send.
    liwan_answer_mode = fields.Selection([(mode, mode) for mode in ANSWER_MODES], readonly=True, copy=False)
    liwan_acceptance_confirms = fields.Boolean(readonly=True, copy=False)
    # The customer's answer on the public page; the signature itself is stock's `signature`, `signed_by` and `signed_on`.
    liwan_answer = fields.Selection([('accepted', 'accepted'), ('declined', 'declined')], readonly=True, copy=False)
    liwan_answered_on = fields.Datetime(readonly=True, copy=False)
    liwan_decline_reason = fields.Text(readonly=True, copy=False)

    def _liwan_can_answer(self):
        """Whether the customer may still answer this sent quotation: an answer mode other than ``none``, no answer yet."""
        self.ensure_one()
        return bool(self.liwan_answer_mode not in (False, 'none') and self.state == 'sent' and not self.liwan_answer)

    def _liwan_can_accept(self):
        """Whether the customer may accept: they may answer and the quotation has not expired. Declining stays open."""
        return self._liwan_can_answer() and not self.is_expired

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
        open_quotation = quotation and not self.is_expired
        confirmed = self.state == 'sale'
        return {
            'edit': bool(mine and manage and self.state == 'draft'),
            'send': bool(mine and manage and open_quotation),
            'confirm': bool(mine and confirm and open_quotation),
            'cancel': bool(mine and ((quotation and manage) or (confirmed and not self.locked and confirm))),
            'reopen': bool(mine and confirm and self.state in ('cancel', 'sent')),
            'lock': bool(mine and confirm and confirmed and not self.locked),
            'unlock': bool(mine and confirm and confirmed and self.locked),
            'duplicate': manage,
            'assign': bool(self.liwan_staff_document and assign),
        }
