# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .sale_order import confirm_or_conflict
from .sales_settings import (
    FEATURE,
    parse_payment_mode,
    parse_prepayment_percent,
    payments_open,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_sales.models.sales_service import QUIET


class LiwanSalesService(models.AbstractModel):
    _inherit = 'liwan.sales.service'

    @api.model
    def _liwan_order_parsers(self):
        return {
            **super()._liwan_order_parsers(),
            'payment_to_confirm': parse_payment_mode,
            'prepayment_percent': parse_prepayment_percent,
        }

    @api.model
    def _liwan_write_extras(self, order, extras, creating=False):
        """Set how the quotation asks to be paid: the staff's choice when they made one, else (on create) the tenant's
        default, which is ``off`` while the tenant cannot take payments. A choice other than ``off`` needs online payments."""
        super()._liwan_write_extras(order, extras, creating=creating)
        if not extras and not creating:
            return
        settings = self.env['liwan.sales.settings']._liwan_current()
        mode = extras.get('payment_to_confirm')
        if not mode:
            mode = settings.payment_to_confirm if creating else order._liwan_payment_mode()
        if 'prepayment_percent' in extras:
            percent = extras['prepayment_percent']
        elif not creating and order._liwan_payment_mode() == 'percent':
            percent = order._liwan_payment_percent()
        else:
            # A quotation that did not ask for a part yet takes the tenant's percentage, never the 100 of ``full``.
            percent = settings.prepayment_percent
        if 'prepayment_percent' in extras and mode != 'percent':
            code = 'invalid'
            raise LiwanAccessRule(code, 'the percentage applies only when the customer pays a part', field='prepayment_percent', status=422)
        if mode != 'off':
            if extras:
                self.env['liwan.entitlement.service'].require(FEATURE)
            elif not payments_open(self.env):
                mode = 'off'
        order.with_context(**QUIET).write(self._liwan_payment_values(mode, percent))

    @api.model
    def _liwan_send(self, order_id):
        """Send as Sales does, then confirm the quotation if the money it asks is already on it (a payment that arrived
        after it expired or while it was a draft): the customer who still has to sign confirms it by signing."""
        order = super()._liwan_send(order_id)
        confirm_or_conflict(order)
        return order

    @api.model
    def _liwan_refund(self, order_id, amount, reference):
        """Record ``amount`` refunded at the gateway under ``reference`` for the caller's staff quotation ``order_id``.

        Sales decides who reaches the document (404 unreadable, 403 not theirs to change or not a staff document); the
        payments service checks ``payments.refund`` in the order's company and the amount, and records the refund.
        """
        order = self._liwan_order(order_id)
        self.env['liwan.sales.visibility']._liwan_check_write(order, self.env.user)
        self.env['liwan.payments.service']._liwan_record_refund(order, amount, reference)
        order.invalidate_recordset()
        return order

    @api.model
    def _liwan_payment_values(self, mode, percent):
        """The stock fields that make a quotation ask for ``mode``: all of it, ``percent`` of it, or no payment."""
        if mode == 'off':
            return {'require_payment': False}
        return {'require_payment': True, 'prepayment_percent': 1.0 if mode == 'full' else percent / 100}
