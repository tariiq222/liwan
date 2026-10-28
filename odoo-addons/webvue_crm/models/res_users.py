# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .visibility import ASSIGN_CAPABILITY


class ResUsers(models.Model):
    _inherit = 'res.users'

    # Read by the crm.lead record rules (security/crm_rules.xml): the companies where this user holds
    # crm.leads.assign. Not stored: a capability change syncs the user's groups, which clears the
    # rule cache, and the next request computes it afresh.
    webvue_crm_assign_company_ids = fields.Many2many(
        'res.company', compute='_compute_webvue_crm_assign_company_ids',
    )

    def _compute_webvue_crm_assign_company_ids(self):
        service = self.env['webvue.access.service']
        for user in self:
            user.webvue_crm_assign_company_ids = user.company_ids.filtered(
                lambda company, user=user: ASSIGN_CAPABILITY in service._webvue_capability_keys(user, company=company),
            )
