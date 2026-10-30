# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one representation of interactive WhatsApp content, shared by messages and automatic messages."""
from itertools import groupby

from odoo import fields, models

# The commerce types of `interactive_type`: a catalog product, a list of them or the whole catalog. Their rows are
# the retailer ids (`option_id`); a message of one of these types has the type as its `kind`.
COMMERCE_TYPES = ('product', 'product_list', 'catalog_message')
# The body stored for a single product sent without text (the contract's null body).
NO_PRODUCT_BODY = '[product]'


class WebVueInboxInteractive(models.AbstractModel):
    """Reply buttons, a list or a link button around a `body`. The concrete model has `body` and `option_ids`."""
    _name = 'webvue.inbox.interactive'
    _description = 'Customer Inbox interactive content'
    _webvue_scope = 'global'

    interactive_type = fields.Selection([
        ('buttons', 'Reply buttons'), ('list', 'List'), ('cta_url', 'Link button'), ('flow', 'Form'),
        ('product', 'Product'), ('product_list', 'Product list'), ('catalog_message', 'Catalog'),
    ])
    interactive_header = fields.Char()
    interactive_footer = fields.Char()
    interactive_button = fields.Char()
    cta_display_text = fields.Char()
    cta_url = fields.Char()
    # A form message: the form (set null if it is ever deleted: only unused drafts are) and the text of its opening button.
    flow_id = fields.Many2one('webvue.inbox.flow', index=True, ondelete='set null')
    flow_cta = fields.Char()

    def _webvue_interactive(self):
        """The interactive content in the wire shape of the contract (also what the outbox sends)."""
        self.ensure_one()
        shared = {
            'type': self.interactive_type, 'body': self.body,
            'header': self.interactive_header or None, 'footer': self.interactive_footer or None,
        }
        if self.interactive_type == 'flow':
            return {**shared, 'flow_id': self.flow_id.id, 'cta': self.flow_cta}
        if self.interactive_type == 'cta_url':
            return {**shared, 'display_text': self.cta_display_text, 'url': self.cta_url}
        options = self.option_ids.sorted('sequence')
        if self.interactive_type == 'buttons':
            return {**shared, 'buttons': [{'id': option.option_id, 'title': option.title} for option in options]}
        return {**shared, 'button': self.interactive_button, 'sections': options._webvue_sections()}

    def _webvue_commerce(self):
        """The commerce content (product, product list or catalog) in the wire shape of the contract."""
        self.ensure_one()
        options = self.option_ids.sorted('sequence')
        footer = self.interactive_footer or None
        if self.interactive_type == 'product':
            body = None if self.body == NO_PRODUCT_BODY else self.body
            return {'type': 'product', 'body': body, 'footer': footer, 'product_retailer_id': options[:1].option_id}
        if self.interactive_type == 'catalog_message':
            return {
                'type': 'catalog_message', 'body': self.body, 'footer': footer,
                'thumbnail_product_retailer_id': options[:1].option_id or None,
            }
        return {
            'type': 'product_list', 'header': self.interactive_header, 'body': self.body, 'footer': footer,
            'sections': [
                {'title': title, 'product_retailer_ids': [row.option_id for row in rows]}
                for title, rows in ((title, list(rows)) for title, rows in groupby(options, key=lambda row: row.section_title))
            ],
        }


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
