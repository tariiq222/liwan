# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .presets import PRESETS

VISIBILITY_POLICIES = [
    ('assigned_only', 'Assigned conversations only'),
    ('department', 'Own department and unassigned'),
    ('all', 'All conversations'),
]
MAX_AUTO_CLOSE_HOURS = 720
MAX_RETENTION_MONTHS = 120


class WebVueInboxSettings(models.Model):
    """One row per company; created on first use with the stated defaults."""
    _name = 'webvue.inbox.settings'
    _description = 'Customer Inbox settings'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    visibility_policy = fields.Selection(VISIBILITY_POLICIES, required=True, default='department')
    auto_close_hours = fields.Integer(default=72, help='Idle hours before a conversation closes; 0 never closes.')
    retention_months = fields.Integer(default=24)

    _company_unique = models.Constraint('UNIQUE(company_id)', 'A company has one inbox settings row.')

    @api.constrains('auto_close_hours', 'retention_months')
    def _check_ranges(self):
        for settings in self:
            if not 0 <= settings.auto_close_hours <= MAX_AUTO_CLOSE_HOURS:
                raise ValidationError(self.env._('auto_close_hours must be between 0 and %(max)s', max=MAX_AUTO_CLOSE_HOURS))
            if not 1 <= settings.retention_months <= MAX_RETENTION_MONTHS:
                raise ValidationError(self.env._('retention_months must be between 1 and %(max)s', max=MAX_RETENTION_MONTHS))

    @api.model
    def _get_for_company(self, company=None):
        company = company or self.env.company
        settings = self.search([('company_id', '=', company.id)], limit=1)
        return settings or self.create({'company_id': company.id})

    def _webvue_apply_preset(self, key):
        """Create the missing departments, tags and canned replies of a sector preset and set its policy; idempotent."""
        self.ensure_one()
        preset = PRESETS[key]
        company_id = self.company_id.id
        for model, field, names in (
            ('webvue.inbox.department', 'name', preset['departments']),
            ('webvue.inbox.tag', 'name', preset['tags']),
        ):
            Model = self.env[model]
            existing = set(Model.search([('company_id', '=', company_id)]).mapped(field))
            Model.create([{field: name, 'company_id': company_id} for name in names if name not in existing])
        Canned = self.env['webvue.inbox.canned.reply']
        existing = set(Canned.search([('company_id', '=', company_id)]).mapped('shortcut'))
        Canned.create([
            {'shortcut': shortcut, 'body': body, 'company_id': company_id}
            for shortcut, body in preset['canned_replies'] if shortcut not in existing
        ])
        self.write(preset.get('settings', {}))
        return self
