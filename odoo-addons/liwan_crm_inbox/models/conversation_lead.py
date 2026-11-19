# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM opportunity a conversation is about (the CRM/Customer Messages bridge)."""
import logging

import psycopg2

from odoo import fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_crm.models.crm_lead import NAME_MAX

_logger = logging.getLogger(__name__)

# The xml id of the source an opportunity takes from the channel kind of its conversation.
CHANNEL_SOURCES = {'whatsapp': 'liwan_crm.source_whatsapp', 'tiktok': 'liwan_crm_inbox.source_tiktok'}
CRM_FEATURE = 'crm.enabled'
# What creating or linking an opportunity may refuse by itself; the exception text may hold the contact's data, so only
# its type is logged.
EXPECTED_FAILURES = (AccessError, ValidationError, UserError, ApiError, psycopg2.Error)


class LiwanInboxConversationLead(models.Model):
    _inherit = 'liwan.inbox.conversation'

    # A conversation is a record of Customer Messages and stays valid without the opportunity, so deleting
    # the opportunity clears the link; archiving it changes nothing. Only the bridge writes it.
    lead_id = fields.Many2one('crm.lead', string='Opportunity', index='btree_not_null', ondelete='set null', copy=False)

    def _liwan_channel_source(self):
        """The active source of the conversation's channel kind; none when the kind has no source or the tenant retired it."""
        self.ensure_one()
        xmlid = CHANNEL_SOURCES.get(self.channel_id.kind)
        source = self.env.ref(xmlid, raise_if_not_found=False) if xmlid else None
        return source if source and source.active else self.env['utm.source']

    def _liwan_opportunity_details(self):
        """What an opportunity made from this conversation starts with: the contact's name and phone and the channel's
        source. The manual route and the channel's automatic mode both create from exactly this."""
        self.ensure_one()
        contact = self.contact_id
        details = {'contact_name': contact.name, 'phone': contact.phone}
        source = self._liwan_channel_source()
        if source:
            details['source_id'] = source.id
        return details

    def _liwan_customer_conflicts(self, lead):
        """Whether the contact and ``lead`` are linked to two different customers; one side without one is no conflict."""
        self.ensure_one()
        partner = self.contact_id.partner_id
        return bool(partner and lead.partner_id and partner != lead.partner_id)

    def _liwan_auto_opportunity(self):
        """Give a new conversation its opportunity when its channel is set to ``auto_first_message``.

        Runs once the conversation's first live customer message is stored (never for imported history). It must never
        fail that delivery: any error is logged without the contact's data and the message stays stored.
        """
        self.ensure_one()
        if self.lead_id or self.channel_id.crm_opportunity_mode != 'auto_first_message':
            return
        inbound = [('conversation_id', '=', self.id), ('direction', '=', 'in')]
        if self.env['liwan.inbox.message'].search_count(inbound, limit=2) != 1:
            return
        scoped = self.with_company(self.company_id)
        if not scoped.env['liwan.entitlement.service']._liwan_feature_write(CRM_FEATURE):
            return
        try:
            with self.env.cr.savepoint():
                scoped._liwan_attach_opportunity()
                self.env.flush_all()
        except EXPECTED_FAILURES as error:
            _logger.warning(
                'conversation %s: no opportunity was made from its first message (%s)', self.id, type(error).__name__,
            )
        except Exception:  # noqa: BLE001 - the customer's message is stored whatever the opportunity does
            _logger.exception('conversation %s: unexpected failure making an opportunity from its first message', self.id)

    def _liwan_attach_opportunity(self):
        """Link the open opportunity that holds the contact's phone, else create one like the manual route does.

        A new opportunity goes through the company's distribution, so round robin picks the next eligible agent and the
        other modes leave it unassigned; the inbound path has no requesting user to take it. A contact without a usable
        phone, or a customer different from the opportunity's, is left for an agent to link. So is a phone another
        transaction took at the same moment: this snapshot cannot read its row, so the conversation stays unlinked and
        only the conversation id is logged.
        """
        phone = self.env['liwan.customers.service']._liwan_phone_or_none(self._liwan_opportunity_details()['phone'])
        if not phone:
            return
        lead = self._liwan_open_lead(phone) or self._liwan_create_opportunity(phone)
        if lead and not self._liwan_customer_conflicts(lead):
            self.lead_id = lead

    def _liwan_open_lead(self, phone):
        """The one open opportunity of the company that holds ``phone`` (the partial unique index allows at most one)."""
        return self.env['crm.lead'].search(
            [('company_id', '=', self.company_id.id), ('phone_sanitized', '=', phone), ('won_status', '=', 'pending')], limit=1,
        )

    def _liwan_create_opportunity(self, phone):
        """A new opportunity for the contact, or the one that took the phone since it was looked up."""
        details = self._liwan_opportunity_details()
        partner = self.contact_id._liwan_linked_customer()
        Lead = self.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
        name = (details['contact_name'] or phone)[:NAME_MAX]
        lead = self.env['liwan.crm.intake']._liwan_create_unique(Lead, {
            'name': name, 'contact_name': name, 'type': 'opportunity', 'stage_id': Lead._liwan_first_stage().id,
            'company_id': self.company_id.id, 'phone': phone, 'user_id': False, 'partner_id': partner.id if partner else False,
            'source_id': details.get('source_id', False),
        })
        if not lead:
            lead = self._liwan_open_lead(phone)
            if not lead:
                _logger.info('conversation %s: its phone was taken at the same moment; an agent links it', self.id)
            return lead
        self.env['liwan.crm.distribution']._liwan_assign(lead)
        return lead
