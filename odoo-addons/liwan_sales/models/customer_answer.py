# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import LockError, MissingError
from odoo.tools import consteq

from .notification_types import KIND
from .sales_service import QUIET
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MAX_TOKEN_LENGTH = 128


def _refused(code, message):
    raise LiwanAccessRule(code, message, status=422)


class LiwanSalesAnswer(models.AbstractModel):
    """What an anonymous customer may do with one sent quotation once its access token is checked.

    The public routes call ``_liwan_open`` first: it returns the order elevated, so the customer's page, answer and PDF
    all read and write through that one record. Every value of an answer is the server's: the customer chooses only
    between accepting and declining, a signature and a reason.
    """

    _name = 'liwan.sales.answer'
    _description = 'LiwanOS Sales customer answer'

    @api.model
    def _liwan_open(self, order_id, token):
        """The sent staff quotation ``order_id`` behind a valid access token, elevated; every other case is the same 404.

        A missing order, a wrong, non-ASCII or over-long token, an online order, a draft and a quotation never sent are
        indistinguishable. The token is compared in constant time.
        """
        missing = MissingError(self.env._('Record does not exist'))
        if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
            raise missing
        # The customer has no session and no record rule reads for them: the access token is the authorization.
        order = self.env['sale.order'].sudo().browse(order_id).exists()
        # Both sides are compared as UTF-8 bytes: ``consteq`` raises on a non-ASCII ``str``, which would not be a 404.
        if not order or not consteq((order.access_token or '').encode(), token.encode()):
            raise missing
        if not order._liwan_public_open():
            raise missing
        return order.with_company(order.company_id).with_context(**QUIET)

    @api.model
    def _liwan_require_answerable(self, order, accepting):
        """422 ``answer_not_allowed``, ``already_answered`` or, when ``accepting``, ``quotation_expired``.

        The order row is locked and read again first (409 ``conflict`` when another transaction holds it), so two
        simultaneous answers never both pass: the second one sees the first.
        """
        try:
            order.lock_for_update(allow_referencing=True)
        except LockError as error:
            code, message = 'conflict', 'this quotation is being answered right now; try again'
            raise LiwanAccessRule(code, message, status=409) from error
        order.invalidate_recordset()
        if order.liwan_answer_mode == 'none':
            _refused('answer_not_allowed', 'this quotation takes no answer')
        if order.state != 'sent' or order.liwan_answer:
            _refused('already_answered', 'this quotation has already been answered')
        if accepting and order.is_expired:
            _refused('quotation_expired', 'the quotation has expired')

    @api.model
    def _liwan_accept(self, order, signature):
        """Record the acceptance, with ``(signed_by, image, method)`` when the quotation is signed, and confirm the order when
        the snapshot taken at send says acceptance confirms it. Stock's confirmation mail is not sent."""
        now = fields.Datetime.now()
        values = {'liwan_answer': 'accepted', 'liwan_answered_on': now}
        if signature:
            values.update(signed_by=signature[0], signature=signature[1], liwan_signature_method=signature[2], signed_on=now)
        order.write(values)
        if order._liwan_acceptance_confirms():
            self.env['liwan.sales.service']._liwan_move(order, 'confirm')
        self._liwan_notify_salesperson(order, 'signed' if signature else 'accepted')
        return order

    @api.model
    def _liwan_decline(self, order, reason):
        """Record the refusal with its ``reason`` and cancel the quotation, as stock's portal decline does."""
        order.write({'liwan_answer': 'declined', 'liwan_answered_on': fields.Datetime.now(), 'liwan_decline_reason': reason})
        order._action_cancel()
        self._liwan_notify_salesperson(order, 'declined')
        return order

    @api.model
    def _liwan_notify_salesperson(self, order, answer):
        """Put the customer's ``answer`` in the bell of the order's salesperson; an order with none, or whose salesperson
        is archived, notifies nobody. Only the order's number travels, never the customer's name, reason or signature."""
        if not order.user_id.active:
            return
        # The key holds the number of earlier answers of this order, so two deliveries of one answer collapse into one
        # row while a quotation reopened, sent again and answered again rings again.
        prefix = f'{KIND}:{order.id}:'
        answered = order.env['mail.message'].search_count([('liwan_notification_key', '=like', f'{prefix}%')])
        order.env['liwan.notify.service']._liwan_deliver(
            'sale.order', order.id, KIND, order.user_id.partner_id, order.name, key=f'{prefix}{answered}',
            values={'liwan_sales_answer': answer, 'liwan_sales_order_name': order.name},
        )
