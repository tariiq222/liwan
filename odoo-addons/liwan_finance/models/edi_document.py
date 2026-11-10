# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class AccountEdiDocument(models.Model):
    _inherit = 'account.edi.document'

    # Written only by the manual ZATCA send (models/zatca_service.py), which spaces and counts the retries.
    liwan_zatca_retry_count = fields.Integer(string='Manual ZATCA retries', default=0, readonly=True, copy=False)
    liwan_zatca_last_attempt_at = fields.Datetime(string='Last manual ZATCA send', readonly=True, copy=False)
