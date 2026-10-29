# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one representation of interactive WhatsApp content, shared by messages and automatic messages."""
from itertools import groupby

from odoo import fields, models


class WebVueInboxInteractive(models.AbstractModel):
    """Reply buttons, a list or a link button around a `body`. The concrete model has `body` and `option_ids`."""
    _name = 'webvue.inbox.interactive'
    _description = 'Customer Inbox interactive content'
    _webvue_scope = 'global'

    interactive_type = fields.Selection([('buttons', 'Reply buttons'), ('list', 'List'), ('cta_url', 'Link button')])
    interactive_header = fields.Char()
    interactive_footer = fields.Char()
    interactive_button = fields.Char()
    cta_display_text = fields.Char()
    cta_url = fields.Char()

    def _webvue_interactive(self):
        """The interactive content in the wire shape of the contract (also what the outbox sends)."""
        self.ensure_one()
        shared = {
            'type': self.interactive_type, 'body': self.body,
            'header': self.interactive_header or None, 'footer': self.interactive_footer or None,
        }
        if self.interactive_type == 'cta_url':
            return {**shared, 'display_text': self.cta_display_text, 'url': self.cta_url}
        options = self.option_ids.sorted('sequence')
        if self.interactive_type == 'buttons':
            return {**shared, 'buttons': [{'id': option.option_id, 'title': option.title} for option in options]}
        return {**shared, 'button': self.interactive_button, 'sections': options._webvue_sections()}


class WebVueInboxOption(models.AbstractModel):
    """One reply button or list row of interactive content."""
    _name = 'webvue.inbox.option'
    _description = 'Customer Inbox interactive option'
    _order = 'sequence, id'
    _webvue_scope = 'global'

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
