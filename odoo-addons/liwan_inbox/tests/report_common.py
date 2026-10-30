# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fixtures of the report tests: inbound events through the real ingestion and agent replies."""
from datetime import timedelta

from odoo import fields

from . import whatsapp_payloads as wa
from .common import LiwanInboxCase
from .health_common import process


class ReportCase(LiwanInboxCase):

    def inbound(self, provider_id, wa_id='966501112222'):
        """Ingest one customer message through the events cron; returns the customer's conversation."""
        process(self, self.channel, wa.inbound_text(provider_id=provider_id, wa_id=wa_id))
        return self.env['liwan.inbox.message'].search([('provider_message_id', '=', provider_id)]).conversation_id

    def reply(self, conversation, author=None, **values):
        """An outbound message of `author` (default: the first agent) stored directly."""
        return self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out', 'body': 'Reply',
            'author_id': (author or self.agent).id, 'delivery_state': 'sent', **values,
        })

    def cycles(self, conversation):
        return self.env['liwan.inbox.conversation.cycle'].search([('conversation_id', '=', conversation.id)], order='id')

    def open_cycle(self, conversation, minutes_ago, **values):
        """A cycle opened `minutes_ago` minutes before now."""
        return self.env['liwan.inbox.conversation.cycle'].create({
            'company_id': conversation.company_id.id, 'conversation_id': conversation.id, 'channel_id': conversation.channel_id.id,
            'department_id': conversation.department_id.id, 'opened_at': fields.Datetime.now() - timedelta(minutes=minutes_ago), **values,
        })
