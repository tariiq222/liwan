# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared fixtures of the campaign tests: contacts with consent and tags, campaigns, and Meta answers for the outbox."""
from datetime import timedelta
from itertools import count
from unittest.mock import MagicMock, patch

import requests

from odoo import fields

from . import whatsapp_payloads as wa
from .automation_common import AutomationCase
from .health_common import meta
from odoo.addons.liwan_inbox.adapters import whatsapp

BASE = '/api/v1/inbox'
# Every key of the contract's InboxCampaign, InboxCampaignRecipient and InboxAudience shapes.
CAMPAIGN_KEYS = {
    'id', 'name', 'state', 'pause_reason', 'pause_detail', 'waiting', 'channel', 'template', 'audience', 'params',
    'header_attachment', 'scheduled_at', 'send_within_hours', 'daily_cap', 'launched_at', 'launched_by', 'completed_at', 'stats',
    'can_edit', 'can_delete', 'created_at',
}
STATS_KEYS = {'total', 'pending', 'skipped', 'queued', 'sent', 'delivered', 'read', 'failed', 'replied', 'unsubscribed', 'held'}
RECIPIENT_KEYS = {
    'id', 'contact', 'state', 'skip_reason', 'failure', 'error_code', 'error', 'conversation_id', 'sent_at', 'replied_at',
    'unsubscribed_at', 'can_retry',
}
AUDIENCE_KEYS = {
    'id', 'name', 'tags', 'tag_match', 'exclude_tags', 'active_within_days', 'contact_count', 'reachable_count', 'created_at',
}
SENT_IDS = count(1)
FIRST_NAME = {'location': 'body', 'position': 1, 'source': 'contact_first_name', 'value': 'Customer'}


class CampaignCase(AutomationCase):
    """The campaigns capability alone in a custom role, an approved marketing template and helpers for contacts and campaigns."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.campaigns_only = cls.custom_user('campaigns_only', 'inbox.campaigns.manage')
        cls.channel.messaging_limit = 'tier_10k'
        cls.template = cls.make_template(category='marketing', body='Hello {{1}}', example_ids=['Sara'])
        cls.tag = cls.env['liwan.inbox.tag'].create({'name': 'vip'})
        cls.other_tag = cls.env['liwan.inbox.tag'].create({'name': 'new'})
        cls.audience = cls.env['liwan.inbox.audience'].create({'name': 'Everyone'})

    @classmethod
    def make_contact(cls, consent='opted_in', tags=(), name=None, address=None, email=None):
        """A contact with a WhatsApp number (`address` False: none) and the given marketing consent."""
        cls.counter += 1
        address = f'96655{cls.counter:07d}' if address is None else address
        contact = cls.env['liwan.inbox.contact'].create({
            'name': name or f'Sara Customer{cls.counter}', 'phone': f'+{address}', 'email': email,
            'tag_ids': [(6, 0, [tag.id for tag in tags])],
        })
        if address:
            cls.env['liwan.inbox.contact.identity'].create({
                'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': address,
            })
        if consent in ('opted_in', 'opted_out'):
            contact._liwan_record_consent(consent, 'agent', note='test')
        return contact

    @classmethod
    def make_campaign(cls, audience=None, params=(FIRST_NAME,), template=None, channel=None, **values):
        template = template or cls.template
        return cls.env['liwan.inbox.campaign'].create({
            'name': 'Spring offer', 'channel_id': (channel or cls.channel).id, 'template_id': template.id,
            'audience_id': (audience or cls.audience).id,
            'param_ids': [(0, 0, dict(param)) for param in params], **values,
        })

    def launched(self, **values):
        """A launched campaign for the whole audience, with the dispatcher not yet run."""
        campaign = self.make_campaign(**values)
        campaign.action_launch()
        return campaign

    def run_campaigns(self, times=1):
        for _ in range(times):
            self.env['liwan.inbox.campaign']._liwan_run_campaigns()
        self.env.invalidate_all()

    def recipients(self, campaign):
        return campaign.recipient_ids.sorted('id')

    def recipient_of(self, campaign, contact):
        return campaign.recipient_ids.filtered(lambda row: row.contact_id == contact)

    # Meta

    def sending_meta(self, held=False, status=200, body=None):
        """A `requests.request` mock that answers every send with a fresh message id and records the posted payloads."""
        calls = []

        def answer(method, url, **kwargs):
            calls.append((method, url, kwargs.get('json') or {}))
            if body is not None:
                return meta(body, status)
            message = {'id': f'wamid.CAMP{next(SENT_IDS)}'}
            if held:
                message['message_status'] = whatsapp.HELD_STATUS
            return meta({'messages': [message]}, status)

        mock = MagicMock(side_effect=answer)
        mock.calls = calls
        return mock

    def run_outbox(self, mock=None):
        mock = mock or self.sending_meta()
        with patch.object(requests, 'request', mock):
            self.env['liwan.inbox.message']._liwan_run_outbox()
        self.env.invalidate_all()
        return mock

    def fail_status(self, message, code, title='failed'):
        """The status webhook that fails `message` with Meta's `code`."""
        stamp = fields.Datetime.now()
        update = whatsapp.StatusUpdate(message.provider_message_id, 'failed', stamp, title, code)
        self.env['liwan.inbox.message']._liwan_apply_status(update)
        self.env.invalidate_all()

    def dispatch_all(self, campaign):
        """Run the dispatcher until the campaign has queued everything, then the outbox once."""
        self.run_campaigns(2)
        return self.run_outbox()

    def age_message(self, message, hours):
        message.date = fields.Datetime.now() - timedelta(hours=hours)
        message.campaign_recipient_ids.sent_at = message.date

    def deliver_from(self, contact, body='Hello'):
        address = contact.identity_ids.address
        return self.deliver(body, wa_id=address)

    def campaign_message(self, recipient):
        return recipient.message_id

    def keyword_event(self, address, value):
        data = wa.payload('100000000001')
        data['entry'][0]['changes'][0]['value']['user_preferences'] = [{
            'wa_id': address, 'detail': 'User requested to stop marketing messages', 'category': 'marketing_messages',
            'value': value, 'timestamp': '1790000000',
        }]
        return data
