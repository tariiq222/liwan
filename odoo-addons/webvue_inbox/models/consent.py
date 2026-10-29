# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Marketing consent of a contact (an append-only audit trail) and the stop and start keywords of a company."""
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .campaign_constants import CONSENT_SOURCES, KEYWORD_KINDS
from .normalization import normalize_text

NOTE_LENGTH = 256
KEYWORD_LENGTH = 64


class WebVueInboxContactConsent(models.Model):
    """One consent decision about marketing messages: an opt-in with its proof, or an opt-out and where it came from."""
    _name = 'webvue.inbox.contact.consent'
    _description = 'Customer Inbox marketing consent event'
    _order = 'date desc, id desc'
    _webvue_scope = 'company'

    contact_id = fields.Many2one('webvue.inbox.contact', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='contact_id.company_id', store=True, index=True)
    state = fields.Selection([('opted_in', 'Opted in'), ('opted_out', 'Opted out')], required=True)
    source = fields.Selection(CONSENT_SOURCES, required=True)
    note = fields.Char(size=NOTE_LENGTH)
    author_id = fields.Many2one('res.users', ondelete='set null')
    date = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    # The campaign whose message a stop answered.
    campaign_id = fields.Many2one('webvue.inbox.campaign', ondelete='set null')
    # A WhatsApp opt-out the customer later withdrew in WhatsApp: it no longer decides the state, and stays in the history.
    resumed = fields.Boolean(default=False)


class WebVueInboxOptKeyword(models.Model):
    """A word that, sent alone by a customer, stops or resumes their marketing messages."""
    _name = 'webvue.inbox.opt.keyword'
    _description = 'Customer Inbox opt-out keyword'
    _order = 'kind, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    kind = fields.Selection(KEYWORD_KINDS, required=True)
    value = fields.Char(required=True, size=KEYWORD_LENGTH)
    normalized = fields.Char(compute='_compute_normalized', store=True, index=True)

    _kind_normalized_unique = models.Constraint(
        'UNIQUE(company_id, kind, normalized)', 'A keyword is unique per company and kind.',
    )

    @api.depends('value')
    def _compute_normalized(self):
        for keyword in self:
            keyword.normalized = normalize_text(keyword.value)

    @api.constrains('normalized', 'kind')
    def _check_keyword(self):
        for keyword in self:
            if not keyword.normalized:
                raise ValidationError(self.env._('A keyword needs at least one letter.'))
            clash = self.search_count([
                ('company_id', '=', keyword.company_id.id), ('normalized', '=', keyword.normalized), ('kind', '!=', keyword.kind),
            ])
            if clash:
                raise ValidationError(self.env._('A keyword cannot both stop and resume marketing messages.'))

    @api.model
    def _webvue_match(self, company, text):
        """'stop', 'start' or None: what the whole of `text` (normalized) asks for."""
        normalized = normalize_text(text)
        if not normalized:
            return None
        return self.search([('company_id', '=', company.id), ('normalized', '=', normalized)], limit=1).kind or None
