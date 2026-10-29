# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .constants import DEFAULT_TIMEZONE
from .presets import PRESETS

VISIBILITY_POLICIES = [
    ('assigned_only', 'Assigned conversations only'),
    ('department', 'Own department and unassigned'),
    ('all', 'All conversations'),
]
ASSIGNMENT_POLICIES = [
    ('manual', 'Manual'),
    ('round_robin', 'Round robin'),
    ('least_open', 'Fewest open conversations'),
]
MAX_AUTO_CLOSE_HOURS = 720
MAX_ALERT_MINUTES = 1440
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
    # Working hours: weekly ranges and holidays (local dates) in a timezone; no ranges means always open.
    hours_timezone = fields.Char(required=True, default=DEFAULT_TIMEZONE)
    hours_range_ids = fields.One2many('webvue.inbox.hours.range', 'settings_id')
    holiday_ids = fields.One2many('webvue.inbox.hours.holiday', 'settings_id')
    assignment_policy = fields.Selection(ASSIGNMENT_POLICIES, required=True, default='manual')
    # The agent who got the last conversation of a company without departments (the round robin pointer).
    round_robin_user_id = fields.Many2one('res.users', ondelete='set null')
    first_response_alert_minutes = fields.Integer(default=0, help='Minutes a customer may wait for a first reply; 0 turns the alert off.')

    _company_unique = models.Constraint('UNIQUE(company_id)', 'A company has one inbox settings row.')

    @api.constrains('auto_close_hours', 'retention_months', 'first_response_alert_minutes')
    def _check_ranges(self):
        for settings in self:
            if not 0 <= settings.first_response_alert_minutes <= MAX_ALERT_MINUTES:
                raise ValidationError(self.env._(
                    'first_response_alert_minutes must be between 0 and %(max)s', max=MAX_ALERT_MINUTES,
                ))
            if not 0 <= settings.auto_close_hours <= MAX_AUTO_CLOSE_HOURS:
                raise ValidationError(self.env._('auto_close_hours must be between 0 and %(max)s', max=MAX_AUTO_CLOSE_HOURS))
            if not 1 <= settings.retention_months <= MAX_RETENTION_MONTHS:
                raise ValidationError(self.env._('retention_months must be between 1 and %(max)s', max=MAX_RETENTION_MONTHS))

    @api.model
    def _get_for_company(self, company=None):
        company = company or self.env.company
        settings = self.search([('company_id', '=', company.id)], limit=1)
        return settings or self.create({'company_id': company.id})

    def _webvue_is_open(self, at, department=None):
        """Whether the UTC moment `at` is inside the working hours that apply (the department's, else the company's)."""
        self.ensure_one()
        owner = department if department and department.hours_own else self
        return self.env['webvue.inbox.working.hours']._webvue_is_open(owner, at)

    def _webvue_apply_preset(self, key, automation=True):
        """Create the missing departments, tags and canned replies of a sector preset and set its policy; idempotent.

        `automation` also fills the channels' welcome and away messages and adds the menu rules.
        """
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
        if automation:
            self._webvue_seed_automation(preset.get('automation', {}))
        return self

    def _webvue_seed_automation(self, automation):
        """Fill the missing welcome and away messages of the company's channels and add the missing menu rules, switched off."""
        company = self.company_id
        channels = self.env['webvue.inbox.channel'].search([('owner_company_id', '=', company.id)])
        for channel in channels:
            channel._webvue_fill_automation(automation.get('welcome'), automation.get('away'))
        Rule = self.env['webvue.inbox.rule'].with_context(active_test=False)
        existing = set(Rule.search([('company_id', '=', company.id)]).mapped('name'))
        sequence = max(Rule.search([('company_id', '=', company.id)]).mapped('sequence'), default=0)
        for spec in automation.get('rules', []):
            if spec['name'] in existing:
                continue
            sequence += 10
            rule = Rule.create({
                'company_id': company.id, 'sequence': sequence, 'name': spec['name'], 'match_kind': 'option', 'active': False,
                'option_id': spec['option_id'],
                'department_id': self._webvue_named('webvue.inbox.department', spec.get('department')),
                'tag_ids': [(6, 0, [self._webvue_named('webvue.inbox.tag', name) for name in spec.get('tags', [])])],
            })
            rule._webvue_set_reply(spec['reply'])

    def _webvue_named(self, model, name):
        """The id of the company's department or tag called `name` (False without a name)."""
        return self.env[model].search([('company_id', '=', self.company_id.id), ('name', '=', name)], limit=1).id if name else False
