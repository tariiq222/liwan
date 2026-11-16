# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import MissingError
from odoo.tools import consteq

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
        """422 ``answer_not_allowed``, ``already_answered`` or, when ``accepting``, ``quotation_expired``."""
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
        return order

    @api.model
    def _liwan_decline(self, order, reason):
        """Record the refusal with its ``reason`` and cancel the quotation, as stock's portal decline does."""
        order.write({'liwan_answer': 'declined', 'liwan_answered_on': fields.Datetime.now(), 'liwan_decline_reason': reason})
        order._action_cancel()
        return order
