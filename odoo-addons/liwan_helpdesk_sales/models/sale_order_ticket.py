# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class SaleOrderTicket(models.Model):
    _inherit = 'sale.order'

    # The support ticket this quotation bills for. Archiving or deleting the ticket leaves the quotation: it is a
    # commercial document of the sales application and stands on its own.
    helpdesk_ticket_id = fields.Many2one(
        'helpdesk.ticket', string='Support ticket', index='btree_not_null', ondelete='set null', copy=False,
    )
