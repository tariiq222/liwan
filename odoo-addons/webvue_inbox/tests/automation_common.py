# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared fixtures of the automation tests: a role that holds nothing but the automation capability, and inbound delivery."""
import calendar
import json
from datetime import datetime, timedelta

from odoo import Command, fields
from odoo.tests import new_test_user

from . import whatsapp_payloads as wa
from .common import PASSWORD, WebVueInboxCase

BASE = '/api/v1/inbox'
WA_ID = '966501112222'
# Every key of the contract's InboxRuleSchema and InboxChannelAutomationSchema blocks.
RULE_KEYS = {
    'id', 'sequence', 'channel', 'name', 'active', 'match_kind', 'keywords', 'option_id', 'hours', 'stop', 'reply',
    'resolve', 'department', 'assignee', 'tags', 'priority',
}
RULE_BODY = {
    'channel_id': None, 'name': 'Prices', 'active': True, 'match_kind': 'contains', 'keywords': ['price'], 'option_id': None,
    'hours': 'any', 'stop': True, 'reply': {'body': 'See our price list'}, 'resolve': False, 'department_id': None,
    'assignee_id': None, 'tag_ids': [], 'priority': None,
}


def hours(days=(), timezone='UTC', holidays=()):
    return {'timezone': timezone, 'days': list(days), 'holidays': list(holidays)}


def all_day(weekday):
    return {'weekday': weekday, 'from': '00:00', 'to': '24:00'}


class AutomationCase(WebVueInboxCase):
    """The automation capability alone in a custom role, inbound delivery through the events pipeline, and helpers."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.automation_user = cls.custom_user('automation_only', 'inbox.automation.manage')
        cls.channel.department_id = False

    @classmethod
    def custom_user(cls, login, *permissions):
        user = new_test_user(cls.env, login=f'inbox_{login}', password=PASSWORD, name=login, groups='webvue_core.group_employee')
        role = cls.env['webvue.access.role'].create({
            'key': f'inbox_{login}', 'name_ar': login, 'name_en': login, 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', 'in', permissions)]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{'role_id': role.id, 'company_id': cls.env.company.id}])
        return user

    # inbound delivery

    def deliver(self, body='Hello', provider_id=None, wa_id=WA_ID, option=None, at=None, channel=None):
        """Run one inbound text (or interactive reply when `option` is an (id, title) pair) through the events pipeline."""
        channel = channel or self.channel
        type(self).counter += 1
        provider_id = provider_id or f'wamid.AUTO{self.counter}'
        if option:
            data = wa.inbound_message(
                'interactive', {'type': 'button_reply', 'button_reply': {'id': option[0], 'title': option[1]}},
                provider_id=provider_id, wa_id=wa_id,
            )
        else:
            data = wa.inbound_text(provider_id, wa_id=wa_id, body=body)
        moment = at or fields.Datetime.now()
        data['entry'][0]['changes'][0]['value']['messages'][0]['timestamp'] = str(calendar.timegm(moment.timetuple()))
        event = self.env['webvue.inbox.event'].create({
            'channel_id': channel.id, 'owner_company_id': channel.owner_company_id.id, 'payload': json.dumps(data),
        })
        self.env['webvue.inbox.event']._webvue_run_events()
        return self.env['webvue.inbox.message'].search([('provider_message_id', '=', provider_id)]), event

    def conversation_of(self, message):
        return message.conversation_id

    def automated(self, conversation):
        return conversation.message_ids.filtered(lambda message: message.automated).sorted('id')

    def notes(self, conversation):
        return conversation.message_ids.filtered(lambda message: message.direction == 'note').mapped('body')

    def set_text(self, purpose, body, **values):
        self.channel._webvue_set_auto_message(purpose, {'body': body})
        self.channel.write({f'{purpose}_enabled': True, **values})

    @classmethod
    def make_rule(cls, **values):
        reply = values.pop('reply', {'body': 'auto reply'})
        keywords = values.pop('keywords', [])
        rule = cls.env['webvue.inbox.rule'].create({
            'name': 'rule', 'match_kind': 'contains', **values,
            'keyword_ids': [Command.create({'value': keyword}) for keyword in keywords],
        })
        rule._webvue_set_reply(reply)
        return rule

    def closed_calendar_now(self):
        """Working hours that are closed right now: only another weekday is open (UTC)."""
        return hours([all_day((fields.Datetime.now().weekday() + 1) % 7)])

    def open_calendar_now(self):
        return hours([all_day(fields.Datetime.now().weekday())])

    def set_company_hours(self, data):
        self.settings.calendar_id = False
        self.env['webvue.inbox.working.hours']._webvue_write(self.settings, 'Test hours', data)

    def minutes_ago(self, minutes):
        return fields.Datetime.now() - timedelta(minutes=minutes)

    def moment(self, text):
        return datetime.strptime(text, '%Y-%m-%d %H:%M')
