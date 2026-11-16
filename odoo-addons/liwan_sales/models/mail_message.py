# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .notification_types import ANSWERS, KIND


class LiwanSalesMailMessage(models.Model):
    _inherit = 'mail.message'

    # The Sales kind (registered in models/notification_types.py). A bell row points at its order through the message's
    # own model and res_id; the answer and the order's number are what the UI words the title from.
    liwan_notification_kind = fields.Selection(selection_add=[(KIND, 'Quotation answered')])
    liwan_sales_answer = fields.Selection(ANSWERS, copy=False)
    liwan_sales_order_name = fields.Char(copy=False)
