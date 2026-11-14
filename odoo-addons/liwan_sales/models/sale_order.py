# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .access_service import DOCUMENTS_ASSIGN, ORDERS_CONFIRM, QUOTATIONS_MANAGE


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
        draft = self.state == 'draft'
        confirmed = self.state == 'sale'
        return {
            'edit': bool(mine and manage and draft),
            'confirm': bool(mine and confirm and draft),
            'cancel': bool(mine and ((draft and manage) or (confirmed and not self.locked and confirm))),
            'reopen': bool(mine and confirm and self.state == 'cancel'),
            'lock': bool(mine and confirm and confirmed and not self.locked),
            'unlock': bool(mine and confirm and confirmed and self.locked),
            'duplicate': manage,
            'assign': bool(self.liwan_staff_document and assign),
        }
