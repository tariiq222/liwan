# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .campaign_constants import PARAM_LOCATIONS, PARAM_SOURCES
from .template import PLACEHOLDER

PARAM_LENGTH = 1024
CONTACT_FIELDS = {'contact_name': 'name', 'contact_phone': 'phone', 'contact_email': 'email'}


def clean(text):
    """A WhatsApp parameter is a single line: whitespace runs (newlines, tabs) become one space."""
    return ' '.join((text or '').split())[:PARAM_LENGTH]


def param_text(source, value, contact):
    """The text a placeholder gets: the static text, or the contact's field (the sample's, or none) with `value` as the fallback."""
    if source == 'static':
        return clean(value)
    if contact is None:
        return clean(value)
    if source == 'contact_first_name':
        words = (contact.name or '').split()
        text = words[0] if words else ''
    else:
        text = contact[CONTACT_FIELDS[source]]
    return clean(text) or clean(value)


def template_needs(template):
    """The (location, position) of every placeholder a campaign must fill to send `template`."""
    needs = {('body', position) for position in range(1, template.param_count + 1)}
    if template.header_type == 'text' and PLACEHOLDER.search(template.header_text or ''):
        needs.add(('header', 1))
    needs |= {('button', index) for index, _kind in template._liwan_button_needs()}
    return needs


class LiwanInboxCampaignParam(models.Model):
    """What fills one placeholder of the campaign's template: a static text, or a field of the contact with a fallback."""
    _name = 'liwan.inbox.campaign.param'
    _description = 'Customer Inbox campaign parameter'
    _order = 'location, position, id'
    _liwan_scope = 'company'

    campaign_id = fields.Many2one('liwan.inbox.campaign', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='campaign_id.company_id', store=True, index=True)
    location = fields.Selection(PARAM_LOCATIONS, required=True)
    position = fields.Integer(required=True)
    source = fields.Selection(PARAM_SOURCES, required=True)
    # The static text, or the fallback for an empty contact field.
    value = fields.Char(size=PARAM_LENGTH)

    _slot_unique = models.Constraint('UNIQUE(campaign_id, location, position)', 'A placeholder is filled once.')

    def _liwan_value_for(self, contact):
        """The text for `contact` (empty when the contact lacks the field and there is no fallback)."""
        self.ensure_one()
        return param_text(self.source, self.value, contact)
