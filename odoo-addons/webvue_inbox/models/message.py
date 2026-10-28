# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .batch import process_each
from .constants import BACKOFF_MINUTES, MAX_ATTEMPTS, MESSAGES_OUT_LIMIT, OUTBOX_BATCH
from .template import APPROVED
from odoo.addons.webvue_inbox.adapters import whatsapp

# A status never moves a message backwards (statuses may arrive out of order). `failed` is terminal
# and any other status (deleted, warning, ...) is ignored.
STATE_RANK = {'queued': 0, 'sent': 1, 'delivered': 2, 'read': 3}
ERROR_TEXT_LENGTH = 200


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
    body = fields.Text(required=True)
    date = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    author_id = fields.Many2one('res.users', ondelete='set null')
    template_id = fields.Many2one('webvue.inbox.template', ondelete='set null')
    # The positional parameters of a template reply; `body` keeps the rendered text.
    template_params = fields.Json()
    provider_message_id = fields.Char(copy=False)
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
    def _webvue_queue_reply(self, conversation, body=None, template=None, params=()):
        """Queue a free-text reply (inside the 24h window) or an approved template reply."""
        self._webvue_require_sendable(conversation)
        values = {
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'author_id': self.env.user.id, 'delivery_state': 'queued', 'next_attempt_at': fields.Datetime.now(),
        }
        if template:
            values.update(self._webvue_template_values(conversation, template, params))
        else:
            values['body'] = self._webvue_free_text(conversation, body)
        return self.create(values)

    @api.model
    def _webvue_require_sendable(self, conversation):
        if conversation.state == 'closed':
            raise ValidationError(self.env._('The conversation is closed; reopen it first.'))
        if conversation.channel_id.state == 'disabled':
            raise ValidationError(self.env._('The channel is disabled.'))

    @api.model
    def _webvue_free_text(self, conversation, body):
        ends = conversation.reply_window_ends_at
        if not ends or fields.Datetime.now() > ends:
            raise ValidationError(self.env._('The 24-hour reply window is closed; send an approved template.'))
        return body

    @api.model
    def _webvue_template_values(self, conversation, template, params):
        if template.channel_id != conversation.channel_id or template.status != APPROVED:
            raise ValidationError(self.env._('The template is not an approved template of this conversation channel.'))
        if len(params) != template.param_count:
            raise ValidationError(self.env._('The template needs %(count)s parameter(s).', count=template.param_count))
        return {'template_id': template.id, 'template_params': list(params), 'body': template._webvue_render(params)}

    def _webvue_retry(self):
        """Queue a failed outbound message again."""
        if self.direction != 'out' or self.delivery_state != 'failed':
            raise ValidationError(self.env._('Only a failed outbound message can be retried.'))
        self._webvue_require_sendable(self.conversation_id)
        if not self.template_id:
            self._webvue_free_text(self.conversation_id, self.body)
        self.write({
            'delivery_state': 'queued', 'attempts': 0, 'error': False, 'next_attempt_at': fields.Datetime.now(),
        })

    # outbox (cron)

    @api.model
    def _webvue_run_outbox(self):
        due = self.search([
            ('direction', '=', 'out'), ('delivery_state', '=', 'queued'),
            ('next_attempt_at', '<=', fields.Datetime.now()),
        ], order='next_attempt_at, id', limit=OUTBOX_BATCH)
        process_each(due, lambda message: message._webvue_deliver(), self._webvue_unexpected_failure)

    @api.model
    def _webvue_unexpected_failure(self, message, error):
        """An error outside the provider contract: counted as one retryable attempt."""
        message._webvue_record_failure(f'unexpected error: {type(error).__name__}', retryable=True)

    def _webvue_deliver(self):
        self._webvue_send()
        self.conversation_id._webvue_notify_bus()

    def _webvue_send(self):
        self.ensure_one()
        conversation = self.conversation_id
        if conversation.channel_id.state == 'disabled':
            self._webvue_record_failure(self.env._('The channel is disabled.'), retryable=False)
            return
        try:
            credentials = conversation.channel_id._webvue_credentials()
            to = conversation.identity_id.address
            if self.template_id:
                provider_id = whatsapp.send_template(
                    credentials, to, self.template_id.name, self.template_id.language, self.template_params or [])
            else:
                provider_id = whatsapp.send_text(credentials, to, self.body)
        except whatsapp.ProviderError as error:
            self._webvue_record_failure(str(error), error.retryable)
        except UserError as error:
            self._webvue_record_failure(str(error), retryable=False)
        else:
            self.write({
                'delivery_state': 'sent', 'provider_message_id': provider_id,
                'attempts': self.attempts + 1, 'error': False,
            })

    def _webvue_record_failure(self, error, retryable):
        attempts = self.attempts + 1
        values = {'attempts': attempts, 'error': error}
        if retryable and attempts < MAX_ATTEMPTS:
            values['next_attempt_at'] = fields.Datetime.now() + relativedelta(minutes=BACKOFF_MINUTES[attempts - 1])
        else:
            values['delivery_state'] = 'failed'
        self.write(values)

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
