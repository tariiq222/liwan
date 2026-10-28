# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

EFFECTS = ('follow_up', 'won', 'lost', 'none')


class WebVueCrmCallOutcome(models.Model):
    _name = 'webvue.crm.call.outcome'
    _description = 'CRM call outcome'
    _order = 'sequence, id'
    _webvue_scope = 'tenant'

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    effect = fields.Selection([(effect, effect) for effect in EFFECTS], required=True, default='none')
    lost_reason_id = fields.Many2one('crm.lost.reason', ondelete='restrict')

    @api.constrains('effect', 'lost_reason_id')
    def _check_lost_reason(self):
        for outcome in self.filtered('lost_reason_id'):
            if outcome.effect != 'lost':
                raise ValidationError(_('Only a lost outcome can carry a lost reason.'))
            if not outcome.lost_reason_id.active:
                raise ValidationError(_('The lost reason of an outcome must be active.'))
