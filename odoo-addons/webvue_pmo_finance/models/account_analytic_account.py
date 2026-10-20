# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


class AccountAnalyticAccount(models.Model):
    _inherit = 'account.analytic.account'

    # Stock project.project.account_id is not used: stock renames and deletes the analytic account of a project
    # on project write and unlink, in the caller's environment.
    webvue_project_id = fields.Many2one(
        'project.project', string='Project', ondelete='set null', index=True, copy=False,
        help="The project whose actual cost is the posted expense of this cost center.",
    )

    _webvue_project_uniq = models.Constraint(
        'UNIQUE(webvue_project_id)', 'A project has one cost center.',
    )

    @api.constrains('webvue_project_id', 'company_id')
    def _check_webvue_project_company(self):
        for account in self.filtered('webvue_project_id'):
            if account.company_id != account.webvue_project_id.company_id:
                raise ValidationError(self.env._("The cost center and its project must belong to the same company."))
