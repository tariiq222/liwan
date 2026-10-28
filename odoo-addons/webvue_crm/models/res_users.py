# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .visibility import ASSIGN_CAPABILITY, READ_CAPABILITY


class ResUsers(models.Model):
    _inherit = 'res.users'

    # Read by the crm.lead record rules (security/crm_rules.xml): the companies where this user holds
    # crm.leads.read, and those where they hold crm.leads.assign. Capability groups are the union
    # over all the user's companies, so the rules scope every branch by these instead. Not stored: a
    # capability change syncs the user's groups, which clears the rule cache, and the next request
    # computes them afresh.
    webvue_crm_read_company_ids = fields.Many2many('res.company', compute='_compute_webvue_crm_company_ids')
    webvue_crm_assign_company_ids = fields.Many2many('res.company', compute='_compute_webvue_crm_company_ids')

    def _compute_webvue_crm_company_ids(self):
        service = self.env['webvue.access.service']
        for user in self:
            keys = {company: service._webvue_capability_keys(user, company=company) for company in user.company_ids}
            user.webvue_crm_read_company_ids = user.company_ids.filtered(lambda c, keys=keys: READ_CAPABILITY in keys[c])
            user.webvue_crm_assign_company_ids = user.company_ids.filtered(
                lambda c, keys=keys: ASSIGN_CAPABILITY in keys[c],
            )
