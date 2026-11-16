# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class SaleReport(models.Model):
    """Stock's sales analysis, which Sales reads for its reports, with the source of the order added.

    The two hooks are the ones stock's own bridge modules extend: ``_select_additional_fields`` adds a column to the
    analysis query and ``_group_by_sale`` keeps it in the grouping. No SQL runs outside that query.
    """
    _inherit = 'sale.report'

    # A staff quotation or order, as against an online one (the ``source`` of every Sales shape).
    liwan_staff_document = fields.Boolean(string='Staff document', readonly=True)

    def _select_additional_fields(self):
        return {**super()._select_additional_fields(), 'liwan_staff_document': 's.liwan_staff_document'}

    def _group_by_sale(self):
        return f'{super()._group_by_sale()},\n            s.liwan_staff_document'
