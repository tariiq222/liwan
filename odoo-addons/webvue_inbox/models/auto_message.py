# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

PURPOSES = [('welcome', 'Welcome'), ('away', 'Away'), ('rule', 'Rule reply')]
# What clears the previous content of an automatic message before the new one is written.
CLEARED = {
    'interactive_type': False, 'interactive_header': False, 'interactive_footer': False, 'interactive_button': False,
    'cta_display_text': False, 'cta_url': False, 'flow_id': False, 'flow_cta': False,
}


class WebVueInboxAutoMessage(models.Model):
    """What the automation says: the welcome or away message of a channel, or the reply of a rule."""
    _name = 'webvue.inbox.auto.message'
    _inherit = 'webvue.inbox.interactive'
    _description = 'Customer Inbox automatic message'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', compute='_compute_company', store=True, index=True)
    purpose = fields.Selection(PURPOSES, required=True)
    channel_id = fields.Many2one('webvue.inbox.channel', index=True, ondelete='cascade')
    rule_id = fields.Many2one('webvue.inbox.rule', index=True, ondelete='cascade')
    body = fields.Text(required=True)
    option_ids = fields.One2many('webvue.inbox.auto.option', 'auto_message_id')

    _channel_purpose_unique = models.UniqueIndex(
        '(channel_id, purpose) WHERE channel_id IS NOT NULL', 'A channel has one message per purpose.',
    )
    _rule_unique = models.UniqueIndex('(rule_id) WHERE rule_id IS NOT NULL', 'A rule has one reply.')

    @api.depends('channel_id.owner_company_id', 'rule_id.company_id')
    def _compute_company(self):
        for message in self:
            message.company_id = message.channel_id.owner_company_id or message.rule_id.company_id

    @api.constrains('purpose', 'channel_id', 'rule_id')
    def _check_owner(self):
        for message in self:
            if (message.purpose == 'rule') != bool(message.rule_id) or (message.purpose == 'rule') == bool(message.channel_id):
                raise ValidationError(self.env._('An automatic message belongs to a channel (welcome, away) or to a rule.'))

    @api.model
    def _webvue_upsert(self, existing, owner_values, content):
        """Store `content` (model values: a `body`, plus interactive fields) as the one message of an owner; None removes it."""
        if content is None:
            existing.unlink()
            return self.browse()
        values = {
            **CLEARED, **{key: value for key, value in content.items() if key != 'kind'},
            'option_ids': [(5, 0, 0), *content.get('option_ids', [])],
        }
        if existing:
            existing.write(values)
            return existing
        return self.create({**owner_values, **values})

    def _webvue_message_values(self):
        """The fields of the outbound message that says this."""
        self.ensure_one()
        if not self.interactive_type:
            return {'kind': 'text', 'body': self.body}
        return {
            'kind': 'interactive', 'body': self.body, 'interactive_type': self.interactive_type,
            'interactive_header': self.interactive_header, 'interactive_footer': self.interactive_footer,
            'interactive_button': self.interactive_button, 'cta_display_text': self.cta_display_text,
            'cta_url': self.cta_url, 'flow_id': self.flow_id.id, 'flow_cta': self.flow_cta,
            'option_ids': [(0, 0, {
                'sequence': option.sequence, 'section_title': option.section_title, 'option_id': option.option_id,
                'title': option.title, 'description': option.description,
            }) for option in self.option_ids.sorted('sequence')],
        }

    def _webvue_dump_content(self):
        """The contract's automatic content: `{body}` for text, `{interactive}` for buttons, a list or a link."""
        self.ensure_one()
        return {'interactive': self._webvue_interactive()} if self.interactive_type else {'body': self.body}


class WebVueInboxAutoOption(models.Model):
    """One reply button or list row of an automatic message."""
    _name = 'webvue.inbox.auto.option'
    _inherit = 'webvue.inbox.option'
    _description = 'Customer Inbox automatic message option'
    _webvue_scope = 'company'

    auto_message_id = fields.Many2one('webvue.inbox.auto.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='auto_message_id.company_id', store=True, index=True)
