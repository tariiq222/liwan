# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Who reads which ticket.

The record rules of ``security/helpdesk_rules.xml`` enforce the policy on every ORM path; this model
is their Python mirror for the working companies, used by the routes so a list and a record answer
the same way. Three modes per company, from ``liwan.helpdesk.settings``: ``own`` (the tickets assigned
to me and the unassigned ones of my teams), ``team`` (my teams' tickets and my own) and ``all`` (the
whole company). Holding ``helpdesk.tickets.assign`` opens the whole company whatever the setting,
because assigning a ticket to somebody else requires seeing it first. Every employee who holds
``helpdesk.tickets.request`` also reads the tickets they asked for, whatever the mode.
"""
from odoo import api, models
from odoo.fields import Domain

from .access_service import ASSIGN, READ, REQUESTS_READ

NOTHING = Domain('id', 'in', [])


class LiwanHelpdeskVisibility(models.AbstractModel):
    _name = 'liwan.helpdesk.visibility'
    _description = 'LiwanOS Support Desk visibility policy'

    @api.model
    def _liwan_keys(self, user, company):
        return self.env['liwan.access.service']._liwan_capability_keys(user, company=company)

    @api.model
    def _liwan_domain(self, user=None):
        """The tickets ``user`` reads across the working companies."""
        user = user or self.env.user
        service = self.env['liwan.access.service']
        settings_model = self.env['liwan.helpdesk.settings']
        clauses = []
        for company in self.env.companies:
            keys = service._liwan_capability_keys(user, company=company)
            scope = Domain('company_id', '=', company.id)
            if REQUESTS_READ in keys:
                clauses.append(scope & Domain('liwan_requester_user_id', '=', user.id))
            if READ not in keys:
                continue
            mode = settings_model._liwan_for(company).visibility
            if ASSIGN in keys or mode == 'all':
                clauses.append(scope)
                continue
            teams = Domain('team_id', 'in', user.helpdesk_team_ids.ids)
            if mode == 'own':
                clauses.append(scope & Domain.OR([
                    Domain('user_id', '=', user.id),
                    Domain('user_id', '=', False) & teams,
                ]))
            else:
                clauses.append(scope & Domain.OR([
                    teams, Domain('user_id', '=', user.id), Domain('team_id', '=', False),
                ]))
        if not clauses:
            return NOTHING
        return Domain.OR(clauses)
