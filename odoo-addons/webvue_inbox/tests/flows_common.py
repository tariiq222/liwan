# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared fixtures of the form (WhatsApp Flows) tests: a valid form body, a form factory and a fake Meta."""
import calendar
import json
from unittest.mock import MagicMock, patch

import requests

from odoo import fields

from . import whatsapp_payloads as wa
from .automation_common import WA_ID, AutomationCase
from .common import PHONE_ID

BASE = '/api/v1/inbox'
GRAPH = 'https://graph.facebook.com/v23.0/'
# Every key of the contract's InboxFlowSchema.
FLOW_KEYS = {
    'id', 'channel', 'name', 'category', 'language', 'status', 'health', 'provider_flow_id', 'json_version', 'supported',
    'editable', 'sendable', 'error_count', 'submission_count', 'version_warning', 'published_at', 'updated_at',
    'completion_message', 'replaces', 'screens', 'validation_errors',
}
SUMMARY_KEYS = FLOW_KEYS - {'completion_message', 'replaces', 'screens', 'validation_errors'}
SUBMISSION_KEYS = {'id', 'flow', 'conversation_id', 'contact', 'request_message_id', 'message_id', 'submitted_at', 'answers'}


def text_input(key='full_name', **values):
    return {
        'kind': 'text_input', 'key': key, 'label': 'Name', 'required': True, 'sensitive': False, 'input_type': 'text',
        'helper_text': None, 'min_chars': None, 'max_chars': None, **values,
    }


def choice(kind, key, titles, **values):
    return {
        'kind': kind, 'key': key, 'label': key, 'required': True, 'sensitive': False,
        'options': [{'title': title, 'description': None} for title in titles], **values,
    }


def form_body(**overrides):
    """A valid write body: two screens, one of every common field kind."""
    return {
        'name': 'Appointment', 'category': 'appointment_booking', 'language': 'ar', 'completion_message': 'Thank you',
        'screens': [
            {'title': 'Details', 'footer_label': 'Next', 'fields': [
                {'kind': 'heading', 'text': 'Book a visit'},
                text_input(),
                choice('dropdown', 'service', ['Checkup', 'Dental']),
            ]},
            {'title': 'Consent', 'footer_label': 'Send', 'fields': [
                {'kind': 'date', 'key': 'day', 'label': 'Day', 'required': True, 'sensitive': False, 'helper_text': None,
                 'min_date': None, 'max_date': None},
                {**choice('checkbox', 'extras', ['Xray', 'Cleaning', 'Whitening']), 'required': False,
                 'min_selected': None, 'max_selected': 2},
                {'kind': 'text_area', 'key': 'notes', 'label': 'Notes', 'required': False, 'sensitive': True,
                 'helper_text': None, 'max_length': None},
                {'kind': 'opt_in', 'key': 'consent', 'label': 'I agree', 'required': True},
            ]},
        ],
        **overrides,
    }


def response(status, body=None):
    mocked = MagicMock(status_code=status)
    mocked.json.return_value = body if body is not None else {}
    return mocked


class FakeMeta:
    """Meta's Graph API for forms, messages and templates: records every call and answers the way Meta does."""

    def __init__(self):
        self.calls = []
        self.count = 0
        self.errors = []
        self.failure = None
        self.status = 'PUBLISHED'
        self.health = 'AVAILABLE'
        self.listing = []
        self.template_id = '555000009'

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url.removeprefix(GRAPH), kwargs))
        if self.failure:
            if isinstance(self.failure, Exception):
                raise self.failure
            return response(*self.failure)
        return response(200, self.answer(method, url.removeprefix(GRAPH), kwargs))

    def answer(self, method, path, kwargs):
        if path.endswith('/messages'):
            self.count += 1
            return {'messages': [{'id': f'wamid.OUT{self.count}'}]}
        if path.endswith('/message_templates'):
            return {'id': self.template_id, 'status': 'PENDING', 'category': 'UTILITY'}
        if path.endswith('/flows') and method == 'POST':
            self.count += 1
            return {'id': f'70000000{self.count}', 'success': True, 'validation_errors': self.errors}
        if path.endswith('/flows'):
            return {'data': self.listing}
        if path.endswith('/assets'):
            return {'success': True, 'validation_errors': self.errors}
        if method == 'GET' and 'preview' in kwargs['params']['fields']:
            return {'preview': {'preview_url': 'https://business.facebook.com/wa/manage/flows/preview/abc', 'expires_at': '2026-11-28T10:00:00+0000'}}
        if method == 'GET':
            return {
                'name': 'Meta name', 'status': self.status, 'categories': ['OTHER'], 'json_version': '7.3',
                'health_status': {'can_send_message': self.health}, 'validation_errors': [],
            }
        return {'success': True}

    def paths(self, method=None, suffix=''):
        return [path for call_method, path, _kwargs in self.calls if (method is None or call_method == method) and path.endswith(suffix)]

    def bodies(self, suffix):
        """The JSON bodies sent to paths ending with `suffix`."""
        return [kwargs.get('json') for _method, path, kwargs in self.calls if path.endswith(suffix)]

    def messages(self):
        return self.bodies(f'{PHONE_ID}/messages')


class FlowCase(AutomationCase):
    """Automation fixtures plus a manager-only-forms user, a fake Meta and a form factory."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.flows_user = cls.custom_user('flows_only', 'inbox.flows.manage')
        cls.settings.visibility_policy = 'all'

    def setUp(self):
        super().setUp()
        self.meta = FakeMeta()
        patcher = patch.object(requests, 'request', self.meta)
        patcher.start()
        self.addCleanup(patcher.stop)

    @classmethod
    def make_flow(cls, channel=None, status='published', screens=None, **values):
        """A form straight in the database (already on Meta unless it is a draft you built through the API)."""
        cls.counter += 1
        Flow = cls.env['webvue.inbox.flow']
        return Flow.create({
            'channel_id': (channel or cls.channel).id, 'name': f'Form {cls.counter}', 'category': 'lead_generation',
            'language': 'ar', 'status': status, 'health': 'available' if status == 'published' else 'unknown',
            'provider_flow_id': f'8{cls.counter:09d}', 'json_version': '7.3',
            'screen_ids': Flow._webvue_screen_commands(form_body()['screens'] if screens is None else screens), **values,
        })

    def flow_path(self, flow, suffix=''):
        return f'{BASE}/flows/{flow.id}{suffix}'

    def send_form(self, flow, conversation, minutes=0):
        """Queue the form as an agent reply and run the outbox; returns the sent message."""
        reply = self.api('POST', f'{BASE}/conversations/{conversation.id}/messages', {'interactive': {
            'type': 'flow', 'body': 'Please fill in', 'header': None, 'footer': None, 'flow_id': flow.id, 'cta': 'Open',
        }})
        self.assertEqual(reply.status_code, 200, reply.text)
        self.env['webvue.inbox.message']._webvue_run_outbox()
        return self.env['webvue.inbox.message'].browse(reply.json()['id'])

    def deliver_form(self, response, provider_id=None, wa_id=WA_ID, context_id=None, channel=None):
        """Run one completed form through the events pipeline; returns the stored inbound message."""
        channel = channel or self.channel
        type(self).counter += 1
        provider_id = provider_id or f'wamid.FORM{self.counter}'
        data = wa.flow_reply(response, provider_id, wa_id, context_id)
        data['entry'][0]['changes'][0]['value']['messages'][0]['timestamp'] = str(calendar.timegm(fields.Datetime.now().timetuple()))
        return self.run_event(data, channel, provider_id)

    def run_event(self, data, channel=None, provider_id=None):
        channel = channel or self.channel
        event = self.env['webvue.inbox.event'].create({
            'channel_id': channel.id, 'owner_company_id': channel.owner_company_id.id, 'payload': json.dumps(data),
        })
        self.env['webvue.inbox.event']._webvue_run_events()
        self.assertEqual(event.state, 'done', event.error)
        return self.env['webvue.inbox.message'].search([('provider_message_id', '=', provider_id)]) if provider_id else event
