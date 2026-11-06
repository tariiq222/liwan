# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A TikTok channel's suggested questions and chat prompts, mirrored to TikTok with their audit status.

TikTok holds the items of one account: at most three suggested questions and six chat prompts, each
reviewed by TikTok. LiwanOS keeps the record the administrator edits and creates, updates or deletes
the matching TikTok item, keeping its `provider_id` and audit status.
"""
from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .channel import INVALID
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.adapters import errors, tiktok

# The TikTok auto-message type of each kind, the channel switch that enables it and TikTok's audit answer.
AUTO_TYPES = {'question': 'SUGGESTED_QUESTION', 'prompt': 'CHAT_PROMPT'}
ENABLED_FIELDS = {'question': 'tiktok_questions_enabled', 'prompt': 'tiktok_prompts_enabled'}
AUDIT_STATUSES = {'REVIEWING': 'reviewing', 'APPROVED': 'approved', 'REJECTED': 'rejected'}
LIMITS = {'question': tiktok.MAX_QUESTIONS, 'prompt': tiktok.MAX_PROMPTS}
# The columns an administrator edits; a TikTok item under review refuses them (TikTok refuses the update).
CONTENT_FIELDS = ('question', 'answer', 'title', 'content')
ERROR_TEXT_LENGTH = 200


class LiwanInboxTikTokShortcut(models.Model):
    """One suggested question or chat prompt of a TikTok channel."""
    _name = 'liwan.inbox.tiktok.shortcut'
    _description = 'Customer Inbox TikTok suggested question or chat prompt'
    _order = 'kind, sequence, id'
    _liwan_scope = 'company'

    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', related='channel_id.owner_company_id', store=True, index=True)
    kind = fields.Selection([('question', 'Suggested question'), ('prompt', 'Chat prompt')], required=True)
    sequence = fields.Integer(default=10)
    # A suggested question: its question and its preset answer.
    question = fields.Char()
    answer = fields.Char()
    # A chat prompt: the title of its button and the question it writes for the customer.
    title = fields.Char()
    content = fields.Char()
    provider_id = fields.Char(copy=False)
    audit = fields.Selection(
        [('draft', 'Draft'), ('reviewing', 'Reviewing'), ('approved', 'Approved'), ('rejected', 'Rejected')],
        required=True, default='draft', copy=False,
    )
    sync_error = fields.Char(copy=False)

    @api.constrains('kind', 'question', 'answer', 'title', 'content')
    def _check_content(self):
        for shortcut in self:
            valid = (
                shortcut.question and shortcut.answer and not shortcut.title and not shortcut.content
                and len(shortcut.question) <= tiktok.QUESTION_MAX and len(shortcut.answer) <= tiktok.ANSWER_MAX
            ) if shortcut.kind == 'question' else (
                shortcut.title and shortcut.content and not shortcut.question and not shortcut.answer
                and len(shortcut.title) <= tiktok.PROMPT_TITLE_MAX and len(shortcut.content) <= tiktok.PROMPT_CONTENT_MAX
            )
            if not valid:
                raise ValidationError(self.env._(
                    'A suggested question needs a question of at most %(question)s characters and an answer of at most '
                    '%(answer)s; a chat prompt needs a title of at most %(title)s characters and content of at most %(content)s.',
                    question=tiktok.QUESTION_MAX, answer=tiktok.ANSWER_MAX,
                    title=tiktok.PROMPT_TITLE_MAX, content=tiktok.PROMPT_CONTENT_MAX,
                ))

    @api.constrains('kind', 'channel_id')
    def _check_kind_limit(self):
        for shortcut in self:
            limit = LIMITS[shortcut.kind]
            if self.search_count([('channel_id', '=', shortcut.channel_id.id), ('kind', '=', shortcut.kind)]) > limit:
                raise LiwanAccessRule(
                    INVALID, self.env._('TikTok allows at most %(count)s items of this kind per account.', count=limit),
                    details={'reason': 'inbox_tiktok_auto_message_limit'},
                )

    def write(self, vals):
        if any(name in vals for name in CONTENT_FIELDS) and self.filtered(lambda shortcut: shortcut.audit == 'reviewing'):
            raise LiwanAccessRule(
                INVALID, self.env._('This item is under TikTok review; it cannot be edited until TikTok answers.'),
                details={'reason': 'inbox_tiktok_auto_message_reviewing'},
            )
        return super().write(vals)

    def unlink(self):
        for shortcut in self.filtered('provider_id'):
            try:
                tiktok.delete_auto_message(
                    shortcut.channel_id._liwan_credentials(), AUTO_TYPES[shortcut.kind], shortcut.provider_id,
                )
            except errors.ProviderError as error:
                raise UserError(str(error)) from error
        return super().unlink()

    def _liwan_tiktok_content(self):
        """The item as TikTok's create and update calls take it."""
        self.ensure_one()
        if self.kind == 'question':
            return {'suggested_question': {'question': self.question, 'answer': self.answer}}
        return {'chat_prompt': {'title': self.title, 'content': self.content}}

    def _liwan_push(self):
        """Create or update the item at TikTok; a refusal is kept on the row so the administrator can retry."""
        self.ensure_one()
        auto_type = AUTO_TYPES[self.kind]
        try:
            credentials = self.channel_id._liwan_credentials()
            content = self._liwan_tiktok_content()
            if self.provider_id:
                tiktok.update_auto_message(credentials, auto_type, self.provider_id, content)
            else:
                self.provider_id = tiktok.create_auto_message(credentials, auto_type, content)
        except errors.ProviderError as error:
            self.sync_error = str(error)[:ERROR_TEXT_LENGTH]
            return False
        self.write({'audit': 'reviewing', 'sync_error': False})
        return True
