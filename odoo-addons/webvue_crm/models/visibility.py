# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

ASSIGN_CAPABILITY = 'crm.leads.assign'


def teammate_domain(user_id):
    """Opportunities whose agent shares an active sales-team membership with ``user_id``.

    Spelled with explicit ``active`` terms because record rules are evaluated with
    ``active_test=False``; security/crm_rules.xml repeats it verbatim.
    """
    return [('user_id.crm_team_member_ids', 'any', [
        ('active', '=', True),
        ('crm_team_id.crm_team_member_ids', 'any', [('active', '=', True), ('user_id', '=', user_id)]),
    ])]


class WebVueCrmVisibility(models.AbstractModel):
    """Who reads and writes which opportunity (spec "Visibility, enforced on the server").

    The record rules in security/crm_rules.xml enforce the policy on every ORM path (lists,
    detail, attachments, messages); ``_webvue_domain`` is its Python mirror for the current
    company, used by the routes, the export and the dashboard counts.
    """

    _name = 'webvue.crm.visibility'
    _description = 'WebVue CRM visibility policy'

    @api.model
    def _webvue_can_assign(self, user, company):
        return ASSIGN_CAPABILITY in self.env['webvue.access.service']._webvue_capability_keys(user, company=company)

    @api.model
    def _webvue_domain(self, user):
        """The opportunities ``user`` reads in the current company under its visibility mode."""
        company = self.env.company
        scope = [('company_id', '=', company.id), ('type', '=', 'opportunity')]
        if self._webvue_can_assign(user, company):
            return scope
        own = [('user_id', '=', user.id)]
        mode = self.env['webvue.crm.settings']._webvue_effective()['visibility']
        if mode == 'all':
            return [*scope, ('user_id', '!=', False)]
        if mode == 'team':
            return [*scope, '|', *own, *teammate_domain(user.id)]
        return [*scope, *own]

    @api.model
    def _webvue_check_write(self, leads, user):
        """Raise AccessError unless ``user`` owns every lead or may assign in the lead's company."""
        for lead in leads:
            if lead.user_id != user and not self._webvue_can_assign(user, lead.company_id):
                msg = 'only the agent of this opportunity may change it'
                raise AccessError(msg)
