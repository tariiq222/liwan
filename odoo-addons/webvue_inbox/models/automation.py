# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The automation engine: runs once per inbound message, inside inbound processing, in the same transaction."""
from datetime import timedelta
from functools import partial

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .constants import (
    AGENT_ACTIVE_WINDOW,
    AUTOMATED_RATE_WINDOW,
    AUTOMATION_FEATURE,
    CSAT_SCORES,
    MAX_AUTOMATED_PER_HOUR,
    REPLY_WINDOW,
)
from .rule import TEXT_KINDS
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule

# The system notes that tell agents what the automation did (the thread shows them without an author).
NOTE_WELCOME = 'رد آلي: رسالة الترحيب'
NOTE_AWAY = 'رد آلي: رسالة خارج أوقات الدوام'
NOTE_RULE_REPLY = 'رد آلي: القاعدة «%s»'
NOTE_DEPARTMENT = 'القاعدة «%s» حوّلت المحادثة إلى القسم «%s»'
NOTE_ASSIGNEE = 'القاعدة «%s» أسندت المحادثة إلى %s'
NOTE_TAGS = 'القاعدة «%s» أضافت الوسوم: %s'
NOTE_PRIORITY = 'القاعدة «%s» ضبطت الأولوية: %s'
NOTE_RESOLVE = 'القاعدة «%s» حلّت المحادثة'
NOTE_LIMIT = 'لم يُرسل الرد الآلي لأن حد الرسائل الصادرة للاشتراك قد بلغ'
NOTE_ASSIGNED = 'سياسة الإسناد الآلي أسندت المحادثة إلى %s'
NOTE_FLOW_UNAVAILABLE = 'لم يُرسل النموذج «%s» لأنه غير متاح'


class WebVueInboxAutomation(models.AbstractModel):
    _name = 'webvue.inbox.automation'
    _description = 'Customer Inbox automation engine'
    _webvue_scope = 'global'

    # entry points (inbound processing)

    @api.model
    def _webvue_record_csat(self, conversation, message):
        """Store a customer's answer to a survey asked in this conversation (the latest answer wins).

        True when `message` is one: it never reopens the conversation and runs no rule, whenever it is tapped.
        """
        score = CSAT_SCORES.get(message.selected_option_id)
        if not score:
            return False
        asked = self.env['webvue.inbox.message.option'].search_count([
            ('option_id', '=', message.selected_option_id), ('message_id.conversation_id', '=', conversation.id),
            ('message_id.automated', '=', True),
        ])
        if not asked:
            return False
        conversation.write({'csat_score': score, 'csat_at': message.date})
        message.automation_done = True
        return True

    @api.model
    def _webvue_run(self, conversation, message):
        """Welcome or away message, then the rules in order, then the auto-assignment, for one inbound message."""
        if message.automation_done:
            return
        message.automation_done = True
        if not self.env['webvue.entitlement.service']._webvue_feature_write(AUTOMATION_FEATURE):
            return
        if fields.Datetime.now() - message.date > REPLY_WINDOW:
            return  # an old message (a late delivery) is never answered
        settings = self.env['webvue.inbox.settings']._get_for_company(conversation.company_id)
        inside = settings._webvue_is_open(message.date, conversation.department_id)
        if message.kind != 'flow_response':
            self._webvue_greet(conversation, message, inside)
        text = message.body if message.kind in TEXT_KINDS else None
        rules = self.env['webvue.inbox.rule']._webvue_triggered(
            conversation.channel_id, text, message.selected_option_id or None, inside,
            flow_id=message.flow_submission_ids.flow_id.id or None,
        )
        agent_active = self._webvue_agent_active(conversation, message.date)
        for rule in rules:
            self._webvue_apply_rule(conversation, message, rule, agent_active)
        self._webvue_auto_assign(conversation, settings)

    @api.model
    def _webvue_dry_run(self, channel, text, option_id, at, flow_id=None):
        """(inside working hours, the greeting, the rules) for a customer message (or form answer) on `channel`; writes nothing."""
        settings = self.env['webvue.inbox.settings']._get_for_company(channel.owner_company_id)
        inside = settings._webvue_is_open(at or fields.Datetime.now(), channel.department_id)
        greeting = self._webvue_greeting(channel, inside, away_due=True, welcome_due=True)
        return inside, greeting, self.env['webvue.inbox.rule']._webvue_triggered(channel, text, option_id, inside, flow_id)

    # welcome and away

    @api.model
    def _webvue_greeting(self, channel, inside, away_due, welcome_due):
        """'away', 'welcome' or None: the automatic message the channel sends before the rules (away suppresses welcome)."""
        if not inside and channel.away_enabled and channel._webvue_auto_message('away'):
            return 'away' if away_due else None
        if channel.welcome_enabled and channel._webvue_auto_message('welcome') and welcome_due:
            return 'welcome'
        return None

    @api.model
    def _webvue_greet(self, conversation, message, inside):
        channel = conversation.channel_id
        away_sent = conversation.away_sent_at
        away_due = not away_sent or message.date >= away_sent + relativedelta(hours=channel.away_repeat_hours)
        kind = self._webvue_greeting(channel, inside, away_due, self._webvue_welcome_due(conversation, message))
        if not kind:
            return
        if self._webvue_send(conversation, message, channel._webvue_auto_message(kind), NOTE_AWAY if kind == 'away' else NOTE_WELCOME) \
                and kind == 'away':
            conversation.away_sent_at = message.date

    @api.model
    def _webvue_welcome_due(self, conversation, message):
        """A new conversation, or one whose previous message is at least `welcome_idle_days` old."""
        earlier = conversation.message_ids.filtered(lambda other: other.direction != 'note' and other.id != message.id)
        if not earlier:
            return True
        idle_days = conversation.channel_id.welcome_idle_days
        return bool(idle_days) and message.date - max(earlier.mapped('date')) >= timedelta(days=idle_days)

    # sending and guards

    @api.model
    def _webvue_agent_active(self, conversation, moment):
        """True when an agent replied in the last minutes: the conversation is being handled, rules stay quiet."""
        return bool(self.env['webvue.inbox.message'].search_count([
            ('conversation_id', '=', conversation.id), ('direction', '=', 'out'), ('author_id', '!=', False),
            ('automated', '=', False), ('date', '>=', moment - AGENT_ACTIVE_WINDOW),
        ]))

    @api.model
    def _webvue_send(self, conversation, message, auto_message, note):
        """Queue `auto_message` as an automated reply to `message` and note why. False when a guard or the limit skipped it."""
        Message = self.env['webvue.inbox.message']
        values = auto_message._webvue_message_values()
        flow = self.env['webvue.inbox.flow'].browse(values.get('flow_id'))
        if values.get('interactive_type') == 'flow' and not flow._webvue_sendable_in(conversation.channel_id):
            Message._webvue_post_system_note(conversation, NOTE_FLOW_UNAVAILABLE % (flow.name or ''))
            return False
        recent = Message.search_count([
            ('conversation_id', '=', conversation.id), ('direction', '=', 'out'), ('automated', '=', True),
            ('date', '>=', message.date - AUTOMATED_RATE_WINDOW),
        ])
        if recent >= MAX_AUTOMATED_PER_HOUR:
            return False
        try:
            with self.env.cr.savepoint():
                Message._webvue_queue_automated(conversation, values)
        except WebVueAccessRule:
            Message._webvue_post_system_note(conversation, NOTE_LIMIT)
            return False
        except ValidationError:
            return False  # the channel is disabled or the conversation closed: nothing to say
        Message._webvue_post_system_note(conversation, note)
        return True

    # rules

    @api.model
    def _webvue_apply_rule(self, conversation, message, rule, agent_active):
        note = partial(self.env['webvue.inbox.message']._webvue_post_system_note, conversation)
        if rule.reply_ids and not agent_active:
            self._webvue_send(conversation, message, rule.reply_ids, NOTE_RULE_REPLY % rule.name)
        values = {}
        if rule.department_id:
            values['department_id'] = rule.department_id.id
            note(NOTE_DEPARTMENT % (rule.name, rule.department_id.name))
        if rule.assignee_id and rule.assignee_id.active:
            values['assignee_id'] = rule.assignee_id.id
            note(NOTE_ASSIGNEE % (rule.name, rule.assignee_id.name))
        if rule.tag_ids:
            values['tag_ids'] = [(4, tag.id) for tag in rule.tag_ids]
            note(NOTE_TAGS % (rule.name, '، '.join(rule.tag_ids.mapped('name'))))
        if rule.priority:
            values['priority'] = rule.priority
            note(NOTE_PRIORITY % (rule.name, rule.priority))
        if rule.resolve:
            values['state'] = 'resolved'
            note(NOTE_RESOLVE % rule.name)
        if values:
            previous = conversation.assignee_id
            conversation.write(values)
            if conversation.assignee_id != previous:
                conversation._webvue_notify_assigned()

    # auto-assignment

    @api.model
    def _webvue_auto_assign(self, conversation, settings):
        """Give an unassigned conversation to an agent by the company's policy (round robin or fewest open)."""
        if conversation.assignee_id or settings.assignment_policy == 'manual' or conversation.state != 'open':
            return
        agents = conversation._webvue_agents().sorted('id')
        if not agents:
            return
        holder = conversation.department_id or settings
        if settings.assignment_policy == 'round_robin':
            pointer = holder.round_robin_user_id
            chosen = next((agent for agent in agents if pointer and agent.id > pointer.id), agents[0])
            holder.round_robin_user_id = chosen
        else:
            chosen = min(agents, key=lambda agent: (self._webvue_open_count(agent, conversation.company_id), agent.id))
        conversation.assignee_id = chosen
        self.env['webvue.inbox.message']._webvue_post_system_note(conversation, NOTE_ASSIGNED % chosen.name)
        conversation._webvue_notify_assigned()

    @api.model
    def _webvue_open_count(self, agent, company):
        return self.env['webvue.inbox.conversation'].search_count([
            ('company_id', '=', company.id), ('assignee_id', '=', agent.id), ('state', 'in', ('open', 'pending')),
        ])
