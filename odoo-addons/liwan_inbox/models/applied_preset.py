# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .presets import PRESETS


class LiwanInboxAppliedPreset(models.Model):
    """A sector preset whose items were created for a company: applying it again never re-creates them."""
    _name = 'liwan.inbox.applied.preset'
    _description = 'Customer Inbox applied sector preset'
    _order = 'key'
    _liwan_scope = 'company'

    settings_id = fields.Many2one('liwan.inbox.settings', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='settings_id.company_id', store=True, index=True)
    key = fields.Selection([(key, key.replace('_', ' ').title()) for key in PRESETS], required=True)

    _settings_key_unique = models.Constraint('UNIQUE(settings_id, key)', 'A preset is applied once.')
