# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Marketing consent and segment tags of a contact."""
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .campaign_constants import CONSENT_SOURCES, CONSENT_STATES

HISTORY_LENGTH = 20


class WebVueInboxContactMarketing(models.Model):
    _inherit = 'webvue.inbox.contact'

    # Customer segments, distinct from the conversation tags (a topic) by meaning.
    tag_ids = fields.Many2many('webvue.inbox.tag', 'webvue_inbox_contact_tag_rel', 'contact_id', 'tag_id')
    recipient_ids = fields.One2many('webvue.inbox.campaign.recipient', 'contact_id')
    # The last time the contact was imported or decided something; the retention window counts from it.
    last_activity_at = fields.Datetime(default=fields.Datetime.now)
    consent_ids = fields.One2many('webvue.inbox.contact.consent', 'contact_id')
    marketing_consent = fields.Selection(CONSENT_STATES, compute='_compute_marketing_consent', store=True, index=True)
    marketing_consent_at = fields.Datetime(compute='_compute_marketing_consent', store=True)
    marketing_consent_source = fields.Selection(CONSENT_SOURCES, compute='_compute_marketing_consent', store=True)

    @api.constrains('tag_ids', 'company_id')
    def _check_tag_company(self):
        for contact in self:
            if contact.tag_ids.company_id - contact.company_id:
                raise ValidationError(self.env._('A contact is tagged with the tags of its own company.'))

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
        contact._webvue_withdraw_opt_out('whatsapp')

    def _webvue_withdraw_opt_out(self, source):
        """Restore the state before the customer's own opt-out through `source`; True when there was one to withdraw.

        Only the newest decision can be withdrawn, and only an opt-out the customer made through the same channel: a later
        decision, an agent's opt-out or a delivery error is never undone this way, and nothing is ever opted in from unknown.
        """
        self.ensure_one()
        newest = self.consent_ids.filtered(lambda event: not event.resumed).sorted(lambda event: (event.date, event.id))[-1:]
        if newest and (newest.source, newest.state) == (source, 'opted_out'):
            newest.resumed = True
            return True
        return False

    def _webvue_anonymize_suppression(self):
        """Reduce an opted-out contact to a suppression record: its number and the opt-out, no name, tags, notes or history."""
        self.ensure_one()
        decisive = self.consent_ids.filtered(lambda event: not event.resumed).sorted(lambda event: (event.date, event.id))[-1:]
        placeholder = self.phone or ''
        if self.name == placeholder and not self.email and not self.tag_ids and self.consent_ids == decisive and not decisive.note:
            return
        (self.consent_ids - decisive).unlink()
        decisive.write({'note': False, 'author_id': False, 'campaign_id': False})
        self.write({'name': placeholder or self.identity_ids.address or '-', 'email': False, 'tag_ids': [(5, 0, 0)]})
