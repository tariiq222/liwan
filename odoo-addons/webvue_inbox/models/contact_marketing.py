# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Marketing consent and segment tags of a contact."""
from odoo import api, fields, models

from .campaign_constants import CONSENT_SOURCES, CONSENT_STATES

HISTORY_LENGTH = 20


class WebVueInboxContactMarketing(models.Model):
    _inherit = 'webvue.inbox.contact'

    # Customer segments, distinct from the conversation tags (a topic) by meaning.
    tag_ids = fields.Many2many('webvue.inbox.tag', 'webvue_inbox_contact_tag_rel', 'contact_id', 'tag_id')
    # Created by a contact import, so the retention purge keeps it although it has no conversation.
    imported = fields.Boolean(default=False)
    recipient_ids = fields.One2many('webvue.inbox.campaign.recipient', 'contact_id')
    consent_ids = fields.One2many('webvue.inbox.contact.consent', 'contact_id')
    marketing_consent = fields.Selection(CONSENT_STATES, compute='_compute_marketing_consent', store=True, index=True)
    marketing_consent_at = fields.Datetime(compute='_compute_marketing_consent', store=True)
    marketing_consent_source = fields.Selection(CONSENT_SOURCES, compute='_compute_marketing_consent', store=True)

    @api.depends('consent_ids.state', 'consent_ids.source', 'consent_ids.date', 'consent_ids.resumed')
    def _compute_marketing_consent(self):
        for contact in self:
            decisive = contact.consent_ids.filtered(lambda event: not event.resumed).sorted(lambda event: (event.date, event.id))[-1:]
            contact.marketing_consent = decisive.state or 'unknown'
            contact.marketing_consent_at = decisive.date or False
            contact.marketing_consent_source = decisive.source or False

    def _webvue_record_consent(self, state, source, note=None, author=None, campaign=None):
        """Add a consent event; an import never overrides an opt-out. Returns the event (empty when refused)."""
        self.ensure_one()
        Consent = self.env['webvue.inbox.contact.consent']
        if source == 'import' and state == 'opted_in' and self.marketing_consent == 'opted_out':
            return Consent
        return Consent.create({
            'contact_id': self.id, 'state': state, 'source': source, 'note': note or False,
            'author_id': author.id if author else False, 'campaign_id': campaign.id if campaign else False,
        })

    def _webvue_history(self):
        """The newest consent events, newest first."""
        self.ensure_one()
        return self.consent_ids.sorted(lambda event: (event.date, event.id), reverse=True)[:HISTORY_LENGTH]

    @api.model
    def _webvue_apply_preference(self, channel, item):
        """A customer's stop or resume of marketing messages from inside WhatsApp (the `user_preferences` webhook)."""
        identity = self.env['webvue.inbox.contact.identity'].search([
            ('company_id', '=', channel.owner_company_id.id), ('channel_kind', '=', channel.kind), ('address', '=', item.wa_id),
        ], limit=1)
        contact = identity.contact_id
        if not contact:
            return
        if item.value == 'stop':
            recipient = self.env['webvue.inbox.campaign.recipient']._webvue_latest_for_contact(contact)
            contact._webvue_record_consent('opted_out', 'whatsapp', campaign=recipient.campaign_id)
            recipient._webvue_mark_unsubscribed(item.at)
            return
        # A resume restores the state before the WhatsApp stop, unless a later decision already replaced it.
        newest = contact.consent_ids.filtered(lambda event: not event.resumed).sorted(lambda event: (event.date, event.id))[-1:]
        if newest and (newest.source, newest.state) == ('whatsapp', 'opted_out'):
            newest.resumed = True
