# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.tools import sql

SCHEDULE_POLICIES = ('all_employees', 'organizers_only')
MINUTE_SEQUENCE_CODE = 'liwan.meeting.minute'
# Inclusive (min, max) of every numeric setting; the database CHECKs and the API parser read this one table.
INTEGER_RANGES = {'reminder_hours': (1, 168)}
REFERENCE_PREFIX_PATTERN = r'[A-Z0-9]{1,10}'
# Today's behavior: only holders of meetings.create (system administrators and the organizer role) schedule,
# a reminder goes out a day ahead, and the minutes are numbered ``MIN/<year>/<sequence>``.
DEFAULTS = {'schedule_policy': 'organizers_only', 'reminder_hours': 24, 'reference_prefix': 'MIN'}


def _range_check(name):
    low, high = INTEGER_RANGES[name]
    return models.Constraint(
        'CHECK(%s BETWEEN %d AND %d)' % (name, low, high), '%s must be between %d and %d' % (name, low, high),
    )


class LiwanMeetingSettings(models.Model):
    """One company's meetings policy: who may schedule, how early the reminder goes out, the reference prefix."""

    _name = 'liwan.meeting.settings'
    _description = 'LiwanOS meetings settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    revision = fields.Integer(required=True, default=1)
    schedule_policy = fields.Selection(
        [(value, value) for value in SCHEDULE_POLICIES], required=True, default=DEFAULTS['schedule_policy'],
    )
    # How early the reminder cron tells the participants, counted back from the meeting start.
    reminder_hours = fields.Integer(required=True, default=DEFAULTS['reminder_hours'])
    # The tenant's own numbering identity: the first segment of every new meeting reference.
    reference_prefix = fields.Char(required=True, default=DEFAULTS['reference_prefix'])

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one meetings settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')
    _reminder_range = _range_check('reminder_hours')
    _prefix_format = models.Constraint(
        "CHECK(reference_prefix ~ '^%s$')" % REFERENCE_PREFIX_PATTERN,
        'the reference prefix is 1 to 10 of A-Z and 0-9',
    )

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._liwan_bump_access()
        return records

    def write(self, vals):
        result = super().write(vals)
        # Only the scheduling policy feeds the capability composition; the reminder window and the
        # prefix change no identity, so saving them leaves every open session's access cache alone.
        if 'schedule_policy' in vals:
            self._liwan_bump_access()
        return result

    def unlink(self):
        companies = self.company_id
        result = super().unlink()
        self.env['liwan.access.service']._liwan_bump_policy(companies)
        return result

    def _liwan_bump_access(self):
        # The policy changes who holds meetings.create, so open sessions must reload their identity.
        self.env['liwan.access.service']._liwan_bump_policy(self.company_id)

    @api.model
    def _liwan_current(self):
        """The current company's row, or an empty recordset when it was never saved."""
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_effective(self):
        """Every setting of the current company, exact defaults when no row exists. Never writes."""
        return self._liwan_values(self._liwan_current())

    def _liwan_values(self, row=None):
        """The values of ROW, or the defaults while the company never saved one."""
        values = {name: row[name] for name in DEFAULTS} if row else dict(DEFAULTS)
        # A row saved before the prefix existed has an empty one; the reference still needs a first segment.
        values['reference_prefix'] = values['reference_prefix'] or DEFAULTS['reference_prefix']
        return values

    @api.model
    def _liwan_schedule_policy(self, company):
        """The scheduling policy of COMPANY for any caller.

        The access service asks this while it composes capabilities, for users that cannot read the
        settings table, so the single value is read in SQL.
        """
        return self._liwan_column(company, 'schedule_policy')

    @api.model
    def _liwan_reference_prefix(self, company):
        """The reference prefix of COMPANY for the meeting create path, read in SQL like the policy.

        The identifier is a constant of this module and COMPANY may differ from the acting user's
        companies in a scheduled job, so neither the row nor the prefix needs the ORM's read rights.
        """
        return self._liwan_column(company, 'reference_prefix')

    @api.model
    def _liwan_column(self, company, column):
        """One column of COMPANY's settings row, read in SQL, or its declared default."""
        if column not in DEFAULTS:
            msg = 'unknown meetings setting %r' % column
            raise ValueError(msg)
        if not sql.table_exists(self.env.cr, self._table):
            # An upgrade composes capabilities before this addon has created its table.
            return DEFAULTS[column]
        self.flush_model(['company_id', column])
        self.env.cr.execute(
            'SELECT %s FROM liwan_meeting_settings WHERE company_id = %%s' % column, [company.id],
        )
        row = self.env.cr.fetchone()
        return row[0] if row and row[0] else DEFAULTS[column]


class ResCompany(models.Model):
    _inherit = 'res.company'

    # The company's reminder window, read without a settings-table lookup from a cron record (the cron
    # runs as the system user, whose companies may differ from the meeting's).
    liwan_meeting_reminder_hours = fields.Integer(compute='_compute_liwan_meeting_reminder_hours')

    @api.depends('name')
    def _compute_liwan_meeting_reminder_hours(self):
        settings = {row.company_id: row.reminder_hours for row in self.env['liwan.meeting.settings'].search([
            ('company_id', 'in', self.ids),
        ])}
        for company in self:
            company.liwan_meeting_reminder_hours = settings.get(company, DEFAULTS['reminder_hours'])
