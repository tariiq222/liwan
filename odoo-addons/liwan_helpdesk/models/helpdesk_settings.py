# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support Desk settings of one company: the ticket policy a tenant shapes without code.

One record per company holds the choices that change behaviour: who sees which ticket, which team
and priority a new ticket takes, the reference prefix of its sequence, how long a closed ticket may be
reopened, and the first-response and resolution targets the counters measure. Sector presets set several of
them at once and leave the rest alone.
"""
from odoo import api, fields, models
from odoo.exceptions import UserError

VISIBILITY = (('own', 'Own tickets'), ('team', 'My teams'), ('all', 'Whole company'))
PRIORITIES = (('0', 'Low'), ('1', 'Medium'), ('2', 'High'), ('3', 'Urgent'))
PRESETS = (
    ('general', 'General'),
    ('it', 'IT service desk'),
    ('maintenance', 'Maintenance and facilities'),
    ('public_sector', 'Public sector service desk'),
    ('retail', 'Retail after-sales'),
    ('care', 'Care and clinics'),
    ('education', 'Education'),
)
# Applying a preset writes exactly these keys; the general preset is the field default.
PRESET_VALUES = {
    'general': {
        'visibility': 'team', 'reopen_days': 7, 'first_response_hours': 8,
        'resolution_hours': 72, 'default_priority': '1',
    },
    'it': {
        'visibility': 'team', 'reopen_days': 14, 'first_response_hours': 2,
        'resolution_hours': 24, 'default_priority': '1',
    },
    'maintenance': {
        'visibility': 'team', 'reopen_days': 30, 'first_response_hours': 4,
        'resolution_hours': 48, 'default_priority': '1',
    },
    'public_sector': {
        'visibility': 'all', 'reopen_days': 3, 'first_response_hours': 24,
        'resolution_hours': 120, 'default_priority': '1',
    },
    'retail': {
        'visibility': 'team', 'reopen_days': 14, 'first_response_hours': 4,
        'resolution_hours': 72, 'default_priority': '2',
    },
    'care': {
        'visibility': 'team', 'reopen_days': 7, 'first_response_hours': 1,
        'resolution_hours': 8, 'default_priority': '2',
    },
    'education': {
        'visibility': 'team', 'reopen_days': 10, 'first_response_hours': 12,
        'resolution_hours': 96, 'default_priority': '1',
    },
}
DEFAULTS = {**PRESET_VALUES['general'], 'preset': 'general', 'reference_prefix': 'HD'}
INTEGER_RANGES = {
    'reopen_days': (0, 90),
    'first_response_hours': (0, 720),
    'resolution_hours': (0, 8760),
    'auto_close_days': (0, 365),
}
SEQUENCE_CODE = 'helpdesk.ticket.sequence'


def _range_check(name):
    low, high = INTEGER_RANGES[name]
    return models.Constraint(
        'CHECK(%s BETWEEN %d AND %d)' % (name, low, high), '%s must be between %d and %d' % (name, low, high),
    )


class LiwanHelpdeskSettings(models.Model):
    _name = 'liwan.helpdesk.settings'
    _description = 'Support Desk settings'
    _liwan_scope = 'company'
    _rec_name = 'company_id'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    revision = fields.Integer(default=0, readonly=True)
    preset = fields.Selection(PRESETS, default='general', required=True)
    visibility = fields.Selection(VISIBILITY, default='team', required=True)
    default_team_id = fields.Many2one('helpdesk.ticket.team', ondelete='restrict')
    default_priority = fields.Selection(PRIORITIES, default='1', required=True)
    reference_prefix = fields.Char(required=True, default='HD')
    reopen_days = fields.Integer(default=7, required=True)
    first_response_hours = fields.Integer(default=8, required=True)
    resolution_hours = fields.Integer(default=72, required=True)
    # The customer's page: whether a ticket gets a link, and whether closing it from there needs no agent.
    portal_enabled = fields.Boolean(default=True)
    # Automatic closing of an inactive ticket: 0 keeps it off; the stages it applies to are its own list.
    auto_close_days = fields.Integer(default=0, required=True)
    auto_close_stage_ids = fields.Many2many('helpdesk.ticket.stage', string='Auto-close stages')

    _company_unique = models.Constraint('UNIQUE(company_id)', 'one Support Desk settings record per company')
    _reopen_days_range = _range_check('reopen_days')
    _first_response_range = _range_check('first_response_hours')
    _resolution_range = _range_check('resolution_hours')
    _auto_close_range = _range_check('auto_close_days')

    @api.model
    def _liwan_current(self):
        return self._liwan_for(self.env.company)

    @api.model
    def _liwan_for(self, company):
        """The settings of ``company``, or the declared defaults when the row does not exist yet.

        Used by the ticket service, which runs for agents who may not read the settings surface.
        """
        row = self.search([('company_id', '=', company.id)], limit=1)
        if row:
            return row
        return self.new(DEFAULTS | {'company_id': company.id})

    def _liwan_apply_sequence(self):
        """Give the company a ticket sequence carrying the settings prefix.

        The capability group holds the ACL on ``ir.sequence`` and a record rule limits it to this code,
        so a settings manager writes its own sequence without elevation. The install hook creates the
        row for every existing company, and creating a company creates its row too.
        """
        self.ensure_one()
        sequence = self.env['ir.sequence'].search(
            [('code', '=', SEQUENCE_CODE), ('company_id', '=', self.company_id.id)], limit=1,
        )
        values = {'name': 'Support ticket', 'prefix': self.reference_prefix, 'padding': 5,
                  'company_id': self.company_id.id}
        if sequence:
            sequence.write(values)
        else:
            self.env['ir.sequence'].create({'code': SEQUENCE_CODE, **values})
        return sequence

    def _liwan_apply_sequence(self):
        """Give the company a ticket sequence carrying the settings prefix.

        The capability group holds the ACL on ``ir.sequence`` and a record rule limits it to this code,
        so a settings manager writes its own sequence without elevation. The install hook creates the
        row for every existing company, and creating a company creates its row too.
        """
        self.ensure_one()
        sequence = self.env['ir.sequence'].search(
            [('code', '=', SEQUENCE_CODE), ('company_id', '=', self.company_id.id)], limit=1,
        )
        values = {'name': 'Support ticket', 'prefix': self.reference_prefix, 'padding': 5,
                  'company_id': self.company_id.id}
        if sequence:
            sequence.write(values)
        else:
            self.env['ir.sequence'].create({'code': SEQUENCE_CODE, **values})
        return sequence

    @api.model_create_multi
    def create(self, vals_list):
        rows = super().create(vals_list)
        for row in rows:
            row._liwan_apply_sequence()
        return rows

    def write(self, vals):
        result = super().write(vals)
        if 'reference_prefix' in vals:
            for row in self:
                row._liwan_apply_sequence()
        return result

    def unlink(self):
        raise UserError(self.env._('Support Desk settings are not deleted'))
