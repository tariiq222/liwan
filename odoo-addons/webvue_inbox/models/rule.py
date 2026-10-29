# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .normalization import normalize_text, word_tokens

MATCH_KINDS = [
    ('any', 'Any message'), ('contains', 'Contains'), ('exact', 'Exact'), ('starts_with', 'Starts with'),
    ('option', 'Chosen option'), ('order', 'Cart order'),
]
HOURS_CONDITIONS = [('any', 'Any time'), ('inside', 'Inside working hours'), ('outside', 'Outside working hours')]
PRIORITIES = [('low', 'Low'), ('normal', 'Normal'), ('high', 'High'), ('urgent', 'Urgent')]
TEXT_MATCHERS = {
    # Whole words or phrases, so "لا" does not match inside "السلام".
    'contains': lambda keyword, text: f' {word_tokens(keyword)} ' in f' {word_tokens(text)} ',
    'exact': lambda keyword, text: keyword == text,
    'starts_with': lambda keyword, text: text.startswith(keyword),
}
# The message kinds whose text a keyword can match: a typed text, or the title of the chosen option.
TEXT_KINDS = ('text', 'interactive')


class WebVueInboxRule(models.Model):
    """An ordered automation rule: when an inbound message matches, reply and/or act on the conversation."""
    _name = 'webvue.inbox.rule'
    _description = 'Customer Inbox automation rule'
    _order = 'sequence, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    name = fields.Char(required=True)
    channel_id = fields.Many2one('webvue.inbox.channel', index=True, ondelete='cascade')
    match_kind = fields.Selection(MATCH_KINDS, required=True, default='contains')
    keyword_ids = fields.One2many('webvue.inbox.rule.keyword', 'rule_id')
    option_id = fields.Char()
    hours_condition = fields.Selection(HOURS_CONDITIONS, required=True, default='any')
    stop = fields.Boolean(default=True)
    reply_ids = fields.One2many('webvue.inbox.auto.message', 'rule_id')
    department_id = fields.Many2one('webvue.inbox.department', ondelete='set null')
    assignee_id = fields.Many2one('res.users', ondelete='set null')
    tag_ids = fields.Many2many('webvue.inbox.tag', 'webvue_inbox_rule_tag_rel', 'rule_id', 'tag_id')
    priority = fields.Selection(PRIORITIES)
    resolve = fields.Boolean(default=False)

    def _webvue_set_reply(self, content):
        """Store the reply of the rule (model values; None removes it)."""
        self.ensure_one()
        self.env['webvue.inbox.auto.message']._webvue_upsert(
            self.reply_ids, {'purpose': 'rule', 'rule_id': self.id}, content,
        )

    def _webvue_matches(self, text, option_id, inside, is_order=False):
        """Whether the rule fires for an inbound message with this text (None for a file or location), chosen option and cart."""
        self.ensure_one()
        if self.hours_condition != 'any' and (self.hours_condition == 'inside') != inside:
            return False
        if self.match_kind == 'any':
            return True
        if self.match_kind == 'order':
            return is_order
        if self.match_kind == 'option':
            return option_id is not None and option_id == self.option_id
        if text is None:
            return False
        matcher, normalized = TEXT_MATCHERS[self.match_kind], normalize_text(text)
        return any(matcher(keyword.normalized, normalized) for keyword in self.keyword_ids if word_tokens(keyword.value))

    @api.model
    def _webvue_triggered(self, channel, text, option_id, inside, is_order=False):
        """The rules (in order) that fire for a message on `channel`, up to and including the first one that stops."""
        triggered = self.browse()
        rules = self.search([
            ('company_id', '=', channel.owner_company_id.id), '|', ('channel_id', '=', False), ('channel_id', '=', channel.id),
        ])
        for rule in rules:
            if rule._webvue_matches(text, option_id, inside, is_order):
                triggered |= rule
                if rule.stop:
                    break
        return triggered


class WebVueInboxRuleKeyword(models.Model):
    """A word or phrase of a rule, kept with its normalized form (what the inbound text is compared with)."""
    _name = 'webvue.inbox.rule.keyword'
    _description = 'Customer Inbox rule keyword'
    _order = 'id'
    _webvue_scope = 'company'

    rule_id = fields.Many2one('webvue.inbox.rule', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='rule_id.company_id', store=True, index=True)
    value = fields.Char(required=True)
    normalized = fields.Char(compute='_compute_normalized', store=True)

    @api.depends('value')
    def _compute_normalized(self):
        for keyword in self:
            keyword.normalized = normalize_text(keyword.value)

    @api.constrains('value')
    def _check_words(self):
        if any(not word_tokens(keyword.value) for keyword in self):
            raise ValidationError(self.env._('A keyword needs at least one letter or digit.'))
