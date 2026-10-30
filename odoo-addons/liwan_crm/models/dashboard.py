# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from odoo import api, fields, models


class LiwanCrmDashboard(models.AbstractModel):
    """The counts of the CRM landing page, every one taken over the caller's visible opportunities."""

    _name = 'liwan.crm.dashboard'
    _description = 'LiwanOS CRM dashboard'

    @api.model
    def _liwan_day_starts(self, company, user):
        """UTC start of today and of this month in the company's timezone.

        The timezone is the one of the company's working calendar, else the user's, else UTC.
        """
        zone = self._liwan_zone(company.resource_calendar_id.tz or user.tz)
        local_now = datetime.now(zone)
        today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        return tuple(
            moment.astimezone(UTC).replace(tzinfo=None) for moment in (today, today.replace(day=1))
        )

    @api.model
    def _liwan_zone(self, name):
        try:
            return ZoneInfo(name or 'UTC')
        except ZoneInfoNotFoundError:
            return ZoneInfo('UTC')

    @api.model
    def _liwan_dashboard(self, user):
        """The agent block of ``user`` and, for a holder of crm.leads.assign, the manager block."""
        company = self.env.company
        today, month = self._liwan_day_starts(company, user)
        visibility = self.env['liwan.crm.visibility']
        visible = visibility._liwan_domain(user)
        now = fields.Datetime.now()
        scope = _Scope(self.env['crm.lead'], visible, now, month)
        mine = [('user_id', '=', user.id)]
        agent = {
            'due_now': scope.count([*mine, *scope.due]),
            'new_today': scope.count([*mine, ('create_date', '>=', today)]),
            'won_this_month': scope.won_this_month(mine),
        }
        manager = None
        if visibility._liwan_can_assign(user, company):
            manager = self._liwan_manager_block(scope, company)
        return {'agent': agent, 'manager': manager}

    @api.model
    def _liwan_manager_block(self, scope, company):
        return {
            'unassigned': scope.count([('user_id', '=', False), *scope.open]),
            'needs_manager': scope.count([('liwan_needs_manager', '=', True), *scope.open]),
            'due_follow_ups': scope.count(scope.due),
            'won_this_month': scope.won_this_month([]),
            'conversion_by_source': self._liwan_conversion(scope),
            'agents': self._liwan_agents(scope, company),
        }

    @api.model
    def _liwan_conversion(self, scope):
        """Per source: opportunities created this month (lost ones included) and the won among them."""
        created = [('create_date', '>=', scope.month)]
        totals = dict(scope.grouped(created, 'source_id', archived=True))
        wins = dict(scope.grouped([*created, ('won_status', '=', 'won')], 'source_id', archived=True))
        return [
            {'source_id': source.id or None, 'name': source.name or '', 'total': total, 'won': wins.get(source, 0)}
            for source, total in sorted(totals.items(), key=lambda item: (not item[0], item[0].id))
        ]

    @api.model
    def _liwan_agents(self, scope, company):
        """One row per eligible agent and per user holding open opportunities."""
        opened = dict(scope.grouped([('user_id', '!=', False), *scope.open], 'user_id'))
        won = dict(scope.grouped([('won_status', '=', 'won'), ('date_closed', '>=', scope.month)], 'user_id'))
        due = dict(scope.grouped([('user_id', '!=', False), *scope.due], 'user_id'))
        users = self.env['liwan.crm.distribution']._liwan_eligible_agents(company)
        for counted in (opened, won, due):
            users |= self.env['res.users'].union(*counted)
        return [
            {'user_id': user.id, 'name': user.name, 'open': opened.get(user, 0), 'won': won.get(user, 0),
             'due': due.get(user, 0)}
            for user in users.sorted('id') if user
        ]


class _Scope:
    """Counting helpers over one visibility domain at one moment."""

    def __init__(self, lead_model, visible, now, month):
        self.model = lead_model
        self.visible = visible
        self.month = month
        self.open = [('won_status', '=', 'pending')]
        self.due = [*self.open, ('liwan_next_call_at', '<=', now)]

    def count(self, domain):
        return self.model.search_count([*self.visible, *domain])

    def grouped(self, domain, field, archived=False):
        model = self.model.with_context(active_test=False) if archived else self.model
        return model._read_group([*self.visible, *domain], [field], ['__count'])

    def won_this_month(self, domain):
        rows = self.model._read_group(
            [*self.visible, *domain, ('won_status', '=', 'won'), ('date_closed', '>=', self.month)],
            [], ['__count', 'expected_revenue:sum'],
        )
        count, value = rows[0]
        return {'count': count, 'value': float(value or 0.0)}
