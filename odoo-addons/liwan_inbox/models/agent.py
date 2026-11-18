# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Availability of the agents of a company: a manual status and, when the company turns shifts on, a weekly schedule."""
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import ConcurrencyError

NOTE_RELEASED = 'أُلغي إسناد المحادثة من %s لأنه أصبح غير متاح'


class LiwanInboxAgent(models.Model):
    """One row per agent and company, created on the first status toggle or shift save; no row means available, no shifts."""
    _name = 'liwan.inbox.agent'
    _description = 'Customer Messages agent availability'
    _liwan_scope = 'company'

    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    available = fields.Boolean(default=True)
    # The agent's shifts: weekly ranges read in the company's inbox timezone; no ranges means always in shift.
    hours_range_ids = fields.One2many('liwan.inbox.hours.range', 'agent_id')

    _user_company_unique = models.Constraint('UNIQUE(user_id, company_id)', 'An agent has one availability row per company.')

    # availability

    @api.model
    def _liwan_availability(self, users, company, at=None):
        """{user id: (available, in shift)} of `users` in `company` at the UTC moment `at` (now).

        The one place that decides availability: an agent without a row is available and in shift; shifts count only
        while the company's `agent_shifts_enabled` is on, and an agent without ranges is always in shift.
        """
        settings = self.env['liwan.inbox.settings']._liwan_read_for_company(company)
        at = at or fields.Datetime.now()
        hours = self.env['liwan.inbox.working.hours']
        rows = {row.user_id.id: row for row in self.search([('company_id', '=', company.id), ('user_id', 'in', users.ids)])}
        state = {}
        for user in users:
            row = rows.get(user.id)
            in_shift = not (row and settings.agent_shifts_enabled) or hours._liwan_in_ranges(
                row.hours_range_ids, settings.hours_timezone, (), at,
            )
            state[user.id] = (row.available if row else True, in_shift)
        return state

    @api.model
    def _liwan_available_agents(self, users, company, at=None):
        """The users of `users` who are effectively available in `company`: available and inside their shift."""
        state = self._liwan_availability(users, company, at)
        return users.filtered(lambda user: all(state[user.id]))

    # writes

    @api.model
    def _liwan_row(self, user, company):
        """The agent's row in `company`, created when they have none."""
        row = self.search([('company_id', '=', company.id), ('user_id', '=', user.id)], limit=1)
        if row:
            return row
        try:
            with self.env.cr.savepoint():
                return self.create({'user_id': user.id, 'company_id': company.id})
        except UniqueViolation as error:
            # A concurrent first request created the row; this transaction's snapshot cannot see it, so the request is replayed.
            raise ConcurrencyError(self.env._('The agent row was created by a concurrent request')) from error

    @api.model
    def _liwan_set_available(self, user, company, available):
        """Switch the agent's manual status; going unavailable releases their open conversations when the company says so."""
        row = self._liwan_row(user, company)
        was_available, row.available = row.available, available
        settings = self.env['liwan.inbox.settings']._liwan_read_for_company(company)
        if was_available and not available and settings.unavailable_release == 'release':
            self._liwan_release(user, company)
        return row

    @api.model
    def _liwan_release(self, user, company):
        """Take the agent's open and pending conversations off them; the customer's next message assigns them again."""
        conversations = self.env['liwan.inbox.conversation'].search([
            ('company_id', '=', company.id), ('assignee_id', '=', user.id), ('state', 'in', ('open', 'pending')),
        ])
        for conversation in conversations:
            conversation.assignee_id = False
            self.env['liwan.inbox.message']._liwan_post_system_note(conversation, NOTE_RELEASED % user.name)
        conversations._liwan_notify_bus()

    @api.model
    def _liwan_write_shifts(self, user, company, days):
        """Replace the agent's weekly shift ranges with validated contract `days`."""
        row = self._liwan_row(user, company)
        row.hours_range_ids = self.env['liwan.inbox.working.hours']._liwan_range_commands(days)
        return row
