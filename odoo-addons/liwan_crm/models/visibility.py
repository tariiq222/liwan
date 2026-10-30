# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

READ_CAPABILITY = 'crm.leads.read'
ASSIGN_CAPABILITY = 'crm.leads.assign'
NOTHING = [('id', 'in', [])]


def teammate_domain(user_id, company_ids):
    """Opportunities whose agent shares an active sales team with ``user_id``.

    The team must be active and belong to one of ``company_ids`` (or to no company), and both
    memberships must be active. Spelled with explicit ``active`` terms because record rules are
    evaluated with ``active_test=False``; security/crm_rules.xml repeats it verbatim.
    """
    return [('user_id.crm_team_member_ids', 'any', [
        ('active', '=', True),
        ('crm_team_id.active', '=', True),
        ('crm_team_id.company_id', 'in', [*company_ids, False]),
        ('crm_team_id.crm_team_member_ids', 'any', [('active', '=', True), ('user_id', '=', user_id)]),
    ])]


class LiwanCrmVisibility(models.AbstractModel):
    """Who reads and writes which opportunity (spec "Visibility, enforced on the server").

    The record rules in security/crm_rules.xml enforce the policy on every ORM path (lists,
    detail, attachments, messages); ``_liwan_domain`` is its Python mirror for the current
    company, used by the routes, the export and the dashboard counts.
    """

    _name = 'liwan.crm.visibility'
    _description = 'LiwanOS CRM visibility policy'

    @api.model
    def _liwan_keys(self, user, company):
        return self.env['liwan.access.service']._liwan_capability_keys(user, company=company)

    @api.model
    def _liwan_can_assign(self, user, company):
        return ASSIGN_CAPABILITY in self._liwan_keys(user, company)

    @api.model
    def _liwan_domain(self, user):
        """The opportunities ``user`` reads in the current company under its visibility mode.

        Nothing without crm.leads.read in the current company, not even the user's own
        opportunities: no CRM capability in a company means no CRM data there.
        """
        company = self.env.company
        keys = self._liwan_keys(user, company)
        if READ_CAPABILITY not in keys:
            return NOTHING
        scope = [('company_id', '=', company.id), ('type', '=', 'opportunity')]
        if ASSIGN_CAPABILITY in keys:
            return scope
        own = [('user_id', '=', user.id)]
        mode = self.env['liwan.crm.settings']._liwan_effective()['visibility']
        if mode == 'all':
            return [*scope, ('user_id', '!=', False)]
        if mode == 'team':
            return [*scope, '|', *own, *teammate_domain(user.id, self.env.companies.ids)]
        return [*scope, *own]

    @api.model
    def _liwan_check_write(self, leads, user):
        """Raise AccessError unless, in each lead's company, ``user`` may assign, or holds
        crm.leads.read and is the lead's agent (the write record rule, in Python)."""
        for lead in leads:
            keys = self._liwan_keys(user, lead.company_id)
            if ASSIGN_CAPABILITY not in keys and (READ_CAPABILITY not in keys or lead.user_id != user):
                msg = 'only the agent of this opportunity may change it'
                raise AccessError(msg)
