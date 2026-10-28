# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict

from psycopg2.errors import UniqueViolation

from odoo import api, models
from odoo.tools import SQL

from odoo.addons.webvue_api.controllers.common import ApiError

WORK_CAPABILITY = 'crm.leads.work'


class WebVueCrmDistribution(models.AbstractModel):
    """Who takes a new opportunity: round robin, the manual pool, or the agent chosen at import."""

    _name = 'webvue.crm.distribution'
    _description = 'WebVue CRM distribution'

    @api.model
    def _webvue_eligible_agents(self, company):
        """Active company users, ordered by id, who hold ``crm.leads.work`` in ``company``.

        The company's pool narrows the candidates; an empty pool means every user of the company.
        The search itself guarantees active and company membership on both paths. The capability is
        read with ``company`` as the current company, so a branch lead is judged in its own company.
        """
        scoped = self.with_company(company).env
        pool = scoped['webvue.crm.settings']._webvue_effective()['distribution_user_ids']
        domain = [('company_ids', 'in', company.id), ('share', '=', False)]
        if pool:
            domain.append(('id', 'in', pool))
        service = scoped['webvue.access.service']
        return scoped['res.users'].search(domain, order='id').filtered(
            lambda user: service._webvue_has_capability(user, WORK_CAPABILITY, company=company),
        )

    @api.model
    def _webvue_assign(self, leads, mode=None, agent=None):
        """Set ``user_id`` on ``leads`` by ``mode`` (default: the lead company's setting).

        ``manual`` changes nothing. ``on_import`` assigns ``agent`` (422 unless eligible; no
        agent leaves the leads alone). ``round_robin`` takes the next eligible agent after the
        one who took the previous opportunity. A lead without a company is never assigned.
        Runs in the caller's environment, as the acting user or as the cron superuser.
        """
        groups = defaultdict(list)
        for lead in leads.filtered('company_id').sorted('id'):
            groups[lead.company_id].append(lead.id)
        for company, ids in groups.items():
            company_leads = leads.browse(ids)
            effective = mode or self.env['webvue.crm.settings'].with_company(company)._webvue_effective()[
                'distribution_mode'
            ]
            if effective == 'on_import':
                self._webvue_assign_chosen(company_leads, company, agent)
            elif effective == 'round_robin':
                self._webvue_assign_round_robin(company_leads, company)

    @api.model
    def _webvue_assign_chosen(self, leads, company, agent):
        if not agent:
            return
        if agent not in self._webvue_eligible_agents(company):
            raise ApiError(422, 'invalid', 'the chosen agent cannot take opportunities', field='user_id')
        leads.write({'user_id': agent.id})

    @api.model
    def _webvue_assign_round_robin(self, leads, company):
        eligible_ids = self._webvue_eligible_agents(company).ids
        if not eligible_ids:
            return
        rotation = self._webvue_locked_rotation(company)
        last_id = rotation.last_user_id.id
        picks = defaultdict(list)
        for lead in leads:
            last_id = next((user_id for user_id in eligible_ids if user_id > last_id), eligible_ids[0])
            picks[last_id].append(lead.id)
        for user_id, ids in picks.items():
            leads.browse(ids).write({'user_id': user_id})
        rotation.last_user_id = last_id

    @api.model
    def _webvue_locked_rotation(self, company):
        """The company's rotation row, created on first use, locked until commit with a fresh read."""
        rotation = self._webvue_rotation(company)
        if not rotation:
            try:
                with self.env.cr.savepoint():
                    rotation = self.env['webvue.crm.rotation'].with_company(company).create({'company_id': company.id})
            except UniqueViolation:
                rotation = self._webvue_rotation(company)
        rotation.flush_recordset()
        self.env.cr.execute(SQL('SELECT 1 FROM %s WHERE id = %s FOR UPDATE', SQL.identifier(rotation._table), rotation.id))
        rotation.invalidate_recordset(['last_user_id'])
        return rotation

    @api.model
    def _webvue_rotation(self, company):
        return self.env['webvue.crm.rotation'].with_company(company).search([('company_id', '=', company.id)], limit=1)
