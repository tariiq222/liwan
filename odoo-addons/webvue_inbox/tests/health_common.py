# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Meta responses and event helpers shared by the phase 6 tests (number health, profile, analytics)."""
import json
from unittest.mock import MagicMock

from . import whatsapp_payloads as wa
from .common import BUSINESS_ACCOUNT_ID

DISPLAY_NUMBER = '966501112222'
HEALTH_BODY = {
    'display_phone_number': '+966 50 111 2222', 'verified_name': 'Acme', 'quality_rating': 'GREEN',
    'code_verification_status': 'VERIFIED', 'name_status': 'APPROVED', 'throughput': {'level': 'STANDARD'},
    'whatsapp_business_manager_messaging_limit': 'TIER_2K',
}
# A Unix time in the past of the tests' clock, as Meta stamps account webhooks.
EVENT_TIME = 1_790_000_000


def meta(body, status=200):
    """A `requests` response carrying `body`."""
    response = MagicMock(status_code=status)
    response.json.return_value = body
    return response


def meta_error(message, status=400):
    return meta({'error': {'message': message}}, status)


def account_event(field, value, account_id=BUSINESS_ACCOUNT_ID, time=EVENT_TIME):
    payload = wa.template_event(field, value, account_id)
    payload['entry'][0]['time'] = time
    return payload


def process(case, channel, payload):
    """Store `payload` as an event of `channel` and run the events cron; returns the event."""
    event = case.env['webvue.inbox.event'].create({
        'channel_id': channel.id, 'owner_company_id': channel.owner_company_id.id, 'payload': json.dumps(payload),
    })
    case.env['webvue.inbox.event']._webvue_run_events()
    case.assertEqual(event.state, 'done', event.error)
    return event


def health_bell_partners(case):
    """The partners that hold a number-health bell row."""
    return case.env['mail.notification'].search([
        ('mail_message_id.webvue_notification_kind', '=', 'inbox.channel_health'),
    ]).res_partner_id
