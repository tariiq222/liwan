# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict

from odoo import api, models
from odoo.tools import SQL

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_crm.models.crm_settings import DEFAULTS

WORK_CAPABILITY = 'crm.leads.work'
# Columns a first-assignment row carries besides the company's defaults.
_ROW_COLUMNS = ('company_id', 'revision', 'round_robin_index', 'create_uid', 'write_uid', *DEFAULTS)


class WebVueCrmDistribution(models.AbstractModel):
    """Who takes a new opportunity: round robin, the manual pool, or the agent chosen at import."""

    _name = 'webvue.crm.distribution'
    _description = 'WebVue CRM distribution'

    @api.model
    def _webvue_company_settings(self, company):
        return self.env['webvue.crm.settings'].with_company(company).search(
            [('company_id', '=', company.id)], limit=1,
        )

    @api.model
    def _webvue_eligible_agents(self, company):
        """Active company users, ordered by id, who hold ``crm.leads.work`` in ``company``.

        The company's pool narrows the candidates; an empty pool means every user of the company.
        """
        settings = self._webvue_company_settings(company)
        candidates = settings.distribution_user_ids or self.env['res.users'].search([
            ('company_ids', 'in', company.id), ('share', '=', False),
        ])
        service = self.env['webvue.access.service']
        return candidates.filtered(
            lambda user: user.active
            and company in user.company_ids
            and service._webvue_has_capability(user, WORK_CAPABILITY, company=company),
        ).sorted('id')

    @api.model
    def _webvue_assign(self, leads, mode=None, agent=None):
        """Set ``user_id`` on ``leads`` by ``mode`` (default: the lead company's setting).

        ``manual`` changes nothing. ``on_import`` assigns ``agent`` (422 unless eligible; no
        agent leaves the leads alone). ``round_robin`` walks the eligible agents from the stored
        pointer. Runs in the caller's environment, as the acting user or as the cron superuser.
        """
        for company, company_leads in self._webvue_by_company(leads).items():
            settings = self._webvue_company_settings(company)
            effective = mode or settings.distribution_mode or DEFAULTS['distribution_mode']
            if effective == 'on_import':
                self._webvue_assign_chosen(company_leads, company, agent)
            elif effective == 'round_robin':
                self._webvue_assign_round_robin(company_leads, company)

    @api.model
    def _webvue_by_company(self, leads):
        groups = defaultdict(list)
        for lead in leads.sorted('id'):
            groups[lead.company_id or self.env.company].append(lead.id)
        return {company: leads.browse(ids) for company, ids in groups.items()}

    @api.model
    def _webvue_assign_chosen(self, leads, company, agent):
        if not agent:
            return
        if agent not in self._webvue_eligible_agents(company):
            raise ApiError(422, 'invalid', 'the chosen agent cannot take opportunities', field='user_id')
        leads.write({'user_id': agent.id})

    @api.model
    def _webvue_assign_round_robin(self, leads, company):
        eligible = self._webvue_eligible_agents(company)
        if not eligible:
            return
        row = self._webvue_locked_row(company)
        self.env.cr.execute(SQL('SELECT round_robin_index FROM %s WHERE id = %s', SQL.identifier(row._table), row.id))
        start = self.env.cr.fetchone()[0]
        picks = defaultdict(list)
        for offset, lead in enumerate(leads):
            picks[eligible[(start + offset) % len(eligible)]].append(lead.id)
        for user, ids in picks.items():
            leads.browse(ids).write({'user_id': user.id})
        # The pointer is internal bookkeeping on our own table, so it is moved in SQL: an agent
        # has no write ACL on the settings row and a pointer move is not a settings revision.
        self.env.cr.execute(SQL(
            'UPDATE %s SET round_robin_index = %s WHERE id = %s',
            SQL.identifier(row._table), (start + len(leads)) % len(eligible), row.id,
        ))
        row.invalidate_recordset(['round_robin_index'])

    @api.model
    def _webvue_locked_row(self, company):
        """The company's settings row, created with defaults on first use, locked until commit."""
        row = self._webvue_company_settings(company)
        if not row:
            self._webvue_insert_defaults(company)
            row = self._webvue_company_settings(company)
        row.flush_recordset()
        self.env.cr.execute(SQL('SELECT 1 FROM %s WHERE id = %s FOR UPDATE', SQL.identifier(row._table), row.id))
        return row

    @api.model
    def _webvue_insert_defaults(self, company):
        """Insert the default row in SQL (an agent holds no create ACL); a concurrent insert wins."""
        values = {
            'company_id': company.id, 'revision': 1, 'round_robin_index': 0,
            'create_uid': self.env.uid, 'write_uid': self.env.uid, **DEFAULTS,
        }
        stamp = SQL("(now() at time zone 'utc')")
        self.env.cr.execute(SQL(
            'INSERT INTO %s (%s, create_date, write_date) VALUES (%s, %s, %s) ON CONFLICT (company_id) DO NOTHING',
            SQL.identifier(self.env['webvue.crm.settings']._table),
            SQL(', ').join(SQL.identifier(name) for name in _ROW_COLUMNS),
            SQL(', ').join(SQL('%s', values[name]) for name in _ROW_COLUMNS),
            stamp, stamp,
        ))
        self.env['webvue.crm.settings'].invalidate_model()
