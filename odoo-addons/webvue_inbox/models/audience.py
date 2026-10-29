# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A saved, typed segment of the company's contacts. It stores no members: the contacts are matched when counted or sent."""
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.fields import Domain

MAX_ACTIVE_DAYS = 3650


class WebVueInboxAudience(models.Model):
    _name = 'webvue.inbox.audience'
    _description = 'Customer Inbox audience'
    _order = 'name, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)
    tag_ids = fields.Many2many('webvue.inbox.tag', 'webvue_inbox_audience_tag_rel', 'audience_id', 'tag_id')
    tag_match = fields.Selection([('any', 'Any'), ('all', 'All')], required=True, default='any')
    exclude_tag_ids = fields.Many2many('webvue.inbox.tag', 'webvue_inbox_audience_exclude_rel', 'audience_id', 'tag_id')
    # Only contacts with an inbound message in this many days; 0 means any contact.
    active_within_days = fields.Integer(default=0)
    campaign_ids = fields.One2many('webvue.inbox.campaign', 'audience_id')
    contact_count = fields.Integer(compute='_compute_counts')
    reachable_count = fields.Integer(compute='_compute_counts')

    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'An audience name is unique per company.')

    @api.constrains('active_within_days')
    def _check_days(self):
        for audience in self:
            if not 0 <= audience.active_within_days <= MAX_ACTIVE_DAYS:
                raise ValidationError(self.env._('active_within_days must be between 0 and %(max)s', max=MAX_ACTIVE_DAYS))

    def _webvue_contact_domain(self):
        """The typed domain of the company's contacts this audience matches (consent is not part of it)."""
        self.ensure_one()
        domain = [Domain('company_id', '=', self.company_id.id)]
        if self.tag_ids:
            if self.tag_match == 'all':
                domain += [Domain('tag_ids', 'in', [tag.id]) for tag in self.tag_ids]
            else:
                domain.append(Domain('tag_ids', 'in', self.tag_ids.ids))
        if self.exclude_tag_ids:
            domain.append(Domain('tag_ids', 'not in', self.exclude_tag_ids.ids))
        if self.active_within_days:
            since = fields.Datetime.now() - relativedelta(days=self.active_within_days)
            domain.append(Domain('conversation_ids', 'any', [
                ('message_ids', 'any', [('direction', '=', 'in'), ('date', '>=', since)]),
            ]))
        return Domain.AND(domain)

    def _webvue_reachable_domain(self):
        """The audience's contacts a campaign may message under the company's consent policy and with a WhatsApp address."""
        self.ensure_one()
        policy = self.env['webvue.inbox.settings']._get_for_company(self.company_id).consent_policy
        consent = Domain('marketing_consent', '=', 'opted_in') if policy == 'opted_in_only' else Domain('marketing_consent', '!=', 'opted_out')
        has_address = Domain('identity_ids', 'any', [('channel_kind', '=', 'whatsapp')])
        return Domain.AND([self._webvue_contact_domain(), consent, has_address])

    def _compute_counts(self):
        Contact = self.env['webvue.inbox.contact']
        for audience in self:
            audience.contact_count = Contact.search_count(audience._webvue_contact_domain())
            audience.reachable_count = Contact.search_count(audience._webvue_reachable_domain())
