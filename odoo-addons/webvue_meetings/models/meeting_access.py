# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.private
    def _webvue_meeting_access_domain(self, company_id, company_ids, resolution=False):
        """Records of the request's pinned companies (current company + branches).

        The capability stays checked in the caller's current company; the record
        scope follows ``company_ids`` so a parent session reads its subtree while
        a branch session never inherits the parent.
        """
        self.ensure_one()
        service = self.env['webvue.access.service']
        company = self.env['res.company'].browse(company_id)
        if not service._webvue_has_capability(self, 'meetings.read', company=company):
            return [('id', '=', 0)]
        domain = [('company_id', 'in', company_ids)]
        if not service._webvue_has_capability(self, 'meetings.manage', company=company):
            prefix = 'meeting_id.' if resolution else ''
            domain += ['|', '|', (prefix + 'organizer_id', '=', self.id),
                       (prefix + 'secretary_id', '=', self.id),
                       (prefix + 'attendee_ids', 'in', self.ids)]
        return domain
