# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .constants import MESSAGES_OUT_LIMIT, OUTBOX_CRON, REPLY_PREVIEW_LENGTH
from .template import APPROVED
from odoo.addons.webvue_inbox.adapters import media_rules

# A status never moves a message backwards (statuses may arrive out of order). `failed` is terminal
# and any other status (deleted, warning, ...) is ignored.
STATE_RANK = {'queued': 0, 'sent': 1, 'delivered': 2, 'read': 3}
ERROR_TEXT_LENGTH = 200
KINDS = [
    ('text', 'Text'), ('image', 'Image'), ('video', 'Video'), ('audio', 'Audio'), ('document', 'Document'),
    ('sticker', 'Sticker'), ('location', 'Location'), ('contacts', 'Contacts'), ('interactive', 'Interactive'),
    ('template', 'Template'), ('unsupported', 'Unsupported'),
]


class WebVueInboxMessage(models.Model):
    """A message of a conversation. Outbound rows in `queued` state are the outbox."""
    _name = 'webvue.inbox.message'
    _description = 'Customer Inbox message'
    _order = 'date, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    conversation_id = fields.Many2one('webvue.inbox.conversation', required=True, index=True, ondelete='cascade')
    direction = fields.Selection([('in', 'Inbound'), ('out', 'Outbound'), ('note', 'Internal note')], required=True)
    kind = fields.Selection(KINDS, required=True, default='text')
    # For an outbound file, a caption or, without one, the placeholder `[<kind>]` (see _webvue_caption).
    body = fields.Text(required=True)
    date = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    author_id = fields.Many2one('res.users', ondelete='set null')
    # A template reply keeps the name, language and positional parameters it is sent with (`body` keeps the
    # rendered text), so it never depends on the synchronised template row still existing and is never sent as text.
    template_name = fields.Char()
    template_language = fields.Char()
    template_params = fields.Json()
    provider_message_id = fields.Char(copy=False)
    # The message this one answers (WhatsApp context); always a message of the same conversation.
    reply_to_id = fields.Many2one('webvue.inbox.message', index=True, ondelete='set null')
    # One emoji per side. A reaction the agent set is sent by the outbox while `agent_reaction_pending`.
    customer_reaction = fields.Char()
    agent_reaction = fields.Char()
    agent_reaction_pending = fields.Boolean(default=False, index=True)
    reaction_attempts = fields.Integer(default=0)
    reaction_next_attempt_at = fields.Datetime()
    latitude = fields.Float(digits=(9, 6))
    longitude = fields.Float(digits=(9, 6))
    location_name = fields.Char()
    location_address = fields.Char()
    # An outbound interactive message; `body` is its body text and `option_ids` its buttons or list rows.
    interactive_type = fields.Selection([('buttons', 'Reply buttons'), ('list', 'List'), ('cta_url', 'Link button')])
    interactive_header = fields.Char()
    interactive_footer = fields.Char()
    interactive_button = fields.Char()
    cta_display_text = fields.Char()
    cta_url = fields.Char()
    option_ids = fields.One2many('webvue.inbox.message.option', 'message_id')
    # What the customer chose in answer to an interactive message or template.
    selected_option_id = fields.Char()
    selected_option_title = fields.Char()
    # The WhatsApp media id of an outbound file once uploaded, kept so a retry never uploads it again.
    media_id = fields.Char(copy=False)
    # Read receipt of an inbound message: set to `pending` when an agent opens the conversation.
    read_receipt = fields.Selection([('pending', 'Pending'), ('sent', 'Sent'), ('failed', 'Failed')], copy=False, index=True)
    receipt_attempts = fields.Integer(default=0)
    receipt_next_attempt_at = fields.Datetime()
    delivery_state = fields.Selection(
        [('received', 'Received'), ('queued', 'Queued'), ('sent', 'Sent'),
         ('delivered', 'Delivered'), ('read', 'Read'), ('failed', 'Failed')],
        required=True, default='queued', index=True,
    )
    error = fields.Char()
    attempts = fields.Integer(default=0)
    next_attempt_at = fields.Datetime(index=True)

    _provider_message_unique = models.UniqueIndex(
        '(provider_message_id) WHERE provider_message_id IS NOT NULL',
        'A provider message id is stored once.',
    )

    @api.model_create_multi
    def create(self, vals_list):
        outbound = sum(1 for vals in vals_list if vals.get('direction') == 'out')
        if outbound:
            self._webvue_require_monthly_room(outbound)
        return super().create(vals_list)

    @api.model
    def _webvue_month_start(self):
        return datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    @api.model
    def _webvue_count_outbound_this_month(self):
        """Outbound messages of the whole tenant since the start of this UTC month (a rolling flow, not stock usage)."""
        self.env.cr.execute(
            "SELECT count(*) FROM webvue_inbox_message WHERE direction = 'out' AND create_date >= %s",
            [self._webvue_month_start()],
        )
        return self.env.cr.fetchone()[0]

    @api.model
    def _webvue_require_monthly_room(self, count):
        entitlement = self.env['webvue.entitlement.service']
        if entitlement._webvue_limit_value(MESSAGES_OUT_LIMIT) is not None:
            # An exact cap: writing the quota fence first makes a concurrent sender fail
            # serialization instead of counting from an older snapshot (see webvue.ai.audit).
            entitlement._webvue_profile()._webvue_bump_quota_revision()
        entitlement.require_within_limit(MESSAGES_OUT_LIMIT, self._webvue_count_outbound_this_month() + count)

    # staff writes

    @api.model
    def _webvue_post_note(self, conversation, body):
        return self.create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id,
            'direction': 'note', 'body': body, 'author_id': self.env.user.id, 'delivery_state': 'sent',
        })

    @api.model
    def _webvue_queue_template(self, conversation, template, params=()):
        """Queue an approved template reply (allowed at any time, also after the window closed)."""
        self._webvue_require_sendable(conversation)
        message = self.create(self._webvue_outbound_values(conversation, self._webvue_template_values(conversation, template, params)))
        self._webvue_wake_outbox()
        return message

    @api.model
    def _webvue_queue_free_form(self, conversation, values, reply_to=None, attachment=None):
        """Queue a free-form reply (text, file, location or interactive) inside the 24h window.

        `values` are the message fields of the content (already validated by the controller); a file is
        moved from its upload slot on the conversation to the new message.
        """
        self._webvue_require_sendable(conversation)
        self._webvue_require_window(conversation)
        if reply_to:
            self._webvue_require_reply_target(conversation, reply_to)
        values = {**values, 'reply_to_id': reply_to.id if reply_to else False}
        if attachment:
            values['kind'] = self._webvue_attachment_kind(attachment)
        message = self.create(self._webvue_outbound_values(conversation, values))
        if attachment:
            attachment.write({'res_model': message._name, 'res_id': message.id})
        self._webvue_wake_outbox()
        return message

    @api.model
    def _webvue_wake_outbox(self):
        """Ask the cron worker to run the outbox now, so queued work leaves within seconds, not at the next minute."""
        cron_id = self.env['ir.model.data']._xmlid_to_res_id(OUTBOX_CRON)
        self.env['ir.cron'].browse(cron_id)._trigger()

    @api.model
    def _webvue_outbound_values(self, conversation, values):
        return {
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'author_id': self.env.user.id, 'delivery_state': 'queued', 'next_attempt_at': fields.Datetime.now(),
            **values,
        }

    @api.model
    def _webvue_attachment_kind(self, attachment):
        """The WhatsApp kind of an uploaded file; the type and size are checked again here."""
        kind = media_rules.kind_of(attachment.mimetype)
        if not kind or attachment.file_size > media_rules.limit_of(kind):
            raise ValidationError(self.env._('The file cannot be sent over WhatsApp.'))
        return kind

    @api.model
    def _webvue_require_reply_target(self, conversation, target):
        if target.conversation_id != conversation or target.direction == 'note':
            raise ValidationError(self.env._('The message to reply to is not in this conversation.'))
        if not target.provider_message_id:
            raise ValidationError(self.env._('The message to reply to has not been delivered yet.'))

    @api.model
    def _webvue_require_sendable(self, conversation):
        if conversation.state == 'closed':
            raise ValidationError(self.env._('The conversation is closed; reopen it first.'))
        if conversation.channel_id.state == 'disabled':
            raise ValidationError(self.env._('The channel is disabled.'))

    @api.model
    def _webvue_require_window(self, conversation):
        ends = conversation.reply_window_ends_at
        if not ends or fields.Datetime.now() > ends:
            raise ValidationError(self.env._('The 24-hour reply window is closed; send an approved template.'))

    @api.model
    def _webvue_template_values(self, conversation, template, params):
        if template.channel_id != conversation.channel_id or template.status != APPROVED:
            raise ValidationError(self.env._('The template is not an approved template of this conversation channel.'))
        if len(params) != template.param_count:
            raise ValidationError(self.env._('The template needs %(count)s parameter(s).', count=template.param_count))
        return {
            'kind': 'template', 'template_name': template.name, 'template_language': template.language,
            'template_params': list(params), 'body': template._webvue_render(params),
        }

    def _webvue_retry(self):
        """Queue a failed outbound message again."""
        if self.direction != 'out' or self.delivery_state != 'failed':
            raise ValidationError(self.env._('Only a failed outbound message can be retried.'))
        self._webvue_require_sendable(self.conversation_id)
        if not self.template_name:
            self._webvue_require_window(self.conversation_id)
        self.write({
            'delivery_state': 'queued', 'attempts': 0, 'error': False, 'next_attempt_at': fields.Datetime.now(),
            'media_id': False,
        })
        self._webvue_wake_outbox()

    def _webvue_react(self, emoji):
        """Set (or, with an empty emoji, remove) the agent's reaction; the outbox sends it."""
        self.ensure_one()
        conversation = self.conversation_id
        if self.direction == 'note' or not self.provider_message_id:
            raise ValidationError(self.env._('Only a delivered message can be reacted to.'))
        self._webvue_require_sendable(conversation)
        self._webvue_require_window(conversation)
        if (self.agent_reaction or '') != emoji or self.agent_reaction_pending:
            self.write({'agent_reaction': emoji or False, 'agent_reaction_pending': True, 'reaction_attempts': 0,
                        'reaction_next_attempt_at': False})
            self._webvue_wake_outbox()

    def _webvue_request_read_receipt(self):
        """Queue the read receipt of this inbound message unless one was already queued or sent."""
        if self.direction == 'in' and self.provider_message_id and not self.read_receipt:
            self.read_receipt = 'pending'
            self._webvue_wake_outbox()

    # content

    def _webvue_caption(self):
        """The caption of an outbound file: its body unless that is the placeholder stored for no caption."""
        return False if self.body == f'[{self.kind}]' else self.body

    def _webvue_reply_preview(self):
        return ' '.join(self.body.split())[:REPLY_PREVIEW_LENGTH]

    def _webvue_location(self):
        return {
            'latitude': self.latitude, 'longitude': self.longitude,
            'name': self.location_name or None, 'address': self.location_address or None,
        }

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

    @api.model
    def _webvue_apply_status(self, update):
        """Apply a provider status to the outbound message it names; returns that message (empty if unknown)."""
        message = self.search([('provider_message_id', '=', update.provider_id), ('direction', '=', 'out')], limit=1)
        if not message or message.delivery_state == 'failed':
            return message
        if update.status == 'failed':
            message.write({'delivery_state': 'failed', 'error': (update.error or '')[:ERROR_TEXT_LENGTH] or False})
        elif STATE_RANK.get(update.status, -1) > STATE_RANK.get(message.delivery_state, -1):
            message.write({'delivery_state': update.status})
        return message
