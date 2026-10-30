# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

FINANCE_FEATURE = 'finance.enabled'


class ProjectProject(models.Model):
    _inherit = 'project.project'

    liwan_cost_center_ids = fields.One2many('account.analytic.account', 'liwan_project_id', string='Cost centers')

    @api.model_create_multi
    def create(self, vals_list):
        projects = super().create(vals_list)
        if self.env['liwan.entitlement.service']._liwan_feature_write(FINANCE_FEATURE):
            for project in projects.filtered(lambda p: p.company_id.liwan_pmo_finance_cost_center_mode == 'auto'):
                project._liwan_create_cost_center()
        return projects

    def _liwan_create_cost_center(self):
        """A cost center named after the project, in the stock project plan, created as the real user.

        PMO may run a policy create in an elevated environment; this one never inherits it: the user's own
        environment is used, and a user without create access on cost centers gets none (a user with
        ``finance.analytic.manage`` can link one later).
        """
        self.ensure_one()
        user_env = self.env(su=False)
        accounts = user_env['account.analytic.account']
        if not accounts.has_access('create'):
            return accounts
        project_plan, _other_plans = user_env['account.analytic.plan']._get_all_plans()
        return accounts.create({
            'name': self.name,
            'code': self.liwan_code or False,
            'company_id': self.company_id.id,
            'plan_id': project_plan.id,
            'liwan_project_id': self.id,
        })
