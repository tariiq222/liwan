# Part of Odoo. See LICENSE file for full copyright and licensing details.
from itertools import groupby

from odoo import fields, models


class WebVueInboxMessageOption(models.Model):
    """One reply button or list row of an outbound interactive message."""
    _name = 'webvue.inbox.message.option'
    _description = 'Customer Inbox interactive option'
    _order = 'sequence, id'
    _webvue_scope = 'company'

    message_id = fields.Many2one('webvue.inbox.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='message_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    section_title = fields.Char()
    option_id = fields.Char(required=True)
    title = fields.Char(required=True)
    description = fields.Char()

    def _webvue_sections(self):
        """The list rows (in sequence) grouped into consecutive sections of the contract shape."""
        return [
            {'title': title or None, 'rows': [
                {'id': row.option_id, 'title': row.title, 'description': row.description or None} for row in rows
            ]}
            for title, rows in ((title, list(rows)) for title, rows in groupby(self, key=lambda row: row.section_title))
        ]
