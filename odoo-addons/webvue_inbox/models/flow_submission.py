# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A customer's completed form: a submission, its typed answers and the choices of a multi-select."""
from datetime import date

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .constants import FLOWS_FEATURE, REPLY_WINDOW
from .flow import FIELD_KINDS, INPUT_KINDS

MAX_TEXT = 4096
MAX_UNKNOWN_KEY = 64
MAX_UNKNOWN_ANSWERS = 100
UNKNOWN = 'unknown'
ANSWER_KINDS = [item for item in FIELD_KINDS if item[0] in INPUT_KINDS] + [(UNKNOWN, 'Unknown')]
FALLBACK_BODY = 'نموذج'
NOTE_IGNORED = 'النموذج «%s»: تُجوهلت إجابات غير صالحة: %s'
NOTE_COMPLETION = 'رد آلي: رسالة إتمام النموذج «%s»'
NOTE_COMPLETION_STALE = 'لم تُرسل رسالة إتمام النموذج «%s» لأن الإجابة وصلت متأخرة'


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _text_value(field, value):
    """The text of a text input: a string (a number too for a number input), at most MAX_TEXT characters."""
    if _is_number(value) and field.input_type == 'number':
        value = str(value)
    return value if isinstance(value, str) and len(value) <= MAX_TEXT else None


def _date_value(value):
    try:
        return date.fromisoformat(value).isoformat() if isinstance(value, str) and len(value) == 10 else None
    except ValueError:
        return None


class WebVueInboxFlowSubmission(models.Model):
    _name = 'webvue.inbox.flow.submission'
    _description = 'Customer Inbox form submission'
    _order = 'submitted_at desc, id desc'
    _webvue_scope = 'company'

    conversation_id = fields.Many2one('webvue.inbox.conversation', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='conversation_id.company_id', store=True, index=True)
    # Null when the answer could not be tied to a known form.
    flow_id = fields.Many2one('webvue.inbox.flow', index=True, ondelete='set null')
    request_message_id = fields.Many2one('webvue.inbox.message', ondelete='set null')
    message_id = fields.Many2one('webvue.inbox.message', required=True, ondelete='cascade')
    submitted_at = fields.Datetime(required=True)
    answer_ids = fields.One2many('webvue.inbox.flow.answer', 'submission_id')

    _message_unique = models.Constraint('UNIQUE(message_id)', 'A form answer message has one submission.')

    @api.model
    def _webvue_receive(self, channel, conversation, message, response, context_id):
        """Store the answers of an inbound `flow_response` message, say the completion message and name the message after the form."""
        request = self._webvue_request(channel, conversation, response.flow_token, context_id)
        flow = request.flow_id
        answers, ignored = self._webvue_answers(flow, response.values)
        self.create({
            'conversation_id': conversation.id, 'flow_id': flow.id, 'request_message_id': request.id,
            'message_id': message.id, 'submitted_at': message.date, 'answer_ids': answers,
        })
        message.body = flow.name or FALLBACK_BODY
        Message = self.env['webvue.inbox.message']
        if ignored:
            Message._webvue_post_system_note(conversation, NOTE_IGNORED % (flow.name, '، '.join(ignored)))
        if flow.completion_message and self.env['webvue.entitlement.service']._webvue_feature_write(FLOWS_FEATURE):
            if fields.Datetime.now() - message.date > REPLY_WINDOW:
                Message._webvue_post_system_note(conversation, NOTE_COMPLETION_STALE % flow.name)  # a late delivery is never answered
            else:
                self.env['webvue.inbox.automation']._webvue_send(conversation, message, flow, NOTE_COMPLETION % flow.name)

    @api.model
    def _webvue_request(self, channel, conversation, token, context_id):
        """The outbound message that carried the form: by our token, else by the message this one answers (same customer and channel)."""
        Message = self.env['webvue.inbox.message']
        scope = [
            ('direction', '=', 'out'), ('conversation_id.channel_id', '=', channel.id),
            ('conversation_id.identity_id', '=', conversation.identity_id.id),
        ]
        request = Message.search([*scope, ('flow_token', '=', token)], limit=1) if token else Message.browse()
        if not request and context_id:
            request = Message.search([*scope, ('provider_message_id', '=', context_id)], limit=1)
        return request

    @api.model
    def _webvue_answers(self, flow, values):
        """(o2m create commands, the keys that were ignored) of the answers of `values`."""
        if not (flow and flow.supported):
            return self._webvue_unknown_answers(values), []
        rows, ignored = [], []
        for field in flow._webvue_input_fields():
            if field.key not in values or (not field.required and values[field.key] in ('', [], None)):
                continue
            row = self._webvue_answer(field, values[field.key])
            if row is None:
                ignored.append(field.key)
                continue
            rows.append((0, 0, {'sequence': len(rows), 'field_id': field.id, 'key': field.key, 'label': field.label, **row}))
        return rows, ignored

    @api.model
    def _webvue_answer(self, field, value):
        """The answer columns of `value` for `field`, or None when the value is not valid for the field."""
        kind = field.kind
        if kind in ('text_input', 'text_area'):
            text = _text_value(field, value)
            return None if text is None else {'kind': kind, 'value_text': text}
        if kind == 'date':
            day = _date_value(value)
            return None if day is None else {'kind': kind, 'value_date': day}
        if kind == 'opt_in':
            return {'kind': kind, 'value_boolean': value} if isinstance(value, bool) else None
        chosen = value if kind == 'checkbox' else [value]
        titles = {option.key: option.title for option in field.option_ids}
        valid = isinstance(chosen, list) and all(isinstance(key, str) and key in titles for key in chosen) and len(set(chosen)) == len(chosen)
        if not valid or (kind != 'checkbox' and len(chosen) != 1):
            return None
        order = list(titles)
        return {'kind': kind, 'choice_ids': [
            (0, 0, {'sequence': position, 'key': key, 'title': titles[key]})
            for position, key in enumerate(sorted(chosen, key=order.index))
        ]}

    @api.model
    def _webvue_unknown_answers(self, values):
        """Every scalar or list-of-strings value of a form WebVue cannot read, as a text answer."""
        rows = []
        for key, value in values.items():
            if len(rows) >= MAX_UNKNOWN_ANSWERS:
                break
            text = self._webvue_unknown_text(value)
            if text is not None and 0 < len(key) <= MAX_UNKNOWN_KEY:
                rows.append((0, 0, {'sequence': len(rows), 'key': key, 'label': key, 'kind': UNKNOWN, 'value_text': text[:MAX_TEXT]}))
        return rows

    @staticmethod
    def _webvue_unknown_text(value):
        if isinstance(value, bool):
            return 'true' if value else 'false'
        if isinstance(value, (str, int, float)):
            return str(value)
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            return '، '.join(value)
        return None

    @api.constrains('flow_id', 'conversation_id')
    def _check_channel(self):
        for submission in self.filtered('flow_id'):
            if submission.flow_id.channel_id != submission.conversation_id.channel_id:
                raise ValidationError(self.env._('A form answer belongs to the channel of its form.'))


class WebVueInboxFlowAnswer(models.Model):
    """One answer of a submission. The label and choice titles are copied so a later copy of the form changes nothing."""
    _name = 'webvue.inbox.flow.answer'
    _description = 'Customer Inbox form answer'
    _order = 'sequence, id'
    _webvue_scope = 'company'

    submission_id = fields.Many2one('webvue.inbox.flow.submission', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='submission_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    field_id = fields.Many2one('webvue.inbox.flow.field', ondelete='set null')
    key = fields.Char(required=True)
    label = fields.Char(required=True)
    kind = fields.Selection(ANSWER_KINDS, required=True)
    value_text = fields.Text()
    value_date = fields.Date()
    value_boolean = fields.Boolean()
    choice_ids = fields.One2many('webvue.inbox.flow.answer.choice', 'answer_id')

    def _webvue_value(self):
        """The value in the contract's shape: text, an ISO date or a boolean (a choice answer has `choice_ids` instead)."""
        self.ensure_one()
        if self.kind == 'date':
            return self.value_date.isoformat()
        if self.kind == 'opt_in':
            return self.value_boolean
        return self.value_text or ''


class WebVueInboxFlowAnswerChoice(models.Model):
    """One chosen option of a dropdown, radio or checkbox answer."""
    _name = 'webvue.inbox.flow.answer.choice'
    _description = 'Customer Inbox form answer choice'
    _order = 'sequence, id'
    _webvue_scope = 'company'

    answer_id = fields.Many2one('webvue.inbox.flow.answer', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='answer_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    key = fields.Char(required=True)
    title = fields.Char(required=True)
