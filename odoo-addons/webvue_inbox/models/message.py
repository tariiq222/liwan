# Part of Odoo. See LICENSE file for full copyright and licensing details.
import secrets
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .abstract_interactive import COMMERCE_TYPES
from .constants import MESSAGES_OUT_LIMIT, OUTBOX_CRON, REPLY_PREVIEW_LENGTH
from .template import APPROVED, HEADER_TYPES, MEDIA_HEADERS, PLACEHOLDER
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_inbox.adapters import media_rules

# A status never moves a message backwards (statuses may arrive out of order). `failed` is terminal
# and any other status (deleted, warning, ...) is ignored.
STATE_RANK = {'queued': 0, 'sent': 1, 'delivered': 2, 'read': 3}
ERROR_TEXT_LENGTH = 200
KINDS = [
    ('text', 'Text'), ('image', 'Image'), ('video', 'Video'), ('audio', 'Audio'), ('document', 'Document'),
    ('sticker', 'Sticker'), ('location', 'Location'), ('contacts', 'Contacts'), ('interactive', 'Interactive'),
    ('template', 'Template'), ('flow_response', 'Form answer'), ('product', 'Product'), ('product_list', 'Product list'),
    ('catalog_message', 'Catalog'), ('order', 'Order'), ('unsupported', 'Unsupported'),
]


INVALID = 'invalid'


class WebVueInboxMessage(models.Model):
    """A message of a conversation. Outbound rows in `queued` state are the outbox."""
    _name = 'webvue.inbox.message'
    _inherit = 'webvue.inbox.interactive'
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
    # Sent by the inbox automation (welcome, away, a rule or the survey): such a message has no author.
    automated = fields.Boolean(default=False)
    # An inbound message the automation engine has already evaluated: it is evaluated once.
    automation_done = fields.Boolean(default=False)
    # A template reply keeps the name, language and positional parameters it is sent with (`body` keeps the
    # rendered text), so it never depends on the synchronised template row still existing and is never sent as text.
    template_name = fields.Char()
    template_language = fields.Char()
    template_params = fields.Json()
    template_id = fields.Many2one('webvue.inbox.template', index=True, ondelete='set null')
    # What fills the template's header: a text (here), a file (the message's attachment) or a location (the fields below).
    template_header = fields.Selection(HEADER_TYPES, required=True, default='none')
    template_header_param = fields.Char()
    # The template as it was when sent, so the thread keeps showing it after the template is edited or deleted.
    template_header_text = fields.Char()
    template_footer = fields.Char()
    template_button_ids = fields.One2many('webvue.inbox.message.button', 'message_id')
    provider_message_id = fields.Char(copy=False)
    # Identifies one outbound form message (an interactive form or a template with a form button): the form's answer
    # carries it back. `flow_id` (from the interactive mixin) names the form.
    flow_token = fields.Char(copy=False)
    flow_submission_ids = fields.One2many('webvue.inbox.flow.submission', 'message_id')
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
    # An outbound interactive message: its fields come from the shared interactive mixin; `body` is its body text
    # and `option_ids` its buttons or list rows.
    option_ids = fields.One2many('webvue.inbox.message.option', 'message_id')
    # Commerce: the Meta catalog an outbound product message names or an inbound cart was made from, the product an
    # inbound text was sent from, and the lines of an inbound cart (the bridge turns a cart into an order).
    catalog_id = fields.Char()
    referred_catalog_id = fields.Char()
    referred_retailer_id = fields.Char()
    order_line_ids = fields.One2many('webvue.inbox.message.order.line', 'message_id')
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
    _flow_token_unique = models.UniqueIndex('(flow_token) WHERE flow_token IS NOT NULL', 'A form token is used by one message.')

    @api.model_create_multi
    def create(self, vals_list):
        outbound = sum(1 for vals in vals_list if vals.get('direction') == 'out')
        if outbound:
            self._webvue_require_monthly_room(outbound)
        messages = super().create(vals_list)
        # An agent's reply ends the customer's wait, so the next wait can be alerted again.
        answered = messages.filtered(lambda message: message.direction == 'out' and message.author_id).conversation_id
        answered.filtered('first_response_alerted').first_response_alerted = False
        return messages

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
    def _webvue_queue_automated(self, conversation, values):
        """Queue a free-form reply sent by the automation: marked automated, with no author."""
        return self._webvue_queue_free_form(conversation, {**values, 'automated': True, 'author_id': False})

    @api.model
    def _webvue_post_system_note(self, conversation, body):
        """An internal note written by the automation (no author), explaining what it did."""
        return self.create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id,
            'direction': 'note', 'body': body, 'delivery_state': 'sent',
        })

    @api.model
    def _webvue_queue_template(self, conversation, template, params=(), header=None, button_params=(), extra=None, wake=True):
        """Queue an approved template reply (allowed at any time, also after the window closed).

        `header` holds the validated header input: `text`, `attachment` (an upload of the conversation) or
        `location` (location message values); `button_params` is a list of (button position, value).
        `extra` are message values that replace the defaults (a campaign sends automated, with its header file already
        uploaded as `media_id`, so the file stays the campaign's); `wake=False` leaves waking the outbox to the caller.
        """
        self._webvue_require_sendable(conversation)
        header, extra = header or {}, extra or {}
        values = self._webvue_template_values(conversation, template, params, header, button_params)
        values['business_initiated'] = not self._webvue_window_open(conversation)
        message = self.create(self._webvue_outbound_values(conversation, {**values, **extra}))
        if header.get('attachment') and not extra.get('media_id'):
            header['attachment'].write({'res_model': message._name, 'res_id': message.id})
        if wake:
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
        if values.get('kind') in COMMERCE_TYPES:
            values = self._webvue_prepare_commerce(conversation, values)
        values = {**values, 'reply_to_id': reply_to.id if reply_to else False}
        if values.get('interactive_type') == 'flow':
            self._webvue_require_flow(conversation, self.env['webvue.inbox.flow'].browse(values.get('flow_id')))
            values['flow_token'] = secrets.token_urlsafe(24)
        if attachment:
            values['kind'] = self._webvue_attachment_kind(attachment)
        message = self.create(self._webvue_outbound_values(conversation, values))
        if attachment:
            attachment.write({'res_model': message._name, 'res_id': message.id})
        self._webvue_wake_outbox()
        return message

    @api.model
    def _webvue_require_flow(self, conversation, flow):
        """The form of a message must be a published, unblocked form of the conversation's channel."""
        if not flow._webvue_sendable_in(conversation.channel_id):
            raise ValidationError(self.env._('The form is not a published form of this conversation channel.'))

    def _webvue_prepare_commerce(self, conversation, values):
        """`values` of a commerce message with the channel's catalog id and the product titles snapshotted."""
        channel = conversation.channel_id
        catalog_id = channel._webvue_catalog_id()
        if not catalog_id:
            raise ValidationError(self.env._('No catalog is connected to this channel.'))
        rows = [command[2] for command in values['option_ids']]
        retailer_ids = [row['option_id'] for row in rows]
        self._webvue_check_commerce(channel, retailer_ids)
        titles = self._webvue_commerce_titles(channel, retailer_ids)
        return {
            **values, 'catalog_id': catalog_id,
            'option_ids': [(0, 0, {**row, 'title': titles.get(row['option_id'], row['option_id'])}) for row in rows],
        }

    # Commerce hooks: the neutral answers of an inbox without a product catalog; webvue_inbox_payments overrides them.

    @api.model
    def _webvue_check_commerce(self, channel, retailer_ids):
        """Raise ValidationError unless every retailer id is a product the channel's catalog can send."""

    @api.model
    def _webvue_commerce_titles(self, channel, retailer_ids):
        """{retailer id: the product name} to keep with a sent message."""
        return {retailer_id: retailer_id for retailer_id in retailer_ids}

    @api.model
    def _webvue_commerce_products(self, channel, retailer_ids):
        """{retailer id: the product as the thread shows it now} (the contract's product block); none without a catalog."""
        return {}

    def _webvue_commerce_order_summary(self):
        """The order made from this cart message (the contract's order summary), or None."""
        return

    def _webvue_on_ingested(self):
        """Called once for each inbound message right after it is stored."""

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
            raise WebVueAccessRule(
                INVALID, self.env._('The conversation is closed; reopen it first.'), details={'reason': 'inbox_conversation_closed'},
            )
        if conversation.channel_id.state == 'disabled':
            raise WebVueAccessRule(
                INVALID, self.env._('The channel is disabled.'), details={'reason': 'inbox_channel_disabled'},
            )

    @api.model
    def _webvue_window_open(self, conversation):
        ends = conversation.reply_window_ends_at
        return bool(ends) and fields.Datetime.now() <= ends

    @api.model
    def _webvue_require_window(self, conversation):
        if not self._webvue_window_open(conversation):
            raise WebVueAccessRule(
                INVALID, self.env._('The 24-hour reply window is closed; send an approved template.'),
                details={'reason': 'inbox_window_closed'},
            )

    @api.model
    def _webvue_template_values(self, conversation, template, params, header, button_params):
        if template.channel_id != conversation.channel_id or template.status != APPROVED or not template.supported:
            raise ValidationError(self.env._('The template is not an approved, supported template of this conversation channel.'))
        if len(params) != template.param_count:
            raise ValidationError(self.env._('The template needs %(count)s parameter(s).', count=template.param_count))
        return {
            **self._webvue_template_flow_values(conversation, template),
            'kind': 'template', 'template_id': template.id, 'template_name': template.name,
            'template_language': template.language, 'template_params': list(params),
            'body': template._webvue_render(params),
            **self._webvue_template_header_values(template, header),
            'template_header_text': template._webvue_render_header(header.get('text')) or False,
            'template_footer': template.footer or False,
            'template_button_ids': self._webvue_template_button_commands(template, params, button_params),
        }

    @api.model
    def _webvue_template_flow_values(self, conversation, template):
        """The form and fresh token of a template with a form button; a form WebVue does not know (made in WhatsApp Manager) is sent as it is."""
        button = template.button_ids.filtered(lambda button: button.kind == 'flow')
        if not button:
            return {}
        if button.flow_id:
            self._webvue_require_flow(conversation, button.flow_id)
        return {'flow_id': button.flow_id.id, 'flow_token': secrets.token_urlsafe(24)}

    @api.model
    def _webvue_template_header_values(self, template, header):
        """The header fields of a template reply; the header input must match what the template's header takes."""
        kind = template.header_type
        wanted = {
            'text': kind == 'text' and bool(PLACEHOLDER.search(template.header_text or '')),
            'attachment': kind in MEDIA_HEADERS,
            'location': kind == 'location',
        }
        if {key for key, value in header.items() if value} != {key for key, value in wanted.items() if value}:
            raise ValidationError(self.env._('The header values do not match the template header.'))
        values = {'template_header': kind if any(wanted.values()) else 'none'}
        if header.get('text'):
            values['template_header_param'] = header['text']
        if header.get('attachment'):
            if media_rules.kind_of(header['attachment'].mimetype) != kind:
                raise ValidationError(self.env._('The header file must be %(kind)s.', kind=kind))
            self._webvue_attachment_kind(header['attachment'])
        return {**values, **(header.get('location') or {})}

    @api.model
    def _webvue_template_button_commands(self, template, params, button_params):
        """One row per template button, with the value it is sent with; a one-time-password button takes the code."""
        needs = template._webvue_button_needs()
        given = dict(button_params)
        if len(given) != len(button_params) or set(given) != {position for position, _kind in needs}:
            raise ValidationError(self.env._('The button values do not match the template buttons.'))
        return [
            (0, 0, {
                'position': button.sequence, 'kind': button.kind, 'text': button.text or False,
                'value': params[0] if button.kind == 'otp' else given.get(button.sequence, False),
            })
            for button in template.button_ids.sorted('sequence')
        ]

    def _webvue_retry(self):
        """Queue a failed outbound message again."""
        if self.direction != 'out' or self.delivery_state != 'failed':
            raise ValidationError(self.env._('Only a failed outbound message can be retried.'))
        self._webvue_require_sendable(self.conversation_id)
        if not self.template_name:
            self._webvue_require_window(self.conversation_id)
        self.write({
            'delivery_state': 'queued', 'attempts': 0, 'error': False, 'error_code': False, 'held_for_quality': False,
            'next_attempt_at': fields.Datetime.now(), 'media_id': False,
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
        return ' '.join((self._webvue_caption() or '').split())[:REPLY_PREVIEW_LENGTH]

    def _webvue_location(self):
        return {
            'latitude': self.latitude, 'longitude': self.longitude,
            'name': self.location_name or None, 'address': self.location_address or None,
        }

    @api.model
    def _webvue_apply_status(self, update):
        """Apply a provider status to the outbound message it names; returns that message (empty if unknown)."""
        message = self.search([('provider_message_id', '=', update.provider_id), ('direction', '=', 'out')], limit=1)
        if not message or message.delivery_state == 'failed':
            return message
        if update.status == 'failed':
            message.write({
                'delivery_state': 'failed', 'error': (update.error or '')[:ERROR_TEXT_LENGTH] or False,
                'error_code': update.error_code or False,
            })
            message.campaign_recipient_ids._webvue_on_failed()
        elif STATE_RANK.get(update.status, -1) > STATE_RANK.get(message.delivery_state, -1):
            # Meta has let a held message through once it is sent or delivered.
            message.write({'delivery_state': update.status, **({'held_for_quality': False} if update.status != 'queued' else {})})
        return message
