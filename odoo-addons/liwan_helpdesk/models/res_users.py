# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The companies whose tickets a user reads in each visibility mode.

Record rules evaluate SQL domains, so each mode is one computed company set per user, exactly as
Sales does for its order book. The sets are computed per request (not stored), so saving a setting
or changing a role is visible to the next request without a cache to clear.
"""
from odoo import fields, models

from .access_service import ASSIGN, READ


class ResUsers(models.Model):
    _inherit = 'res.users'

    liwan_helpdesk_own_company_ids = fields.Many2many('res.company', compute='_compute_liwan_helpdesk_company_ids')
    liwan_helpdesk_team_company_ids = fields.Many2many('res.company', compute='_compute_liwan_helpdesk_company_ids')
    liwan_helpdesk_all_company_ids = fields.Many2many('res.company', compute='_compute_liwan_helpdesk_company_ids')

    def _compute_liwan_helpdesk_company_ids(self):
        service = self.env['liwan.access.service']
        settings_model = self.env['liwan.helpdesk.settings']
        for user in self:
            own, team, everything = self.env['res.company'], self.env['res.company'], self.env['res.company']
            for company in user.company_ids:
                keys = service._liwan_capability_keys(user, company=company)
                if READ not in keys:
                    continue
                if ASSIGN in keys:
                    everything |= company
                    continue
                visibility = settings_model._liwan_for(company).visibility
                if visibility == 'all':
                    everything |= company
                elif visibility == 'own':
                    own |= company
                else:
                    team |= company
            user.liwan_helpdesk_own_company_ids = own
            user.liwan_helpdesk_team_company_ids = team
            user.liwan_helpdesk_all_company_ids = everything
