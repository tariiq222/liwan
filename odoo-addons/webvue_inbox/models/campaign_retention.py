# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Retention of the marketing data: the company's retention window applies to campaigns' recipients and to contacts."""
from odoo import api, models


class WebVueInboxCampaignRetention(models.Model):
    _inherit = 'webvue.inbox.campaign'

    @api.model
    def _webvue_purge_marketing(self, company, cutoff):
        """Purge what is older than `cutoff`: finished campaigns lose their recipients (the campaign keeps its final
        statistics), and contacts with no conversation, no recipient and no recent consent decision are deleted, except an
        opted-out contact, which stays as a bare suppression record (its number and the opt-out, nothing else)."""
        for campaign in self.search([
            ('company_id', '=', company.id), ('state', 'in', ('done', 'cancelled')), ('completed_at', '<', cutoff),
            ('stats_frozen', '=', False),
        ]):
            stats = self._webvue_stats(campaign)[campaign.id]
            campaign.write({'stats_frozen': True, **{f'frozen_{key}': value for key, value in stats.items()}})
            campaign.recipient_ids.unlink()
        aged = self.env['webvue.inbox.contact'].search([
            ('company_id', '=', company.id), ('conversation_ids', '=', False), ('recipient_ids', '=', False),
            ('last_activity_at', '<', cutoff), ('consent_ids', 'not any', [('date', '>=', cutoff)]),
        ])
        aged.filtered(lambda contact: contact.marketing_consent != 'opted_out').unlink()
        for contact in aged.exists().filtered(lambda contact: contact.marketing_consent == 'opted_out'):
            contact._webvue_anonymize_suppression()
