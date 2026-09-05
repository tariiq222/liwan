# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

from .res_partner import PARTNER_BRANDING_MARKER

BRANDING_COMPANY_MARKER = 'nasq_core.branding_company_ids'
BRANDING_COMPANY_FIELDS = {'logo', 'name', 'primary_color'}


class ResCompany(models.Model):
    _inherit = 'res.company'

    nasq_access_policy_version = fields.Integer(default=1, required=True)

    font = fields.Selection(
        selection_add=[('IBM_Plex_Sans_Arabic', 'IBM Plex Sans Arabic')],
        default='IBM_Plex_Sans_Arabic',
        ondelete={'IBM_Plex_Sans_Arabic': 'set default'},
    )

    def write(self, vals):
        service = self.env['nasq.access.service']
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and service._nasq_has_capability(
                self.env.user, 'settings.branding.manage',
            )
        ):
            allowed_ids = self.env.cr.precommit.data.get(
                BRANDING_COMPANY_MARKER, set(),
            )
            if (
                not self.ids
                or not set(self.ids) <= allowed_ids
                or not set(vals) <= BRANDING_COMPANY_FIELDS
            ):
                msg = 'use_protected_nasq_access_operation'
                raise AccessError(msg)
        return super().write(vals)

    def _nasq_write_branding(self, vals):
        self.ensure_one()
        service = self.env['nasq.access.service']
        service._nasq_require_capability('settings.branding.manage')
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        if not vals or set(vals) - BRANDING_COMPANY_FIELDS:
            msg = 'invalid_branding_fields'
            raise AccessError(msg)
        marker = self.env.cr.precommit.data
        previous_companies = marker.get(BRANDING_COMPANY_MARKER)
        previous_partners = marker.get(PARTNER_BRANDING_MARKER)
        marker[BRANDING_COMPANY_MARKER] = {self.id}
        marker[PARTNER_BRANDING_MARKER] = {self.partner_id.id}
        try:
            return super().write(vals)
        finally:
            if previous_companies is None:
                marker.pop(BRANDING_COMPANY_MARKER, None)
            else:
                marker[BRANDING_COMPANY_MARKER] = previous_companies
            if previous_partners is None:
                marker.pop(PARTNER_BRANDING_MARKER, None)
            else:
                marker[PARTNER_BRANDING_MARKER] = previous_partners
