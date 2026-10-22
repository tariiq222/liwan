# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.private
    def _webvue_meeting_manager_domain(self, company_id, company_ids):
        """Native group membership is global; manager grants belong to a company."""
        self.ensure_one()
        actor = self.with_context(allowed_company_ids=[company_id, *[item for item in company_ids if item != company_id]])
        service = actor.env['webvue.access.service']
        companies = self.env['res.company'].browse(company_ids)
        managed = [company.id for company in companies
                   if service._webvue_has_capability(actor, 'meetings.manage', company=company)]
        return [('company_id', 'in', managed)]

    @api.private
    def _webvue_meeting_access_domain(self, company_id, company_ids, resolution=False):
        """Read only owning-company grants, with participation outside managed companies."""
        self.ensure_one()
        actor = self.with_context(allowed_company_ids=[company_id, *[item for item in company_ids if item != company_id]])
        service = actor.env['webvue.access.service']
        companies = self.env['res.company'].browse(company_ids)
        readable = [company.id for company in companies
                    if service._webvue_has_capability(actor, 'meetings.read', company=company)]
        prefix = 'meeting_id.' if resolution else ''
        return [
            ('company_id', 'in', readable), '|',
            *self._webvue_meeting_manager_domain(company_id, company_ids), '|', '|',
            (prefix + 'organizer_id', '=', self.id),
            (prefix + 'secretary_id', '=', self.id),
            (prefix + 'attendee_ids', 'in', self.ids),
        ]
