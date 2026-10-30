# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.tools import sql

SCHEDULE_POLICIES = ('all_employees', 'organizers_only')
# Today's behavior: only holders of meetings.create (system administrators and the organizer role) schedule.
DEFAULTS = {'schedule_policy': 'organizers_only'}


class LiwanMeetingSettings(models.Model):
    """One company's meetings policy: who may schedule a meeting or a series."""

    _name = 'liwan.meeting.settings'
    _description = 'LiwanOS meetings settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    revision = fields.Integer(required=True, default=1)
    schedule_policy = fields.Selection(
        [(value, value) for value in SCHEDULE_POLICIES], required=True, default=DEFAULTS['schedule_policy'],
    )

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one meetings settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._liwan_bump_access()
        return records

    def write(self, vals):
        result = super().write(vals)
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
        row = self._liwan_current()
        return {name: row[name] for name in DEFAULTS} if row else dict(DEFAULTS)

    @api.model
    def _liwan_schedule_policy(self, company):
        """The scheduling policy of COMPANY for any caller.

        The access service asks this while it composes capabilities, for users that cannot read the
        settings table, so the single value is read in SQL: the company's own row or the default.
        """
        if not sql.table_exists(self.env.cr, self._table):
            # An upgrade composes capabilities before this addon has created its table.
            return DEFAULTS['schedule_policy']
        self.flush_model(['company_id', 'schedule_policy'])
        self.env.cr.execute(
            'SELECT schedule_policy FROM liwan_meeting_settings WHERE company_id = %s', [company.id],
        )
        row = self.env.cr.fetchone()
        return row[0] if row else DEFAULTS['schedule_policy']
