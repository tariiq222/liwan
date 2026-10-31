# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models
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
MIN_REPORT_RETENTION_MONTHS = 12


class LiwanInboxSettings(models.Model):
    """One row per company; created on first use with the stated defaults."""
    _name = 'liwan.inbox.settings'
    _description = 'Customer Inbox settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    visibility_policy = fields.Selection(VISIBILITY_POLICIES, required=True, default='department')
    auto_close_hours = fields.Integer(default=72, help='Idle hours before a conversation closes; 0 never closes.')
    retention_months = fields.Integer(default=24)
    applied_preset_ids = fields.One2many('liwan.inbox.applied.preset', 'settings_id')
    # Working hours: weekly ranges and holidays (local dates) in a timezone; no ranges means always open.
    hours_timezone = fields.Char(required=True, default=DEFAULT_TIMEZONE)
    hours_range_ids = fields.One2many('liwan.inbox.hours.range', 'settings_id')
    holiday_ids = fields.One2many('liwan.inbox.hours.holiday', 'settings_id')
    assignment_policy = fields.Selection(ASSIGNMENT_POLICIES, required=True, default='manual')
    # The agent who got the last conversation of a company without departments (the round robin pointer).
    round_robin_user_id = fields.Many2one('res.users', ondelete='set null')
    # How long the daily report rows are kept, and the timezone they were built in (a change rebuilds them).
    report_retention_months = fields.Integer(default=36)
    reports_built_timezone = fields.Char()
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

    @api.constrains('report_retention_months')
    def _check_report_retention(self):
        for settings in self:
            if not MIN_REPORT_RETENTION_MONTHS <= settings.report_retention_months <= MAX_RETENTION_MONTHS:
                raise ValidationError(self.env._(
                    'report_retention_months must be between %(min)s and %(max)s',
                    min=MIN_REPORT_RETENTION_MONTHS, max=MAX_RETENTION_MONTHS,
                ))

    @api.model
    def _get_for_company(self, company=None):
        company = company or self.env.company
        settings = self.search([('company_id', '=', company.id)], limit=1)
        return settings or self.create({'company_id': company.id})

    @api.model
    def _liwan_read_for_company(self, company=None):
        """The company's row, or an unsaved one at the stated defaults when it has none yet. Never writes."""
        company = company or self.env.company
        return self.search([('company_id', '=', company.id)], limit=1) or self.new({'company_id': company.id})

    def _liwan_is_open(self, at, department=None):
        """Whether the UTC moment `at` is inside the working hours that apply (the department's, else the company's)."""
        self.ensure_one()
        owner = department if department and department.hours_own else self
        return self.env['liwan.inbox.working.hours']._liwan_is_open(owner, at)

    def _liwan_apply_preset(self, key, automation=True, flows=False):
        """Create the missing departments, tags and canned replies of a sector preset the first time, set its policy and fill its
        opt-out keywords and empty confirmation replies.

        The preset is recorded as applied, so a later application does not bring back items the company renamed or deleted.

        `automation` also fills the channels' welcome and away messages and adds the menu rules, on the first application only;
        `flows` adds the sector's missing starter forms to the channels as drafts, whenever it is asked for.
        """
        self.ensure_one()
        preset = PRESETS[key]
        first = key not in self.applied_preset_ids.mapped('key')
        if first:
            self._liwan_seed_preset_items(preset)
        self.write(preset.get('settings', {}))
        if first:
            self.applied_preset_ids = [Command.create({'key': key})]
            self._liwan_fill_campaigns(preset.get('campaigns', {}))
            if automation:
                self._liwan_seed_automation(preset.get('automation', {}))
        if flows:
            self.env['liwan.inbox.flow']._liwan_seed_starters(self.company_id, key)
        return self

    def _liwan_seed_preset_items(self, preset):
        """Create the departments, tags and canned replies of `preset` that the company lacks."""
        company_id = self.company_id.id
        for model, field, names in (
            ('liwan.inbox.department', 'name', preset['departments']),
            ('liwan.inbox.tag', 'name', preset['tags']),
        ):
            Model = self.env[model]
            existing = set(Model.search([('company_id', '=', company_id)]).mapped(field))
            Model.create([{field: name, 'company_id': company_id} for name in names if name not in existing])
        Canned = self.env['liwan.inbox.canned.reply']
        existing = set(Canned.search([('company_id', '=', company_id)]).mapped('shortcut'))
        Canned.create([
            {'shortcut': shortcut, 'body': body, 'company_id': company_id}
            for shortcut, body in preset['canned_replies'] if shortcut not in existing
        ])

    def _liwan_seed_automation(self, automation):
        """Fill the missing welcome and away messages of the company's channels and add the missing menu rules, switched off."""
        company = self.company_id
        channels = self.env['liwan.inbox.channel'].search([('owner_company_id', '=', company.id)])
        for channel in channels:
            channel._liwan_fill_automation(automation.get('welcome'), automation.get('away'))
        Rule = self.env['liwan.inbox.rule'].with_context(active_test=False)
        existing = set(Rule.search([('company_id', '=', company.id)]).mapped('name'))
        sequence = max(Rule.search([('company_id', '=', company.id)]).mapped('sequence'), default=0)
        for spec in automation.get('rules', []):
            if spec['name'] in existing:
                continue
            sequence += 10
            rule = Rule.create({
                'company_id': company.id, 'sequence': sequence, 'name': spec['name'], 'match_kind': 'option', 'active': False,
                'option_id': spec['option_id'],
                'department_id': self._liwan_named('liwan.inbox.department', spec.get('department')),
                'tag_ids': [(6, 0, [self._liwan_named('liwan.inbox.tag', name) for name in spec.get('tags', [])])],
            })
            rule._liwan_set_reply(spec['reply'])

    def _liwan_named(self, model, name):
        """The id of the company's department or tag called `name` (False without a name)."""
        return self.env[model].search([('company_id', '=', self.company_id.id), ('name', '=', name)], limit=1).id if name else False
